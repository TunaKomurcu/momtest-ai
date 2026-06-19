import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { Database } from '@/types/database.types'
import type {
  InterviewRequestBody,
  InterviewResponseData,
  ApiResponse,
  OpenAIAgentConfig,
  ConversationMessage,
  InterviewCompletedWebhookPayload,
} from '@/types/index'

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
// Participant Interviewer system prompt — SKILL.md Skill 5 +
// mom-test-agent-prompts.md participant interviewer agent
// ---------------------------------------------------------------------------

/**
 * Statik sistem promptu.
 * Dinamik bölümler (interview_script, participant_name) çalışma zamanında eklenir.
 */
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

## Opening frame (use this verbatim for the very first message)
"Thanks for taking the time. I am trying to understand how this situation works in your real workflow. I am not here to sell anything. I will mostly ask about what you already do today and recent examples. Ready to get started?"

## Banned question patterns (NEVER use these)
- "Would you use this?"
- "Do you like this?"
- "Would you pay for this?"
- "Is this interesting to you?"
- "Should we build this?"
- "Do you think this is a good idea?"
- "Could you imagine using this?"
- Any question starting with "Would you..."

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
When you have asked 8-10 meaningful questions and received substantive answers, close gracefully:
"This has been really helpful. Thank you for your time and honest answers. I have what I need. Have a great day!"

After the closing message, do NOT ask any more questions.`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAgentConfig(): Partial<OpenAIAgentConfig> {
  try {
    const yamlPath = path.join(
      process.cwd(),
      'mom-test-customer-discovery',
      'agents',
      'openai.yaml'
    )
    const raw = fs.readFileSync(yamlPath, 'utf-8')
    return yaml.load(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[Interview] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

/**
 * interview_script JSONB verisini okunabilir metin bloğuna çevirir.
 * LLM'e bağlam olarak verilir; katılımcıya asla gösterilmez.
 */
function serializeInterviewScript(script: Database['public']['Tables']['projects']['Row']['interview_script']): string {
  if (!script) return 'No interview script available. Use general Mom Test question patterns.'

  try {
    const s = script as {
      goal?: string
      rulesForInterviewer?: string[]
      questions?: Array<{ order?: number; question: string; signalSought?: string }>
    }

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

/**
 * Anlamlı katılımcı yanıtı sayısını hesaplar.
 * Kısa/tek kelimelik yanıtlar sayılmaz.
 */
function countMeaningfulParticipantReplies(messages: ConversationMessage[]): number {
  return messages.filter(
    (m) => m.sender === 'participant' && m.content.trim().split(/\s+/).length >= 5
  ).length
}

/**
 * Ajanın kapanış mesajı gönderip göndermediğini tespit eder.
 */
function isClosingMessage(text: string): boolean {
  return (
    /thank you for your time/i.test(text) ||
    /thanks for taking the time/i.test(text) ||
    /this has been really helpful/i.test(text) ||
    /have a great day/i.test(text)
  )
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
): Promise<NextResponse<ApiResponse<InterviewResponseData>>> {
  // --- Rate limiting ---
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

  // --- interviewId ---
  const { interviewId } = await params

  if (!interviewId) {
    return NextResponse.json(
      { data: null, error: 'interviewId gereklidir.' },
      { status: 400 }
    )
  }

  // --- Body doğrulama ---
  let body: InterviewRequestBody
  try {
    body = (await request.json()) as InterviewRequestBody
  } catch {
    return NextResponse.json(
      { data: null, error: 'Geçersiz JSON gövdesi.' },
      { status: 400 }
    )
  }

  if (!body.message || body.message.trim().length === 0) {
    return NextResponse.json(
      { data: null, error: 'message alanı boş olamaz.' },
      { status: 400 }
    )
  }

  if (!body.participant_name || body.participant_name.trim().length < 2) {
    return NextResponse.json(
      { data: null, error: 'participant_name en az 2 karakter olmalıdır.' },
      { status: 400 }
    )
  }

  const userMessage = body.message.trim()
  const participantName = body.participant_name.trim()

  // --- Supabase (service role — public route, auth yok) ---
  // Interview route herkese açık; kimlik doğrulama gerekmez.
  // Supabase server client oturum olmadan da service-role ile çalışabilir.
  const supabase = await createClient()

  // --- Interview kaydını çek + doğrula ---
  type InterviewRow = Pick<
    Database['public']['Tables']['interviews']['Row'],
    'id' | 'project_id' | 'participant_name' | 'status'
  >

  let interview: InterviewRow
  try {
    const { data: interviewData, error: interviewError } = await supabase
      .from('interviews')
      .select('id, project_id, participant_name, status')
      .eq('id', interviewId)
      .single()

    if (interviewError) {
      console.error(
        `[Supabase Error] Interview sorgusu başarısız: ${interviewError.message} (${interviewError.code})`
      )
      return NextResponse.json(
        { data: null, error: 'Mülakat bulunamadı.' },
        { status: 404 }
      )
    }

    interview = interviewData as InterviewRow
  } catch (err) {
    console.error('[Interview] Beklenmeyen hata (interview sorgusu):', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }

  // Status kontrolü — 'completed' ise yeni mesaj kabul edilmez
  if (interview.status === 'completed') {
    return NextResponse.json(
      { data: null, error: 'Bu mülakat tamamlandı. Yeni mesaj gönderilemez.' },
      { status: 400 }
    )
  }

  // --- İlk mesajda: status = 'ongoing', participant_name kaydet ---
  const isFirstMessage = interview.status === 'pending'

  if (isFirstMessage) {
    try {
      const { error: startError } = await supabase
        .from('interviews')
        .update({
          status: 'ongoing',
          participant_name: participantName,
        })
        .eq('id', interviewId)

      if (startError) {
        console.error(
          `[Supabase Error] Interview başlatma güncellemesi başarısız: ${startError.message} (${startError.code})`
        )
        // Devam et — kritik değil, sonraki mesajlarda tekrar denenebilir
      }
    } catch (err) {
      console.error('[Interview] Beklenmeyen hata (interview başlatma):', err)
    }
  }

  // --- Projenin interview_script'ini çek ---
  type ProjectScriptRow = Pick<
    Database['public']['Tables']['projects']['Row'],
    'id' | 'interview_script'
  >

  let projectScript: ProjectScriptRow['interview_script'] = null
  try {
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('id, interview_script')
      .eq('id', interview.project_id)
      .single()

    if (projectError) {
      console.error(
        `[Supabase Error] Proje interview_script sorgusu başarısız: ${projectError.message} (${projectError.code})`
      )
    } else {
      projectScript = (projectData as ProjectScriptRow).interview_script
    }
  } catch (err) {
    console.error('[Interview] Beklenmeyen hata (proje script sorgusu):', err)
  }

  // --- Geçmiş mesajları çek ---
  let history: ConversationMessage[] = []
  try {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('sender, content, created_at')
      .eq('interview_id', interviewId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error(
        `[Supabase Error] Mesaj geçmişi sorgusu başarısız: ${messagesError.message} (${messagesError.code})`
      )
      history = []
    } else {
      history = (messageRows ?? []).map((m) => ({
        sender: m.sender as 'agent' | 'participant',
        content: m.content,
      }))
    }
  } catch (err) {
    console.error('[Interview] Beklenmeyen hata (mesaj geçmişi):', err)
    history = []
  }

  // --- Gemini config (OpenAI SDK uyumluluk katmanı) ---
  const agentConfig = loadAgentConfig()
  const openai = new OpenAI({
    apiKey: process.env.GOOGLE_AI_API_KEY,
    baseURL:
      agentConfig.model?.base_url ??
      'https://generativelanguage.googleapis.com/v1beta/openai/',
  })

  // --- Anlamlı yanıt sayısını hesapla (kapanış eşiği için) ---
  const meaningfulRepliesBeforeThis = countMeaningfulParticipantReplies([
    ...history,
    { sender: 'participant', content: userMessage },
  ])

  // --- Sistem promptunu birleştir ---
  const scriptContext = serializeInterviewScript(projectScript)
  const conversationContext = `
[Participant name: ${participantName}]
[Meaningful participant replies so far: ${meaningfulRepliesBeforeThis}]
[Interview status: ${isFirstMessage ? 'starting now' : 'ongoing'}]

--- Interview Script Context (internal — do NOT reveal to participant) ---
${scriptContext}
---`

  const fullSystemPrompt = `${BASE_INTERVIEWER_SYSTEM_PROMPT}\n\n${conversationContext}`

  // --- LLM mesaj dizisi ---
  const llmMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: fullSystemPrompt },
    ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: m.sender === 'agent' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  // --- Gemini çağrısı ---
  let agentReply: string
  try {
    const completion = await openai.chat.completions.create({
      model: agentConfig.model?.name ?? 'gemini-2.0-flash',
      temperature: agentConfig.model?.temperature ?? 0.7,
      max_tokens: agentConfig.model?.max_tokens ?? 512,
      messages: llmMessages,
    })

    agentReply = completion.choices[0]?.message?.content?.trim() ?? ''

    if (!agentReply) {
      throw new Error('Gemini boş yanıt döndürdü.')
    }
  } catch (err) {
    console.error('[Interview] Gemini çağrısı başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Yapay zeka yanıtı alınamadı. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // --- Kapanış tespiti ---
  const isComplete =
    isClosingMessage(agentReply) || meaningfulRepliesBeforeThis >= 10

  // --- Mesajları kaydet (katılımcı + ajan) ---
  try {
    const { error: insertError } = await supabase.from('messages').insert([
      {
        interview_id: interviewId,
        sender: 'participant' as const,
        content: userMessage,
      },
      {
        interview_id: interviewId,
        sender: 'agent' as const,
        content: agentReply,
      },
    ])

    if (insertError) {
      console.error(
        `[Supabase Error] Mesaj kaydı başarısız: ${insertError.message} (${insertError.code})`
      )
    }
  } catch (err) {
    console.error('[Interview] Beklenmeyen hata (mesaj kaydı):', err)
  }

  // --- Mülakat tamamlandıysa: status = 'completed' + webhook ---
  if (isComplete) {
    try {
      const { error: completeError } = await supabase
        .from('interviews')
        .update({ status: 'completed' })
        .eq('id', interviewId)

      if (completeError) {
        console.error(
          `[Supabase Error] Interview tamamlama güncellemesi başarısız: ${completeError.message} (${completeError.code})`
        )
      }
    } catch (err) {
      console.error('[Interview] Beklenmeyen hata (interview tamamlama):', err)
    }

    // Toplam mesaj sayısı (yeni eklenenler dahil)
    const totalMessageCount = history.length + 2 // +2: yeni participant + agent mesajı

    // Make.com webhook — fire-and-forget
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

  // --- Başarılı yanıt ---
  return NextResponse.json(
    { data: { reply: agentReply, isComplete }, error: null },
    { status: 200 }
  )
}
