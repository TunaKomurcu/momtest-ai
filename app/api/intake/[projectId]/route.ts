import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import {
  applyIntakeGuard,
  checkIntakeReplyIsolated,
  INTAKE_FALLBACK_MESSAGE,
  MAX_GUARD_RETRIES,
} from '@/lib/ai-guards/intake-reply-guard'
import type {
  IntakeRequestBody,
  IntakeResponseData,
  ApiResponse,
  OpenAIAgentConfig,
  ConversationMessage,
  IntakeCompletionStatus,
  ResearchBrief,
} from '@/types/index'

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
- When you have gathered enough information to produce all the fields above, respond with a JSON block wrapped in <research_brief> tags followed by a brief confirmation message. Example:
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
- Do not include the <research_brief> tag unless all fields are complete and you are done asking questions.`

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

/**
 * Kullanıcının mesajından dil tespiti yapar.
 * Türkçe karakter veya yaygın Türkçe kelime içeriyorsa 'tr', aksi halde 'en' döner.
 */
function detectLanguage(text: string): 'tr' | 'en' {
  const turkishPattern = /[çğıöşüÇĞİÖŞÜ]|(\b(ve|bir|bu|ile|için|var|ama|nasıl|neden|ne|kim|hangi|kaç|mı|mi|mu|mü|da|de|ta|te)\b)/i
  return turkishPattern.test(text) ? 'tr' : 'en'
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
  const agentConfig = loadOpenAIConfig()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const completionStatus = detectCompletionStatus([
    ...history,
    { sender: 'participant', content: userMessage },
  ])

  // Dil tespiti — mevcut mesaj + önceki kullanıcı mesajlarından
  const recentUserText = [
    ...history.filter(m => m.sender === 'participant').slice(-3).map(m => m.content),
    userMessage,
  ].join(' ')
  const detectedLang = detectLanguage(recentUserText)
  const languageInstruction = detectedLang === 'tr'
    ? 'IMPORTANT: The user is writing in Turkish. You MUST respond entirely in Turkish. Do not use any English sentences.'
    : 'IMPORTANT: The user is writing in English. You MUST respond entirely in English. Do not use any Turkish sentences.'

  const askedQuestions = history
    .filter((m) => m.sender === 'agent')
    .map((m, i) => `Q${i + 1}: ${m.content.slice(0, 120)}`)
    .join('\n')

  const contextNote = `
[CONVERSATION STATUS — DO NOT IGNORE]
- Questions asked so far: ${history.filter((m) => m.sender === 'agent').length} out of 8 maximum
- Product idea received: ${completionStatus.hasProductIdea ? 'YES' : 'NO'}
- Target segment identified: ${completionStatus.hasTargetSegment ? 'YES' : 'NO'}
- Riskiest assumption identified: ${completionStatus.hasRiskiestAssumption ? 'YES' : 'NO'}
${askedQuestions ? `\nQuestions already asked (DO NOT repeat these):\n${askedQuestions}` : ''}
- You must continue the conversation from question ${history.filter((m) => m.sender === 'agent').length + 1}. Do NOT restart.

[LANGUAGE]
${languageInstruction}
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
  try {
    const completion = await openai.chat.completions.create({
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: agentConfig.model?.temperature ?? 0.4,
      max_tokens: agentConfig.model?.max_tokens ?? 512,
      messages: openaiMessages,
    })
    agentReply = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!agentReply) throw new Error('Groq boş yanıt döndürdü.')
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
  // Guard — Katman 1 (kural filtresi) + Katman 2 (isolated LLM check)
  // research_brief tag'i içeren cevaplar guard'a girmez: tamamlanma mesajları
  // temiz kabul edilir. Guard yalnızca sohbet cevaplarını denetler.
  //
  // Retry zinciri — her iki dal (BLOCKED + RISKY) için ortak mantık:
  //   1. Orijinal cevap kural filtresinden geçer.
  //   2. blocked → doğrudan retry döngüsüne gir.
  //   3. risky   → önce isolated check; fail ise retry döngüsüne gir.
  //   4. Döngü her adımda hem kural filtresi HEM isolated check uygular.
  //   5. MAX_GUARD_RETRIES kadar deneme sonrası hâlâ geçemezse fallback.
  // ---------------------------------------------------------------------------
  const agentMessageCount = history.filter(m => m.sender === 'agent').length
  const modelName = agentConfig.model?.name ?? 'gemini-flash-latest'

  if (!/<research_brief>/i.test(agentReply)) {
    const initialGuard = applyIntakeGuard(agentReply, agentMessageCount)

    // ── Teşhis logu — her istekte orijinal cevabı kayıt altına alır ──────────
    console.log('[Intake/guard] orijinal cevap:', {
      verdict:            initialGuard.verdict,
      flags:              'flags' in initialGuard ? initialGuard.flags : [],
      reason:             'reason' in initialGuard ? initialGuard.reason : undefined,
      wordCount:          agentReply.trim().split(/\s+/).length,
      questionCount:      (agentReply.match(/\?/g) ?? []).length,
      startsWithIThink:   /^i\s+think\s+/im.test(agentReply),
      startsWithIBelieve: /^i\s+believe\s+/im.test(agentReply),
      hasSanırım:         /sanırım\s+/i.test(agentReply),
      hasBence:           /bence\s+/i.test(agentReply),
      fullText:           agentReply,
    })
    // ─────────────────────────────────────────────────────────────────────────

    // Orijinal cevabın retry döngüsüne girmesi gerekip gerekmediğini belirle
    let needsRetry = false

    if (initialGuard.verdict === 'blocked') {
      console.warn('[Intake/guard] BLOCKED —', initialGuard.reason, '— retry döngüsü başlıyor')
      needsRetry = true
    } else if (initialGuard.verdict === 'risky') {
      console.warn('[Intake/guard] RISKY — flags:', initialGuard.flags, '— isolated check başlıyor')
      const initialCheck = await checkIntakeReplyIsolated(agentReply, openai, modelName)
      console.log('[Intake/guard] isolated check sonucu (orijinal):', initialCheck)
      if (initialCheck.verdict === 'fail') {
        console.warn('[Intake/guard] Isolated check FAIL —', initialCheck.reason, '— retry döngüsü başlıyor')
        needsRetry = true
      }
      // isolated check pass → needsRetry false, agentReply değişmez
    }
    // clean → needsRetry false, agentReply değişmez

    // ── Retry döngüsü — MAX_GUARD_RETRIES kez dene, her adımda tam doğrula ──
    if (needsRetry) {
      let accepted = false

      for (let attempt = 1; attempt <= MAX_GUARD_RETRIES; attempt++) {
        console.warn(`[Intake/guard] Retry denemesi ${attempt}/${MAX_GUARD_RETRIES}`)

        let candidateReply = ''
        try {
          const retryCompletion = await openai.chat.completions.create({
            model:      modelName,
            temperature: agentConfig.model?.temperature ?? 0.4,
            max_tokens:  agentConfig.model?.max_tokens ?? 512,
            messages:    openaiMessages,
          })
          candidateReply = retryCompletion.choices[0]?.message?.content?.trim() ?? ''
        } catch (err) {
          console.error(`[Intake/guard] Retry ${attempt} LLM çağrısı başarısız:`, err)
          break  // LLM erişilemez — döngüyü kır, fallback'e düş
        }

        if (!candidateReply) {
          console.warn(`[Intake/guard] Retry ${attempt} boş cevap döndürdü`)
          continue
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
          continue
        }

        // Adım 2: isolated LLM check — risky ve clean için de çalışır
        // (risky cevaplar isolated check'ten geçmeden kabul edilmez)
        const retryCheck = await checkIntakeReplyIsolated(candidateReply, openai, modelName)
        console.log(`[Intake/guard] Retry ${attempt} isolated check:`, retryCheck)

        if (retryCheck.verdict === 'pass') {
          agentReply = candidateReply
          accepted = true
          console.log(`[Intake/guard] Retry ${attempt} KABUL EDİLDİ (kural: ${retryGuard.verdict}, check: pass)`)
          break
        }

        console.warn(`[Intake/guard] Retry ${attempt} isolated check FAIL — ${retryCheck.reason}`)
      }

      if (!accepted) {
        console.warn(
          `[Intake/guard] ${MAX_GUARD_RETRIES} retry sonrası kabul edilebilir cevap üretilemedi — fallback kullanılıyor`
        )
        agentReply = INTAKE_FALLBACK_MESSAGE
      }
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
