import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import { OPENAI_MODEL, OPENAI_FAST_MODEL } from '@/lib/llm/config'
import {
  applyIntakeGuard,
  checkIntakeReplyIsolated,
  getIntakeFallbackMessage,
  MAX_GUARD_RETRIES,
} from '@/lib/ai-guards/intake-reply-guard'
import {
  resolveSessionLanguage,
  matchesExpectedLanguage,
} from '@/lib/ai-guards/language-guard'
import {
  CONTENT_VIOLATION_CORRECTION,
  buildLanguageCorrection,
} from '@/lib/ai-guards/retry-correction'
import {
  isLikelyVague,
  isLikelyVagueWithConfidence,
  checkAnswerIsVague,
  recordMaxProbeLimitHit,
} from '@/lib/answer-vagueness-checker'
import type {
  IntakeRequestBody,
  IntakeResponseData,
  ApiResponse,
  OpenAIAgentConfig,
  ConversationMessage,
  IntakeCompletionStatus,
  ResearchBrief,
  InterviewLanguage,
} from '@/types/index'
import {
  shouldUseMockLLM,
  getMockIntakeReply,
} from '@/lib/llm/mock'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROBES_PER_QUESTION = 2

// ---------------------------------------------------------------------------
// Rate limiting — max 20 req/min per IP
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ---------------------------------------------------------------------------
// PM Intake system prompt
// ---------------------------------------------------------------------------

const PM_INTAKE_SYSTEM_PROMPT = `You are a customer discovery architect trained in Mom Test principles.

Your job is not to validate the PM's idea. Your job is to identify the riskiest assumptions and design interviews that reveal real customer behavior.

Ask one question at a time. Stop when you can produce:
- research goal
- target customer segment
- core situation
- riskiest assumption
- interview objective
- evidence needed

Do NOT ask the PM about forbidden questions or participant criteria — you will derive these yourself from the conversation.

Do not generate customer interview questions until the PM context is clear.

CRITICAL RULES — READ BEFORE RESPONDING:
- You are in the MIDDLE of an ongoing conversation. The conversation history above is REAL. Do NOT restart, re-introduce yourself, or ask questions you have already asked.
- Check the conversation history carefully. Count how many questions you have already asked. Continue from where the conversation left off.
- Ask a maximum of 8 questions total across the ENTIRE conversation. Do not exceed this limit.
- NEVER ask a question you have already asked in this conversation.

## Output contract — you MUST return a JSON object with exactly this shape
{ "language": "tr" | "en", "message": "..." }

Rules for "message":
- Contains ONLY the question or reply itself — no lead-in, no meta-commentary, no phrases like "My next question is:", "Here is my next question:", "Bir sonraki sorum şu olacak:", "Sorum:" or any similar preamble in any language.
- Do NOT explain what you are about to ask. Just ask it directly. Do NOT number the question (no "1.", "Question 2:", etc.).
- Contains EXACTLY ONE question. Never two questions in one message, joined by no conjunction ("and", "also", "ve", "ayrıca") introducing a second question.
- CRITICAL: NEVER clarify, rephrase, or expand on your question in the same turn (e.g., NEVER use "Yani, ...?", "In other words, ...?", "Specifically, ...?", "That is, ...?", "I.e., ...?" — in any language). This is the single most common failure mode: appending a "clarifying" restatement after the real question always produces a second question and is strictly forbidden.
- Enforce EXACTLY ONE question mark ("?") in the entire message. Having two or more question marks is an immediate system violation, with no exceptions (the completed <research_brief> case below is the only exception to this whole section).
- When you have gathered enough information to produce all the fields listed above, "message" contains a JSON block wrapped in <research_brief> tags followed by a brief confirmation sentence — this is the ONE exception to the single-question rule. Example value for "message":
<research_brief>
{
  "researchGoal": "...",
  "targetCustomerSegment": "...",
  "coreSituation": "...",
  "riskiestAssumption": "...",
  "interviewObjective": "...",
  "evidenceNeeded": "...",
  "forbiddenQuestions": ["...", "..."],
  "participantCriteria": "..."
}
</research_brief>
Research brief is ready. I will now design your interview script.
- Do not include the <research_brief> tag in "message" unless all fields are complete and you are done asking questions.

Rules for "language":
- The conversation context below tells you the required response language for this turn — set "language" to that exact value and write "message" entirely, fluently, and natively in that language (including the confirmation sentence after a completed <research_brief> block — the JSON keys inside the tag stay in English, only the surrounding prose is localized).
- Never mix languages within a single message, and never switch languages on your own judgment — the required language is fixed by the app for the whole conversation.`

// ---------------------------------------------------------------------------
// Structured output — response_format: json_schema
// research_brief hâlâ <research_brief> XML tag'i olarak "message" alanının
// İÇİNDE taşınır (mevcut extractResearchBrief/checkCompletion mantığı
// değişmeden çalışmaya devam eder) — şema sadece dış zarfı ({language,message})
// enforce eder, bu da zero-preamble ve tek-soru kurallarını yapısal olarak destekler.
// ---------------------------------------------------------------------------

const INTAKE_REPLY_SCHEMA: OpenAI.Chat.ChatCompletionCreateParams['response_format'] = {
  type: 'json_schema',
  json_schema: {
    name: 'intake_reply',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['tr', 'en'] },
        message: { type: 'string' },
      },
      required: ['language', 'message'],
      additionalProperties: false,
    },
  },
}

/** Ham LLM çıktısını { language, message } olarak parse eder. Şekil uymuyorsa null döner. */
function parseIntakeReply(raw: string): { language: InterviewLanguage; message: string } | null {
  let parsed: { language?: unknown; message?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed.message !== 'string' || parsed.message.trim().length === 0) {
    return null
  }
  return {
    language: parsed.language === 'tr' ? 'tr' : 'en',
    message: parsed.message.trim(),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadOpenAIConfig(): Partial<OpenAIAgentConfig> {
  try {
    const yamlPath = path.join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml')
    const raw = fs.readFileSync(yamlPath, 'utf-8')
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch (err) {
    console.warn('[Intake] openai.yaml okunamadı, varsayılan değerler kullanılıyor. Hata:', err)
    return {}
  }
}

function extractResearchBrief(reply: string): ResearchBrief | null {
  const match = reply.match(/<research_brief>([\s\S]*?)<\/research_brief>/)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim()) as ResearchBrief
  } catch {
    console.error('[Intake] research_brief JSON parse hatası')
    return null
  }
}

function checkCompletion(messages: ConversationMessage[], agentReply: string): boolean {
  if (extractResearchBrief(agentReply)) return true
  const agentMessageCount = messages.filter((m) => m.sender === 'agent').length
  if (agentMessageCount >= 8) return true
  return false
}

function detectCompletionStatus(messages: ConversationMessage[]): IntakeCompletionStatus {
  const fullText = messages.map((m) => m.content).join(' ').toLowerCase()
  return {
    hasProductIdea: fullText.length > 50,
    hasTargetSegment: /segment|hedef kitle|target|kullanıcı|customer|user/.test(fullText),
    hasRiskiestAssumption: /risk|assumption|varsayım|kritik|problem/.test(fullText),
  }
}

// Count how many probe questions have been asked recently
// Probe questions typically ask for specific examples, last time, concrete details
function countRecentProbes(history: ConversationMessage[]): number {
  const probeIndicators = [
    /last time (that|this|it)/i,
    /specific example of/i,
    /be more specific/i,
    /can you give (me )?a (specific )?example/i,
    /what (exactly )?happened/i,
    /when (exactly )?did (that|this|it)/i,
    /tell me (more )?about (the )?last/i,
  ]

  let probeCount = 0
  const recentAgentMessages = history
    .filter(m => m.sender === 'agent')
    .slice(-5)

  for (const msg of recentAgentMessages) {
    const isProbe = probeIndicators.some(pattern => pattern.test(msg.content))
    if (isProbe) probeCount++
  }

  return probeCount
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<IntakeResponseData>>> {
  console.log('[DEBUG] ENV CHECK:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV,
  })

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { data: null, error: 'Çok fazla istek gönderildi. Lütfen bir dakika bekleyin.' },
      { status: 429 }
    )
  }

  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json({ data: null, error: 'projectId gereklidir.' }, { status: 400 })
  }

  let body: IntakeRequestBody
  try {
    body = (await request.json()) as IntakeRequestBody
  } catch {
    return NextResponse.json({ data: null, error: 'Geçersiz JSON gövdesi.' }, { status: 400 })
  }

  if (!body.message || body.message.trim().length === 0) {
    return NextResponse.json({ data: null, error: 'message alanı boş olamaz.' }, { status: 400 })
  }

  const userMessage = body.message.trim()

  // --- Projeyi doğrula ---
  let project: { id: string; product_idea: string; research_brief: unknown } | undefined
  try {
    const rows = await db
      .select({ id: projects.id, product_idea: projects.product_idea, research_brief: projects.research_brief })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    project = rows[0]
  } catch (err) {
    console.error('[Intake] Proje sorgusu başarısız:', err)
    return NextResponse.json({ data: null, error: 'Sunucu hatası.' }, { status: 500 })
  }

  if (!project) {
    return NextResponse.json({ data: null, error: 'Proje bulunamadı.' }, { status: 404 })
  }

  // --- Geçmiş mesajları çek (intake mesajları projectId ile eşleşen interview_id'ye bakılır) ---
  let history: ConversationMessage[] = []
  try {
    const rows = await db
      .select({ sender: messages.sender, content: messages.content })
      .from(messages)
      .where(eq(messages.interview_id, projectId))
      .orderBy(asc(messages.created_at))

    history = rows.map((m) => ({
      sender: m.sender as 'agent' | 'participant',
      content: m.content,
    }))
  } catch (err) {
    console.error('[Intake] Mesaj geçmişi alınamadı:', err)
    history = []
  }

  // --- LLM config ---
  if (shouldUseMockLLM()) {
    const mockReply = getMockIntakeReply(project.product_idea)
    const cleanReply = mockReply
      .replace(/<research_brief>[\s\S]*?<\/research_brief>/g, '')
      .trim()

    try {
      await db.insert(messages).values([
        { interview_id: projectId, sender: 'participant', content: userMessage },
        { interview_id: projectId, sender: 'agent', content: cleanReply },
      ])
    } catch (err) {
      console.error('[Intake] Mock mode mesaj kaydı başarısız:', err)
    }

    return NextResponse.json({
      data: {
        reply: mockReply,
        isComplete: true,
      },
      error: null,
    })
  }

  const agentConfig = loadOpenAIConfig()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.openai.com/v1',
  })
  const modelName = OPENAI_MODEL

  // Dil, PM'in ilk mesajından koda tarafından kilitlenir — her turda yeniden
  // tahmin edilmez. Interview route ile aynı mekanizma (bkz. lib/ai-guards/language-guard.ts).
  const sessionLanguage: InterviewLanguage = resolveSessionLanguage(history, userMessage)

  // ---------------------------------------------------------------------------
  // Vagueness check — PM cevabının somutluğunu değerlendir
  // ---------------------------------------------------------------------------
  let lastAgentQuestion = ''
  let shouldProbe = false
  let vaguenessReason = ''
  let isProbe = false

  if (history.length > 0) {
    // Get the last agent message (the question the PM is answering)
    const lastAgentMsg = history.filter(m => m.sender === 'agent').pop()
    if (lastAgentMsg) {
      lastAgentQuestion = lastAgentMsg.content

      // Enhanced heuristic check with confidence levels
      const vaguenessCheck = isLikelyVagueWithConfidence(userMessage, '[Intake/vagueness]')
      console.log(`[Vagueness] answer=${vaguenessCheck.vague}, confidence=${vaguenessCheck.confidence}, source=intake, reason=${vaguenessCheck.reason}`)

      if (vaguenessCheck.vague) {
        // Check if we've already hit the probe limit
        const currentProbeCount = countRecentProbes(history)

        if (currentProbeCount >= MAX_PROBES_PER_QUESTION) {
          console.log('[Intake/vagueness] Max probes reached, moving to next question')
          recordMaxProbeLimitHit()
          shouldProbe = false
        } else if (vaguenessCheck.confidence === 'high') {
          // High confidence: use heuristic result directly
          shouldProbe = true
          vaguenessReason = vaguenessCheck.reason
          isProbe = true
        } else {
          // Low confidence: send to isolated LLM check
          const isolatedCheck = await checkAnswerIsVague(lastAgentQuestion, userMessage, openai, agentConfig, '[Intake/vagueness]')
          if (isolatedCheck.isVague) {
            shouldProbe = true
            vaguenessReason = isolatedCheck.reason
            isProbe = true
          }
        }
      }
    }
  }

  const completionStatus = detectCompletionStatus([
    ...history,
    { sender: 'participant', content: userMessage },
  ])

  const languageLabel = sessionLanguage === 'tr' ? 'Turkish (tr)' : 'English (en)'

  const askedQuestions = history
    .filter((m) => m.sender === 'agent')
    .map((m, i) => `Q${i + 1}: ${m.content.slice(0, 120)}`)
    .join('\n')

  // Inject probe instruction if PM's answer was vague
  let probeInstruction = ''
  if (shouldProbe) {
    console.log(`[Intake/vagueness] Probe question will be generated, reason=${vaguenessReason}`)
    probeInstruction = `

IMPORTANT OVERRIDE: The PM's last answer was vague or not concrete (reason: ${vaguenessReason}).
DO NOT proceed to the next question in your 8-question sequence.
Instead, ask a specific follow-up (probe) question to get a concrete example, specific details, or a real scenario.
Ask for a specific instance: "Can you give me a specific example of when this happens?"
This probe question does NOT count toward your 8-question limit.
`
  }

  const contextNote = `
[CONVERSATION STATUS — DO NOT IGNORE]
- Questions asked so far: ${history.filter((m) => m.sender === 'agent').length} out of 8 maximum${isProbe ? ' (this probe does not count)' : ''}
- Product idea received: ${completionStatus.hasProductIdea ? 'YES' : 'NO'}
- Target segment identified: ${completionStatus.hasTargetSegment ? 'YES' : 'NO'}
- Riskiest assumption identified: ${completionStatus.hasRiskiestAssumption ? 'YES' : 'NO'}
${askedQuestions ? `\nQuestions already asked (DO NOT repeat these):\n${askedQuestions}` : ''}
- You must continue the conversation from question ${history.filter((m) => m.sender === 'agent').length + 1}. Do NOT restart.

[Required response language: ${languageLabel} — set "language" to "${sessionLanguage}" and write "message" entirely in ${languageLabel}, no exceptions, even if the PM's message is short, ambiguous, or in a different language]
${probeInstruction}
`

  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: PM_INTAKE_SYSTEM_PROMPT + '\n\n' + contextNote },
    ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: m.sender === 'agent' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  let agentReply: string
  let initialLanguageMismatch = false
  // Retry döngüsünün başarısız denemeyi ve nedenini modele geri bildirmesi için
  // — bkz. lib/ai-guards/retry-correction.ts.
  let lastRawContent = ''
  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      temperature: agentConfig.model?.temperature ?? 0.4,
      max_tokens: agentConfig.model?.max_tokens ?? 512,
      messages: openaiMessages,
      response_format: INTAKE_REPLY_SCHEMA,
    })
    const rawContent = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!rawContent) throw new Error('LLM boş yanıt döndürdü.')
    lastRawContent = rawContent

    const parsedReply = parseIntakeReply(rawContent)
    if (!parsedReply) throw new Error('LLM yanıtı beklenen JSON şemasına uymuyor.')

    agentReply = parsedReply.message
    initialLanguageMismatch =
      parsedReply.language !== sessionLanguage || !matchesExpectedLanguage(agentReply, sessionLanguage)
  } catch (err) {
    console.error('[Intake] LLM çağrısı başarısız:', err)
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  const isComplete = checkCompletion(
    [...history, { sender: 'participant', content: userMessage }],
    agentReply
  )

  // ---------------------------------------------------------------------------
  // Guard — Katman 1 (kural filtresi) + Katman 2 (isolated LLM check) + dil kontrolü
  // research_brief tag'i içeren cevaplar Mom Test kural filtresine girmez:
  // tamamlanma mesajları temiz kabul edilir. Dil kontrolü ise HER zaman çalışır —
  // tamamlanma onay mesajı da PM'e gösterilen bir mesajdır.
  //
  // Retry zinciri:
  //   1. Orijinal cevap kural filtresinden geçer (isComplete değilse).
  //   2. blocked → doğrudan retry döngüsüne gir.
  //   3. risky   → önce isolated check; fail ise retry döngüsüne gir.
  //   4. Dil uyumsuzluğu → her zaman retry döngüsüne gir (isComplete'ten bağımsız).
  //   5. Döngü her adımda hem kural filtresi HEM isolated check HEM dil kontrolü uygular.
  //   6. MAX_GUARD_RETRIES kadar deneme sonrası hâlâ geçemezse dile-özgü fallback.
  // ---------------------------------------------------------------------------
  const agentMessageCount = history.filter(m => m.sender === 'agent').length
  const replyIsComplete = /<research_brief>/i.test(agentReply)

  const initialGuard = replyIsComplete ? undefined : applyIntakeGuard(agentReply, agentMessageCount)

  // ── Teşhis logu — her istekte orijinal cevabı kayıt altına alır ──────────
  console.log('[Intake/guard] orijinal cevap:', {
    verdict:            initialGuard?.verdict ?? 'skipped(complete)',
    flags:              initialGuard && 'flags' in initialGuard ? initialGuard.flags : [],
    reason:             initialGuard && 'reason' in initialGuard ? initialGuard.reason : undefined,
    expectedLang:       sessionLanguage,
    languageMismatch:   initialLanguageMismatch,
    wordCount:          agentReply.trim().split(/\s+/).length,
    questionCount:      (agentReply.match(/\?/g) ?? []).length,
    fullText:           agentReply,
  })
  // ─────────────────────────────────────────────────────────────────────────

  // Orijinal cevabın retry döngüsüne girmesi gerekip gerekmediğini belirle
  let needsRetry = initialLanguageMismatch

  if (initialLanguageMismatch) {
    console.warn('[Intake/guard] LANGUAGE MISMATCH — beklenen:', sessionLanguage, '— retry döngüsü başlıyor')
  }

  if (initialGuard?.verdict === 'blocked') {
    console.warn('[Intake/guard] BLOCKED —', initialGuard.reason, '— retry döngüsü başlıyor')
    needsRetry = true
  } else if (initialGuard?.verdict === 'risky') {
    console.warn('[Intake/guard] RISKY — flags:', initialGuard.flags, '— isolated check başlıyor')
    const initialCheck = await checkIntakeReplyIsolated(agentReply, openai, OPENAI_FAST_MODEL)
    console.log('[Intake/guard] isolated check sonucu (orijinal):', initialCheck)
    if (initialCheck.verdict === 'fail') {
      console.warn('[Intake/guard] Isolated check FAIL —', initialCheck.reason, '— retry döngüsü başlıyor')
      needsRetry = true
    }
    // isolated check pass → needsRetry (dil hariç) false, agentReply değişmez
  }
  // clean / skipped(complete) → needsRetry (dil hariç) false, agentReply değişmez

  // ── Retry döngüsü — MAX_GUARD_RETRIES kez dene, her adımda tam doğrula ──
  if (needsRetry) {
    let accepted = false
    // Bir önceki denemenin neden reddedildiği — retry'dan hemen önce modele
    // eklenecek düzeltme direktifini belirler (bkz. lib/ai-guards/retry-correction.ts).
    let lastFailureKind: 'language' | 'content' = initialLanguageMismatch ? 'language' : 'content'

    for (let attempt = 1; attempt <= MAX_GUARD_RETRIES; attempt++) {
      console.warn(`[Intake/guard] Retry denemesi ${attempt}/${MAX_GUARD_RETRIES} — düzeltme türü: ${lastFailureKind}`)

      // Agresif düzeltme: başarısız cevabı assistant turn olarak geri yansıt,
      // ardından tam olarak neyin düzeltilmesi gerektiğini söyle. Aynı prompt'u
      // değişmeden yeniden göndermek modelin "? Yani ...?" hatasını her
      // denemede birebir tekrarlamasına yol açıyordu (production log kanıtı).
      openaiMessages.push(
        { role: 'assistant', content: lastRawContent },
        {
          role: 'user',
          content: lastFailureKind === 'language'
            ? buildLanguageCorrection(sessionLanguage)
            : CONTENT_VIOLATION_CORRECTION,
        }
      )

      let candidateReply = ''
      let candidateIsComplete = false
      let candidateLanguageMismatch = true
      try {
        const retryCompletion = await openai.chat.completions.create({
          model:      modelName,
          temperature: agentConfig.model?.temperature ?? 0.4,
          max_tokens:  agentConfig.model?.max_tokens ?? 512,
          messages:    openaiMessages,
          response_format: INTAKE_REPLY_SCHEMA,
        })
        const rawCandidate = retryCompletion.choices[0]?.message?.content?.trim() ?? ''
        lastRawContent = rawCandidate || lastRawContent
        const parsedCandidate = rawCandidate ? parseIntakeReply(rawCandidate) : null
        if (!parsedCandidate) {
          console.warn(`[Intake/guard] Retry ${attempt} JSON şemasına uymuyor veya boş`)
          lastFailureKind = 'content'
          continue
        }
        candidateReply = parsedCandidate.message
        candidateIsComplete = /<research_brief>/i.test(candidateReply)
        candidateLanguageMismatch =
          parsedCandidate.language !== sessionLanguage || !matchesExpectedLanguage(candidateReply, sessionLanguage)
      } catch (err) {
        console.error(`[Intake/guard] Retry ${attempt} LLM çağrısı başarısız:`, err)
        break  // LLM erişilemez — döngüyü kır, fallback'e düş
      }

      if (candidateLanguageMismatch) {
        console.warn(`[Intake/guard] Retry ${attempt} LANGUAGE MISMATCH — bir sonraki denemeye geçiliyor`)
        lastFailureKind = 'language'
        continue
      }

      if (candidateIsComplete) {
        agentReply = candidateReply
        accepted = true
        console.log(`[Intake/guard] Retry ${attempt} KABUL EDİLDİ (complete, dil uyumlu)`)
        break
      }

      // Adım 1: kural filtresi
      const retryGuard = applyIntakeGuard(candidateReply, agentMessageCount)
      console.log(`[Intake/guard] Retry ${attempt} kural filtresi:`, {
        verdict:       retryGuard.verdict,
        flags:         'flags' in retryGuard ? retryGuard.flags : [],
        wordCount:     candidateReply.trim().split(/\s+/).length,
        questionCount: (candidateReply.match(/\?/g) ?? []).length,
        fullText:      candidateReply,
      })

      if (retryGuard.verdict === 'blocked') {
        console.warn(`[Intake/guard] Retry ${attempt} BLOCKED — bir sonraki denemeye geçiliyor`)
        lastFailureKind = 'content'
        continue
      }

      // Adım 2: isolated LLM check — risky ve clean için de çalışır
      // (risky cevaplar isolated check'ten geçmeden kabul edilmez)
      const retryCheck = await checkIntakeReplyIsolated(candidateReply, openai, OPENAI_FAST_MODEL)
      console.log(`[Intake/guard] Retry ${attempt} isolated check:`, retryCheck)

      if (retryCheck.verdict === 'pass') {
        agentReply = candidateReply
        accepted = true
        console.log(`[Intake/guard] Retry ${attempt} KABUL EDİLDİ (kural: ${retryGuard.verdict}, check: pass, dil uyumlu)`)
        break
      }

      console.warn(`[Intake/guard] Retry ${attempt} isolated check FAIL — ${retryCheck.reason}`)
      lastFailureKind = 'content'
    }

    if (!accepted) {
      console.warn(
        `[Intake/guard] ${MAX_GUARD_RETRIES} retry sonrası kabul edilebilir cevap üretilemedi — fallback kullanılıyor`
      )
      agentReply = getIntakeFallbackMessage(sessionLanguage)
    }
  }

  // Kullanıcıya döndürülecek reply'dan <research_brief> tag'ini temizle
  // DB'ye de temiz hali yazılır — JSON bloğu sohbette görünmez
  const cleanReply = agentReply
    .replace(/<research_brief>[\s\S]*?<\/research_brief>/g, '')
    .trim()

  // --- Mesajları kaydet — cleanReply kullanılır ---
  try {
    await db.insert(messages).values([
      { interview_id: projectId, sender: 'participant', content: userMessage },
      { interview_id: projectId, sender: 'agent',       content: cleanReply },
    ])
  } catch (err) {
    console.error('[Intake] Mesaj kaydı başarısız:', err)
    // Mesaj kaydı başarısız olursa isComplete'i false'a çek —
    // generate route'u boş mesaj listesiyle karşılaşmasın.
    return NextResponse.json(
      { data: null, error: 'Mesaj kaydedilemedi. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // --- Tamamlandıysa research_brief güncelle ---
  if (isComplete) {
    const brief = extractResearchBrief(agentReply)
    if (brief) {
      try {
        await db
          .update(projects)
          .set({ research_brief: brief, updated_at: new Date() })
          .where(eq(projects.id, projectId))
      } catch (err) {
        console.error('[Intake] research_brief güncellemesi başarısız:', err)
      }
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_ANALYSIS_URL
    if (webhookUrl) {
      void (async () => {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, event: 'intake_complete' }),
          })
        } catch (err) {
          console.error('[Intake] Make.com webhook gönderilemedi:', err)
        }
      })()
    }
  }

  return NextResponse.json({ data: { reply: cleanReply, isComplete }, error: null }, { status: 200 })
}
