import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import type { Database } from '@/types/database.types' // Pick<> için gerekli
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
// Rate limiting — authenticated route: max 20 req/min per IP
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
// PM Intake system prompt — mom-test-agent-prompts.md
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
- forbidden questions
- participant criteria

Do not generate customer interview questions until the PM context is clear.

IMPORTANT RULES:
- Ask a maximum of 8 questions total. Do not exceed this limit.
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

/**
 * openai.yaml dosyasını okur. Model ve parametre overrides sağlar.
 * Dosya okunamazsa sessizce varsayılanlara düşer.
 */
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
 * Ajan yanıtının <research_brief> bloğu içerip içermediğini kontrol eder.
 * İçeriyorsa JSON'u parse eder ve döner.
 */
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

/**
 * Geçmiş mesaj sayısı ve içeriğine bakarak intake'in tamamlanıp tamamlanmadığını
 * ya da maks soru sınırına ulaşılıp ulaşılmadığını kontrol eder.
 */
function checkCompletion(
  messages: ConversationMessage[],
  agentReply: string
): boolean {
  // Ajan yanıtında research_brief bloğu varsa tamamdır
  if (extractResearchBrief(agentReply)) return true

  // Ajanın gönderdiği mesaj sayısı (her biri bir soru sayılır)
  const agentMessageCount = messages.filter((m) => m.sender === 'agent').length
  if (agentMessageCount >= 8) return true

  return false
}

/**
 * Mevcut konuşma geçmişinden hangi intake alanlarının dolu olduğunu tespit eder.
 * OpenAI'ya ekstra context göndermek için kullanılır.
 */
function detectCompletionStatus(
  messages: ConversationMessage[]
): IntakeCompletionStatus {
  const fullText = messages.map((m) => m.content).join(' ').toLowerCase()

  return {
    hasProductIdea: fullText.length > 50, // ilk mesajda ürün fikri genellikle vardır
    hasTargetSegment:
      /segment|hedef kitle|target|kullanıcı|customer|user/.test(fullText),
    hasRiskiestAssumption:
      /risk|assumption|varsayım|kritik|problem/.test(fullText),
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<IntakeResponseData>>> {
  // --- ENV DEBUG — her istek başında ortam değişkenlerini logla ---
  console.log('[DEBUG] ENV CHECK:', {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV,
  })

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

  // --- projectId ---
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json(
      { data: null, error: 'projectId gereklidir.' },
      { status: 400 }
    )
  }

  // --- Body doğrulama ---
  let body: IntakeRequestBody
  try {
    body = (await request.json()) as IntakeRequestBody
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

  const userMessage = body.message.trim()

  // --- Supabase auth + proje doğrulama ---
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { data: null, error: 'Kimlik doğrulaması gereklidir.' },
      { status: 401 }
    )
  }

  // Projenin var olduğunu ve bu kullanıcıya ait olduğunu doğrula (RLS bunu da sağlar)
  type ProjectRow = Pick<
    Database['public']['Tables']['projects']['Row'],
    'id' | 'user_id' | 'product_idea' | 'research_brief'
  >
  let project: ProjectRow
  try {
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id, product_idea, research_brief')
      .eq('id', projectId)
      .single()

    if (projectError) {
      console.error(
        `[Supabase Error] Proje sorgusu başarısız: ${projectError.message} (${projectError.code})`
      )
      return NextResponse.json(
        { data: null, error: 'Proje bulunamadı.' },
        { status: 404 }
      )
    }

    project = projectData as ProjectRow
  } catch (err) {
    console.error('[Intake] Beklenmeyen hata (proje sorgusu):', err)
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Proje bu kullanıcıya ait mi? (RLS zaten engeller ama ekstra güvence)
  if (project.user_id !== user.id) {
    return NextResponse.json(
      { data: null, error: 'Bu projeye erişim yetkiniz yok.' },
      { status: 403 }
    )
  }

  // --- Geçmiş mesajları çek ---
  let history: ConversationMessage[] = []
  try {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('sender, content, created_at')
      .eq('interview_id', projectId) // intake sohbeti proje ID'si ile eşleşir
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error(
        `[Supabase Error] Mesaj geçmişi sorgusu başarısız: ${messagesError.message} (${messagesError.code})`
      )
      // Geçmiş alınamazsa boş başlatarak devam et
      history = []
    } else {
      history = (messageRows ?? []).map((m) => ({
        sender: m.sender as 'agent' | 'participant',
        content: m.content,
      }))
    }
  } catch (err) {
    console.error('[Intake] Beklenmeyen hata (mesaj geçmişi):', err)
    history = []
  }

  // --- LLM config ---
  const agentConfig = loadOpenAIConfig()
  console.log('[DEBUG] agentConfig:', JSON.stringify(agentConfig))

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL:
      agentConfig.model?.base_url ??
      'https://api.groq.com/openai/v1',
  })

  // --- Completion status — OpenAI'ya ek bağlam için ---
  const completionStatus = detectCompletionStatus([
    ...history,
    { sender: 'participant', content: userMessage },
  ])

  const contextNote = `
[Mevcut Durum]
- Ürün fikri alındı mı: ${completionStatus.hasProductIdea ? 'Evet' : 'Hayır'}
- Hedef segment belirlendi mi: ${completionStatus.hasTargetSegment ? 'Evet' : 'Hayır'}
- En riskli varsayım tespit edildi mi: ${completionStatus.hasRiskiestAssumption ? 'Evet' : 'Hayır'}
- Şimdiye kadar sorulmuş ajan mesajı sayısı: ${history.filter((m) => m.sender === 'agent').length}
`

  // --- OpenAI mesaj dizisini oluştur ---
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: PM_INTAKE_SYSTEM_PROMPT + '\n\n' + contextNote,
    },
    ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: m.sender === 'agent' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  // --- Groq çağrısı ---
  let agentReply: string
  try {
    const completion = await openai.chat.completions.create({
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: agentConfig.model?.temperature ?? 0.4,
      max_tokens: agentConfig.model?.max_tokens ?? 512,
      messages: openaiMessages,
    })

    agentReply = completion.choices[0]?.message?.content?.trim() ?? ''

    if (!agentReply) {
      throw new Error('Groq boş yanıt döndürdü.')
    }
  } catch (err) {
    console.error('[Intake] Groq çağrısı başarısız:', err)
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // --- Tamamlanma kontrolü ---
  const isComplete = checkCompletion(
    [...history, { sender: 'participant', content: userMessage }],
    agentReply
  )

  // --- Mesajları kaydet (kullanıcı + ajan) ---
  try {
    const { error: insertError } = await supabase.from('messages').insert([
      {
        interview_id: projectId,
        sender: 'participant' as const,
        content: userMessage,
      },
      {
        interview_id: projectId,
        sender: 'agent' as const,
        content: agentReply,
      },
    ])

    if (insertError) {
      console.error(
        `[Supabase Error] Mesaj kaydı başarısız: ${insertError.message} (${insertError.code})`
      )
      // Mesaj kaydı başarısız olsa bile yanıt dönebiliriz; loglama yeterli
    }
  } catch (err) {
    console.error('[Intake] Beklenmeyen hata (mesaj kaydı):', err)
  }

  // --- Tamamlandıysa research_brief'i kaydet ---
  if (isComplete) {
    const brief = extractResearchBrief(agentReply)

    if (brief) {
      try {
        const { error: updateError } = await supabase
          .from('projects')
          .update({ research_brief: brief })
          .eq('id', projectId)

        if (updateError) {
          console.error(
            `[Supabase Error] research_brief güncellemesi başarısız: ${updateError.message} (${updateError.code})`
          )
        }
      } catch (err) {
        console.error('[Intake] Beklenmeyen hata (research_brief güncelleme):', err)
      }
    }

    // --- Make.com webhook — fire-and-forget ---
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

  // --- Başarılı yanıt ---
  return NextResponse.json(
    { data: { reply: agentReply, isComplete }, error: null },
    { status: 200 }
  )
}
