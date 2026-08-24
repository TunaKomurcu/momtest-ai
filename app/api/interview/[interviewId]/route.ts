import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, interviews, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import { OPENAI_MODEL, OPENAI_FAST_MODEL } from '@/lib/llm/config'
import {
  applyInterviewGuard,
  checkInterviewReplyIsolated,
  getInterviewFallbackMessage,
  MAX_INTERVIEW_GUARD_RETRIES,
} from '@/lib/ai-guards/interview-reply-guard'
import {
  detectInjectionAttempt,
} from '@/lib/ai-guards/interview-injection-guard'
import {
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
  InterviewRequestBody,
  InterviewResponseData,
  ApiResponse,
  OpenAIAgentConfig,
  ConversationMessage,
  InterviewCompletedWebhookPayload,
  InterviewScript,
  InterviewLanguage,
  InterviewReplyPayload,
} from '@/types/index'
import {
  shouldUseMockLLM,
  getMockInterviewReply,
} from '@/lib/llm/mock'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PROBES_PER_QUESTION = 2

// ---------------------------------------------------------------------------
// Rate limiting — public route: max 10 req/min per IP
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10
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
// Participant Interviewer system prompt
// ---------------------------------------------------------------------------

const BASE_INTERVIEWER_SYSTEM_PROMPT = `You are a customer discovery interviewer trained in Mom Test principles.

## Core behavior
- Do NOT pitch the product idea, mention the solution, or reveal anything about what is being built.
- Ask about the participant's real life, past behavior, current workflow, current workaround, frequency, cost, urgency, existing tools, and previous purchase behavior.
- Ask ONE question at a time. Wait for the answer before asking the next question.
- Prefer short, plain, conversational questions.
- When an answer is vague, ask for a concrete recent example: "Can you tell me about the last time that happened?"
- When the participant gives praise or enthusiasm, deflect back to facts: "Thanks for that. To keep this useful, can you walk me through how you actually handle this today?"
- When the participant suggests a feature, probe the underlying problem: "What happened in your workflow that made that feel necessary?"
- When the participant says they would buy or use something, redirect to current behavior: "What are you using today, and when did you last try to solve this?"

## Opening frame (use the version matching the required response language for the very first message)
English: "Thanks for taking the time. I am trying to understand how this situation works in your real workflow. I am not here to sell anything. I will mostly ask about what you already do today and recent examples. Ready to get started?"
Turkish: "Vakit ayırdığınız için teşekkürler. Bu durumun sizin gerçek iş akışınızda nasıl işlediğini anlamaya çalışıyorum. Bir şey satmak için burada değilim. Çoğunlukla bugün zaten yaptığınız şeyleri ve yakın zamanda yaşadığınız örnekleri soracağım. Başlamaya hazır mısınız?"

## Banned question patterns (NEVER use these, in any language)
- "Would you use this?" / "Kullanır mıydınız?"
- "Do you like this?" / "Bu fikri beğendiniz mi?"
- "Would you pay for this?" / "Bunun için ödeme yapar mıydınız?"
- "Is this interesting to you?"
- "Should we build this?"
- "Do you think this is a good idea?"
- "Could you imagine using this?"
- Any question starting with "Would you..." / "Eğer ... olsaydı" hypotheticals

## Output contract — you MUST return a JSON object with exactly this shape
{ "language": "tr" | "en", "message": "...", "isClosing": false }

Rules for "message":
- Contains ONLY the question or reply itself. Nothing else.
- NEVER include a lead-in, meta-commentary, restatement of the research goal, or phrases like "my next question is", "to better understand X, ...", "bir sonraki sorum şu olacak", "amacıyla".
- Contains EXACTLY ONE question. Never ask two questions in the same message — no "and", "ayrıca", or a second question mark introducing a separate topic.
- CRITICAL: NEVER clarify, rephrase, or expand on your question in the same turn (e.g., NEVER use "Yani, ...?", "In other words, ...?", "Specifically, ...?", "That is, ...?", "I.e., ...?" — in any language). This is the single most common failure mode: appending a "clarifying" restatement after the real question always produces a second question and is strictly forbidden.
- Enforce EXACTLY ONE question mark ("?") in the entire message. Having two or more question marks is an immediate system violation, with no exceptions.
- No markdown, no quotation marks wrapping the whole message, no XML/JSON tags inside the text.

Rules for "language":
- The conversation context below tells you the required response language for this turn — set "language" to that exact value and write "message" entirely, fluently, and natively in that language.
- Never mix languages within a single message, and never switch languages on your own judgment — the required language is fixed by the app for the whole interview.

Rules for "isClosing":
- Set to true only on the final closing message (see "Closing the interview" below). Otherwise false.

## Few-shot examples (format only — do not reuse this wording verbatim)

Example 1 — Turkish, mid-interview:
Participant: "Genelde haftada bir kere oluyor, Excel'de takip ediyoruz."
Correct: {"language":"tr","message":"Bu süreci Excel'de takip ederken en son ne zaman bir hata ya da gecikme yaşadınız?","isClosing":false}
Incorrect (do NOT do this — filler preamble + two questions): {"language":"tr","message":"Hedef müşteri segmentinizdeki ekiplerin süreçlerini daha iyi anlamak için bir sonraki sorum şu olacak: Bu süreci Excel'de takip ederken en son ne zaman bir hata yaşadınız? Ayrıca bu hatalar ne sıklıkla oluyor?","isClosing":false}

Example 2 — English, mid-interview:
Participant: "We usually just message our manager on Slack."
Correct: {"language":"en","message":"Can you walk me through what happened the last time that message didn't get a response in time?","isClosing":false}

Example 3 — required language stays locked despite a short, ambiguous reply:
Participant: "ok"
Correct (when required language is "tr"): {"language":"tr","message":"Peki bu adımı en son ne zaman kendiniz manuel olarak yapmak zorunda kaldınız?","isClosing":false}

## Question patterns from the Mom Test question bank

Situation discovery:
- Tell me about the last time this happened.
- What triggered it?
- Who was involved?
- What happened next?
- How did you know it was a problem?

Workflow discovery:
- Walk me through how you do this today.
- What tools are involved?
- Where does this process usually break?
- What parts are manual?

Workaround discovery:
- How are you dealing with this now?
- What have you tried already?
- Why did or didn't that work?
- What do you still have to do manually?

Cost and urgency:
- How often does this happen?
- How long does it take each time?
- What does it cost when it goes wrong?
- Who notices when it fails?

Budget and commitment:
- Have you paid for anything to solve this?
- Who approved that spend?
- What would need to happen for you to try a different approach?

Closing:
- Who else should I talk to?
- Is there anything important I failed to ask?
- What should I understand about this that outsiders usually miss?

## Closing the interview
When you have asked 8-10 meaningful questions and received substantive answers, close gracefully (use the version matching the required response language, and set "isClosing": true):
English: "This has been really helpful. Thank you for your time and honest answers. I have what I need. Have a great day!"
Turkish: "Bu gerçekten çok yardımcı oldu. Vaktiniz ve samimi cevaplarınız için teşekkür ederim. İhtiyacım olan bilgilere sahibim. İyi günler dilerim!"

After the closing message, do NOT ask any more questions.`

// ---------------------------------------------------------------------------
// Structured output — response_format: json_schema
// "message" dışında hiçbir alan katılımcıya gösterilmez; "language"/"isClosing"
// uygulama tarafında guard + closing-detection için kullanılır.
// ---------------------------------------------------------------------------

const INTERVIEW_REPLY_SCHEMA: OpenAI.Chat.ChatCompletionCreateParams['response_format'] = {
  type: 'json_schema',
  json_schema: {
    name: 'interview_reply',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['tr', 'en'] },
        message: { type: 'string' },
        isClosing: { type: 'boolean' },
      },
      required: ['language', 'message', 'isClosing'],
      additionalProperties: false,
    },
  },
}

/** Ham LLM çıktısını InterviewReplyPayload olarak parse eder. Şekil uymuyorsa null döner. */
function parseInterviewReply(raw: string): InterviewReplyPayload | null {
  let parsed: Partial<InterviewReplyPayload>
  try {
    parsed = JSON.parse(raw) as Partial<InterviewReplyPayload>
  } catch {
    return null
  }
  if (!parsed || typeof parsed.message !== 'string' || parsed.message.trim().length === 0) {
    return null
  }
  return {
    language: parsed.language === 'tr' ? 'tr' : 'en',
    message: parsed.message.trim(),
    isClosing: parsed.isClosing === true,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAgentConfig(): Partial<OpenAIAgentConfig> {
  try {
    const yamlPath = path.join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml')
    const raw = fs.readFileSync(yamlPath, 'utf-8')
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[Interview] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

function serializeInterviewScript(script: unknown): string {
  if (!script) return 'No interview script available. Use general Mom Test question patterns.'
  try {
    const s = script as Partial<InterviewScript>
    const lines: string[] = []
    if (s.goal) lines.push(`Interview goal: ${s.goal}`)
    if (s.rulesForInterviewer?.length) {
      lines.push('\nRules for this interview:')
      s.rulesForInterviewer.forEach((r) => lines.push(`- ${r}`))
    }
    if (s.questions?.length) {
      lines.push('\nGuided question sequence (follow this order, adapt naturally):')
      s.questions.forEach((q) => {
        const prefix = q.order !== undefined ? `${q.order}. ` : '- '
        const signal = q.signalSought ? ` [signal: ${q.signalSought}]` : ''
        lines.push(`${prefix}${q.question}${signal}`)
      })
    }
    return lines.join('\n')
  } catch {
    return 'Interview script available but could not be parsed. Use general Mom Test question patterns.'
  }
}

function countMeaningfulParticipantReplies(msgs: ConversationMessage[]): number {
  return msgs.filter(
    (m) => m.sender === 'participant' && m.content.trim().split(/\s+/).length >= 5
  ).length
}

function isClosingMessage(text: string): boolean {
  return (
    /thank you for your time/i.test(text) ||
    /thanks for taking the time/i.test(text) ||
    /this has been really helpful/i.test(text) ||
    /have a great day/i.test(text)
  )
}

// Count how many probe questions have been asked for the current question order
// Probe questions typically ask for specific examples, last time, concrete details
function countRecentProbes(history: ConversationMessage[], currentOrder: number): number {
  // Look at recent agent messages and count those that are likely probes
  // Probe indicators: asking for "last time", "specific example", "concrete", "details"
  // More specific patterns to avoid false positives on normal script questions
  const probeIndicators = [
    /last time (that|this|it)/i,
    /specific example of/i,
    /be more specific/i,
    /can you give (me )?a (specific )?example/i,
    /what (exactly )?happened/i,
    /when (exactly )?did (that|this|it)/i,
    /tell me (more )?about (the )?last/i,
  ]

  // Count agent messages in history that match probe patterns
  // We only care about probes for the current question order context
  // Since we don't store order in messages, we'll count recent probes
  // A simple heuristic: count recent agent messages that look like probes
  let probeCount = 0
  const recentAgentMessages = history
    .filter(m => m.sender === 'agent')
    .slice(-5) // Look at last 5 agent messages

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
  { params }: { params: Promise<{ interviewId: string }> }
): Promise<NextResponse<ApiResponse<InterviewResponseData>>> {
  const requestStart = Date.now()

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

  const { interviewId } = await params

  if (!interviewId) {
    return NextResponse.json({ data: null, error: 'interviewId gereklidir.' }, { status: 400 })
  }

  let body: InterviewRequestBody
  try {
    body = (await request.json()) as InterviewRequestBody
  } catch {
    return NextResponse.json({ data: null, error: 'Geçersiz JSON gövdesi.' }, { status: 400 })
  }

  if (!body.message || body.message.trim().length === 0) {
    return NextResponse.json({ data: null, error: 'message alanı boş olamaz.' }, { status: 400 })
  }

  if (!body.participant_name || body.participant_name.trim().length < 2) {
    return NextResponse.json(
      { data: null, error: 'participant_name en az 2 karakter olmalıdır.' },
      { status: 400 }
    )
  }

  const userMessage = body.message.trim()
  const participantName = body.participant_name.trim()

  // ===========================================================================
  // AKIŞ SIRASI (yorum satırları kasıtlıdır — değiştirme):
  // 1. Katılımcı mesajı gelir
  // 2. Injection guard çalışır (heuristic, ~0ms, LLM çağrısı yok)
  //    → Tespit edilirse: LLM'e GİTME, sabit fallback kullan, self-check ATLA
  //    → Tespit edilmezse: devam et
  // 3. Interviewer LLM çağrılır, cevap üretilir
  // 4. Self-check guard çalışır (heuristic → risky ise izole LLM check → retry)
  // 5. Sonuç katılımcıya gönderilir
  // ===========================================================================

  // --- Interview kaydını çek (dil dahil — injection fallback'i için de gerekli) ---
  let interview: { id: string; project_id: string; participant_name: string; status: string; injection_count: number | null; language: InterviewLanguage } | undefined
  try {
    const rows = await db
      .select({
        id: interviews.id,
        project_id: interviews.project_id,
        participant_name: interviews.participant_name,
        status: interviews.status,
        injection_count: interviews.injection_count,
        language: interviews.language,
      })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1)
    interview = rows[0]
  } catch (err) {
    console.error('[Interview] Interview sorgusu başarısız:', err)
    return NextResponse.json({ data: null, error: 'Sunucu hatası.' }, { status: 500 })
  }

  if (!interview) {
    return NextResponse.json({ data: null, error: 'Mülakat bulunamadı.' }, { status: 404 })
  }

  // ---------------------------------------------------------------------------
  // ADIM 2: Injection guard — LLM'e gitmeden önce, deterministik, ~0ms
  // ---------------------------------------------------------------------------
  const injectionResult = detectInjectionAttempt(userMessage)
  let injectionDetected = false
  // agentReply burada önceden tanımlanır: injection varsa hemen set edilir,
  // injection yoksa ADIM 3'te LLM tarafından set edilir.
  let agentReply = ''

  if (injectionResult.suspicious) {
    injectionDetected = true
    console.warn(
      `[Interview/guard] Injection attempt flagged — patterns: ${JSON.stringify(injectionResult.matchedPatterns)} — ` +
      `message (truncated): "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`
    )
    // Injection tespit edildi: LLM'e gitme, self-check atla, fallback cevap kullan.
    // Bu sayede gereksiz LLM çağrısı yapılmaz.
    console.log('[Interview/guard] Injection blocked, self-check skipped')
    agentReply = getInterviewFallbackMessage(interview.language)
  }
  let agentReplyIsClosing = false

  if (interview.status === 'completed') {
    return NextResponse.json(
      { data: null, error: 'Bu mülakat tamamlandı. Yeni mesaj gönderilemez.' },
      { status: 400 }
    )
  }

  const isFirstMessage = interview.status === 'pending'

  if (isFirstMessage) {
    try {
      await db
        .update(interviews)
        .set({
          status: 'ongoing',
          participant_name: participantName,
          participant_role: body.participant_role,
          updated_at: new Date()
        })
        .where(eq(interviews.id, interviewId))
    } catch (err) {
      console.error('[Interview] Interview başlatma güncellemesi başarısız:', err)
    }
  }

  // --- Projenin interview_script'ini çek ---
  let projectScript: unknown = null
  try {
    const rows = await db
      .select({ interview_script: projects.interview_script })
      .from(projects)
      .where(eq(projects.id, interview.project_id))
      .limit(1)
    projectScript = rows[0]?.interview_script ?? null
  } catch (err) {
    console.error('[Interview] Proje script sorgusu başarısız:', err)
  }

  // --- Geçmiş mesajları çek ---
  let history: ConversationMessage[] = []
  try {
    const rows = await db
      .select({ sender: messages.sender, content: messages.content })
      .from(messages)
      .where(eq(messages.interview_id, interviewId))
      .orderBy(asc(messages.created_at))

    history = rows.map((m) => ({
      sender: m.sender as 'agent' | 'participant',
      content: m.content,
    }))
  } catch (err) {
    console.error('[Interview] Mesaj geçmişi alınamadı:', err)
    history = []
  }

  if (shouldUseMockLLM()) {
    const mockReply = getMockInterviewReply(userMessage)
    try {
      await db.insert(messages).values([
        { interview_id: interviewId, sender: 'participant', content: userMessage },
        { interview_id: interviewId, sender: 'agent', content: mockReply },
      ])
    } catch (err) {
      console.error('[Interview] Mock mode mesaj kaydı başarısız:', err)
    }

    return NextResponse.json({
      data: {
        reply: mockReply,
        isComplete: false,
      },
      error: null,
    })
  }

  const agentConfig = loadAgentConfig()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.openai.com/v1',
  })
  const modelName = OPENAI_MODEL

  const meaningfulRepliesBeforeThis = countMeaningfulParticipantReplies(history)

  // Dil, mülakat linki oluşturulurken açıkça seçilir ve interviews.language'da
  // kalıcı olarak saklanır (bkz. app/api/interviews/[projectId]/route.ts) — LLM'in
  // her turda kendi kendine "hangi dildeydik" tahmin etmesine güvenilmez.
  // Per-turn detection (lib/ai-guards/language-guard.ts) artık otoriter kaynak
  // değil, sadece savunma amaçlı yedek olarak dosyada kalır.
  const sessionLanguage: InterviewLanguage = interview.language

  // ---------------------------------------------------------------------------
  // ADIM 2.5: Vagueness check — kullanıcı cevabının somutluğunu değerlendir
  // ---------------------------------------------------------------------------
  let lastAgentQuestion = ''
  let shouldProbe = false
  let vaguenessReason = ''

  if (history.length > 0) {
    // Get the last agent message (the question the user is answering)
    const lastAgentMsg = history.filter(m => m.sender === 'agent').pop()
    if (lastAgentMsg) {
      lastAgentQuestion = lastAgentMsg.content

      // Enhanced heuristic check with confidence levels
      const vaguenessCheck = isLikelyVagueWithConfidence(userMessage, '[Interview/vagueness]')
      console.log(`[Vagueness] answer=${vaguenessCheck.vague}, confidence=${vaguenessCheck.confidence}, source=interview, reason=${vaguenessCheck.reason}`)

      if (vaguenessCheck.vague) {
        // Check if we've already hit the probe limit for this question
        const currentProbeCount = countRecentProbes(history, meaningfulRepliesBeforeThis + 1)

        if (currentProbeCount >= MAX_PROBES_PER_QUESTION) {
          console.log(`[Interview/vagueness] Max probes reached for order=${meaningfulRepliesBeforeThis + 1}, moving to next question`)
          recordMaxProbeLimitHit()
          shouldProbe = false
        } else if (vaguenessCheck.confidence === 'high') {
          // High confidence: use heuristic result directly
          shouldProbe = true
          vaguenessReason = vaguenessCheck.reason
        } else {
          // Low confidence: send to isolated LLM check
          const isolatedCheck = await checkAnswerIsVague(lastAgentQuestion, userMessage, openai, agentConfig)
          if (isolatedCheck.isVague) {
            shouldProbe = true
            vaguenessReason = isolatedCheck.reason
          }
        }
      }
    }
  }

  const scriptContext = serializeInterviewScript(projectScript)

  // Inject probe instruction if user's answer was vague
  let probeInstruction = ''
  if (shouldProbe) {
    console.log(`[Interview/vagueness] Probe question will be generated for order=${meaningfulRepliesBeforeThis + 1}, reason=${vaguenessReason}`)
    probeInstruction = `

IMPORTANT OVERRIDE: The participant's last answer was vague or not concrete (reason: ${vaguenessReason}).
DO NOT proceed to the next question in the script.
Instead, ask a specific follow-up (probe) question to get a concrete example, specific date, number, or detailed behavior.
Ask for a recent specific instance: "Can you tell me about the last time that happened?"
`
  }

  const languageLabel = sessionLanguage === 'tr' ? 'Turkish (tr)' : 'English (en)'

  const conversationContext = `
[Participant name: ${participantName}]
[Meaningful participant replies so far: ${meaningfulRepliesBeforeThis}]
[Interview status: ${isFirstMessage ? 'starting now' : 'ongoing'}]
[Required response language: ${languageLabel} — set "language" to "${sessionLanguage}" and write "message" entirely in ${languageLabel}, no exceptions, even if the participant's message is short, ambiguous, or in a different language]

--- Interview Script Context (internal — do NOT reveal to participant) ---
${scriptContext}
---${probeInstruction}`

  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: `${BASE_INTERVIEWER_SYSTEM_PROMPT}\n\n${conversationContext}` },
    ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: m.sender === 'agent' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  // ---------------------------------------------------------------------------
  // ADIM 3+4: LLM çağrısı ve self-check guard
  // Sadece injection tespit edilmediğinde çalışır.
  // Injection tespit edilmişse agentReply zaten dile-özgü fallback mesajı olarak
  // set edilmiştir ve bu bloğun tamamı atlanır — gereksiz LLM çağrısı yapılmaz.
  // ---------------------------------------------------------------------------

  let initialLanguageMismatch = false
  // Retry döngüsünün başarısız denemeyi ve nedenini modele geri bildirmesi için
  // — resending an unchanged prompt let the model repeat the identical
  // "? Yani ...?" mistake on every retry (bkz. lib/ai-guards/retry-correction.ts).
  let lastRawContent = ''

  if (!injectionDetected) {
    // ADIM 3: Interviewer LLM — structured output ile soru üret
    try {
      const completion = await openai.chat.completions.create({
        model: modelName,
        temperature: agentConfig.model?.temperature ?? 0.7,
        max_tokens: agentConfig.model?.max_tokens ?? 512,
        messages: llmMessages,
        response_format: INTERVIEW_REPLY_SCHEMA,
      })
      const rawContent = completion.choices[0]?.message?.content?.trim() ?? ''
      if (!rawContent) throw new Error('LLM boş yanıt döndürdü.')
      lastRawContent = rawContent

      const parsedReply = parseInterviewReply(rawContent)
      if (!parsedReply) throw new Error('LLM yanıtı beklenen JSON şemasına uymuyor.')

      agentReply = parsedReply.message
      agentReplyIsClosing = parsedReply.isClosing

      // Şemanın kendi "language" alanı ile metnin gerçek dili arasındaki
      // tutarsızlık da erken bir drift sinyalidir — aşağıdaki guard adımında kullanılır.
      initialLanguageMismatch =
        parsedReply.language !== sessionLanguage || !matchesExpectedLanguage(agentReply, sessionLanguage)
    } catch (err) {
      console.error('[Interview] LLM çağrısı başarısız:', err)
      return NextResponse.json(
        { data: null, error: 'Yapay zeka yanıtı alınamadı. Lütfen tekrar deneyin.' },
        { status: 500 }
      )
    }

    // ADIM 4: Self-check guard — üretilen soruyu ve dilini kontrol et.
    // Mom Test kural filtresi kapanış mesajlarına uygulanmaz (aşağıda !agentReplyIsClosing
    // ile atlanır), ama dil kontrolü kapanış mesajları dahil HER zaman çalışır —
    // "strictly avoid drift" gereksinimi. Her iki dal (BLOCKED + RISKY + dil uyumsuzluğu)
    // aynı MAX_INTERVIEW_GUARD_RETRIES döngüsünü kullanır. Retry çıktısı hem kural
    // filtresinden hem isolated check'ten hem de dil kontrolünden geçmeden kabul edilmez.
    const initialGuard = applyInterviewGuard(agentReply)

    console.log('[Interview/guard] orijinal cevap:', {
      verdict:         initialGuard.verdict,
      flags:           'flags' in initialGuard ? initialGuard.flags : [],
      reason:          'reason' in initialGuard ? initialGuard.reason : undefined,
      isClosing:       agentReplyIsClosing,
      expectedLang:    sessionLanguage,
      languageMismatch: initialLanguageMismatch,
      wordCount:       agentReply.trim().split(/\s+/).length,
      questionCount:   (agentReply.match(/\?/g) ?? []).length,
      fullText:        agentReply,
    })

    let needsRetry = initialLanguageMismatch

    if (initialLanguageMismatch) {
      console.warn('[Interview/guard] LANGUAGE MISMATCH — beklenen:', sessionLanguage, '— retry döngüsü başlıyor')
    }

    if (!agentReplyIsClosing) {
      if (initialGuard.verdict === 'blocked') {
        console.warn('[Interview/guard] BLOCKED —', initialGuard.reason, '— retry döngüsü başlıyor')
        needsRetry = true
      } else if (initialGuard.verdict === 'risky') {
        console.warn('[Interview/guard] RISKY — flags:', initialGuard.flags, '— isolated check başlıyor')
        const initialCheck = await checkInterviewReplyIsolated(agentReply, openai, OPENAI_FAST_MODEL)
        console.log('[Interview/guard] isolated check sonucu (orijinal):', initialCheck)
        if (initialCheck.verdict === 'fail') {
          console.warn('[Interview/guard] Isolated check FAIL —', initialCheck.reason, '— retry döngüsü başlıyor')
          needsRetry = true
        }
      }
    }

    if (needsRetry) {
      let accepted = false
      // Bir önceki denemenin neden reddedildiği — retry'dan hemen önce modele
      // eklenecek düzeltme direktifini belirler (bkz. lib/ai-guards/retry-correction.ts).
      let lastFailureKind: 'language' | 'content' = initialLanguageMismatch ? 'language' : 'content'

      for (let attempt = 1; attempt <= MAX_INTERVIEW_GUARD_RETRIES; attempt++) {
        console.warn(`[Interview/guard] Retry denemesi ${attempt}/${MAX_INTERVIEW_GUARD_RETRIES} — düzeltme türü: ${lastFailureKind}`)

        // Agresif düzeltme: başarısız cevabı assistant turn olarak geri yansıt,
        // ardından tam olarak neyin düzeltilmesi gerektiğini söyle. Aynı prompt'u
        // değişmeden yeniden göndermek modelin "? Yani ...?" hatasını her
        // denemede birebir tekrarlamasına yol açıyordu.
        llmMessages.push(
          { role: 'assistant', content: lastRawContent },
          {
            role: 'user',
            content: lastFailureKind === 'language'
              ? buildLanguageCorrection(sessionLanguage)
              : CONTENT_VIOLATION_CORRECTION,
          }
        )

        let candidateReply = ''
        let candidateIsClosing = false
        let candidateLanguageMismatch = true
        try {
          const retryCompletion = await openai.chat.completions.create({
            model:       modelName,
            temperature: agentConfig.model?.temperature ?? 0.7,
            max_tokens:  agentConfig.model?.max_tokens ?? 512,
            messages:    llmMessages,
            response_format: INTERVIEW_REPLY_SCHEMA,
          })
          const rawCandidate = retryCompletion.choices[0]?.message?.content?.trim() ?? ''
          lastRawContent = rawCandidate || lastRawContent
          const parsedCandidate = rawCandidate ? parseInterviewReply(rawCandidate) : null
          if (!parsedCandidate) {
            console.warn(`[Interview/guard] Retry ${attempt} JSON şemasına uymuyor veya boş`)
            lastFailureKind = 'content'
            continue
          }
          candidateReply = parsedCandidate.message
          candidateIsClosing = parsedCandidate.isClosing
          candidateLanguageMismatch =
            parsedCandidate.language !== sessionLanguage || !matchesExpectedLanguage(candidateReply, sessionLanguage)
        } catch (err) {
          console.error(`[Interview/guard] Retry ${attempt} LLM çağrısı başarısız:`, err)
          break
        }

        if (candidateLanguageMismatch) {
          console.warn(`[Interview/guard] Retry ${attempt} LANGUAGE MISMATCH — bir sonraki denemeye geçiliyor`)
          lastFailureKind = 'language'
          continue
        }

        if (candidateIsClosing) {
          agentReply = candidateReply
          agentReplyIsClosing = true
          accepted = true
          console.log(`[Interview/guard] Retry ${attempt} KABUL EDİLDİ (closing, dil uyumlu)`)
          break
        }

        const retryGuard = applyInterviewGuard(candidateReply)
        console.log(`[Interview/guard] Retry ${attempt} kural filtresi:`, {
          verdict:       retryGuard.verdict,
          flags:         'flags' in retryGuard ? retryGuard.flags : [],
          wordCount:     candidateReply.trim().split(/\s+/).length,
          questionCount: (candidateReply.match(/\?/g) ?? []).length,
          fullText:      candidateReply,
        })

        if (retryGuard.verdict === 'blocked') {
          console.warn(`[Interview/guard] Retry ${attempt} BLOCKED — bir sonraki denemeye geçiliyor`)
          lastFailureKind = 'content'
          continue
        }

        const retryCheck = await checkInterviewReplyIsolated(candidateReply, openai, OPENAI_FAST_MODEL)
        console.log(`[Interview/guard] Retry ${attempt} isolated check:`, retryCheck)

        if (retryCheck.verdict === 'pass') {
          agentReply = candidateReply
          agentReplyIsClosing = false
          accepted = true
          console.log(`[Interview/guard] Retry ${attempt} KABUL EDİLDİ (kural: ${retryGuard.verdict}, check: pass, dil uyumlu)`)
          break
        }

        console.warn(`[Interview/guard] Retry ${attempt} isolated check FAIL — ${retryCheck.reason}`)
        lastFailureKind = 'content'
      }

      if (!accepted) {
        console.warn(`[Interview/guard] ${MAX_INTERVIEW_GUARD_RETRIES} retry sonrası kabul edilebilir cevap üretilemedi — fallback kullanılıyor`)
        agentReply = getInterviewFallbackMessage(sessionLanguage)
        agentReplyIsClosing = false
      }
    }
  } // injection yoksa blok sonu

  const isComplete =
    (meaningfulRepliesBeforeThis >= 3 &&
      agentReply.trim().split(/\s+/).length >= 5 &&
      (agentReplyIsClosing || isClosingMessage(agentReply))) ||
    meaningfulRepliesBeforeThis >= 10

  // --- Mesajları kaydet ---
  try {
    await db.insert(messages).values([
      { interview_id: interviewId, sender: 'participant', content: userMessage },
      { interview_id: interviewId, sender: 'agent', content: agentReply },
    ])
  } catch (err) {
    console.error('[Interview] Mesaj kaydı başarısız:', err)
  }

  // --- Injection tespit edildiyse sayacı artır (fire-and-forget) ---
  if (injectionDetected) {
    void db
      .update(interviews)
      .set({
        injection_count: (interview.injection_count ?? 0) + 1,
        updated_at: new Date(),
      })
      .where(eq(interviews.id, interviewId))
      .catch((err: unknown) => {
        console.error('[Interview/guard] injection_count güncellemesi başarısız:', err)
      })
  }

  // --- Tamamlandıysa status güncelle + webhook ---
  if (isComplete) {
    try {
      await db
        .update(interviews)
        .set({ status: 'completed', updated_at: new Date() })
        .where(eq(interviews.id, interviewId))
    } catch (err) {
      console.error('[Interview] Interview tamamlama güncellemesi başarısız:', err)
    }

    const totalMessageCount = history.length + 2
    const webhookUrl = process.env.MAKE_WEBHOOK_INTERVIEW_URL
    if (webhookUrl) {
      const payload: InterviewCompletedWebhookPayload = {
        event: 'interview_completed',
        interview_id: interviewId,
        project_id: interview.project_id,
        participant_name: participantName,
        message_count: totalMessageCount,
        completed_at: new Date().toISOString(),
      }
      void (async () => {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        } catch (err) {
          console.error('[Interview] Make.com webhook gönderilemedi:', err)
        }
      })()
    }
  }

  const guardActive = !(agentReplyIsClosing || isClosingMessage(agentReply))
  console.log(
    `[Interview] POST /api/interview/${interviewId} — ` +
    `${Date.now() - requestStart}ms | ` +
    `model: ${modelName} | ` +
    `injection: ${injectionDetected ? 'flagged' : 'clean'} | ` +
    `guard: ${guardActive ? 'active' : 'skipped(closing)'} | ` +
    `isComplete: ${isComplete}`
  )

  return NextResponse.json(
    { data: { reply: agentReply, isComplete }, error: null },
    { status: 200 }
  )
}
