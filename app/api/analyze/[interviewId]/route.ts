import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { interviews, projects, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import { OPENAI_MODEL } from '@/lib/llm/config'
import {
  buildAnalyzeGraph,
  buildInitialAnalyzeState,
  buildEvidenceAnalystSystemPrompt,
} from '@/lib/graphs/analyze-graph'
import type {
  ApiResponse,
  OpenAIAgentConfig,
  AnalyzeResponseData,
  AnalysisCompletedWebhookPayload,
  SignalSummary,
  InterviewLanguage,
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
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[Analyze] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
): Promise<NextResponse<ApiResponse<AnalyzeResponseData>>> {
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

  // --- Interview kaydını çek ---
  let interview: {
    id: string
    project_id: string
    participant_name: string
    status: string
  } | undefined

  try {
    const rows = await db
      .select({
        id:               interviews.id,
        project_id:       interviews.project_id,
        participant_name: interviews.participant_name,
        status:           interviews.status,
      })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1)

    interview = rows[0]
  } catch (err) {
    console.error('[Analyze] Interview sorgusu başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }

  if (!interview) {
    return NextResponse.json(
      { data: null, error: 'Mülakat bulunamadı.' },
      { status: 404 }
    )
  }

  // --- Proje varlığını doğrula + dil bilgisini çek ---
  let projectLanguage: InterviewLanguage = 'en'
  try {
    const rows = await db
      .select({ id: projects.id, language: projects.language })
      .from(projects)
      .where(eq(projects.id, interview.project_id))
      .limit(1)

    if (!rows[0]) {
      return NextResponse.json(
        { data: null, error: 'Proje bulunamadı.' },
        { status: 404 }
      )
    }

    projectLanguage = rows[0].language as InterviewLanguage
  } catch (err) {
    console.error('[Analyze] Proje sorgusu başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }

  // --- Status kontrolü: yalnızca 'completed' mülakatlar analiz edilir ---
  if (interview.status !== 'completed') {
    return NextResponse.json(
      {
        data: null,
        error: `Bu mülakat henüz tamamlanmadı. Mevcut durum: "${interview.status}". Analiz yalnızca tamamlanmış mülakatlar için yapılabilir.`,
      },
      { status: 400 }
    )
  }

  // --- Tüm mesajları çek (ID dahil) ---
  let messageRows: { id: string; sender: string; content: string; created_at: Date }[] = []

  try {
    messageRows = await db
      .select({
        id:         messages.id,
        sender:     messages.sender,
        content:    messages.content,
        created_at: messages.created_at,
      })
      .from(messages)
      .where(eq(messages.interview_id, interviewId))
      .orderBy(asc(messages.created_at))
  } catch (err) {
    console.error('[Analyze] Mesaj sorgusu başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Mesajlar alınamadı.' },
      { status: 500 }
    )
  }

  if (messageRows.length === 0) {
    return NextResponse.json(
      { data: null, error: 'Bu mülakata ait mesaj bulunamadı.' },
      { status: 400 }
    )
  }

  // --- Transcript oluştur — her satıra message_id eklenir (LLM referans için) ---
  const transcript = messageRows
    .map((m) => {
      const role = m.sender === 'agent' ? 'Interviewer' : 'Participant'
      return `[${m.id}] ${role}: ${m.content}`
    })
    .join('\n')

  // --- Agent config ---
  const agentConfig = loadAgentConfig()
  const openai = new OpenAI({
    apiKey:   process.env.OPENAI_API_KEY,
    baseURL:  agentConfig.model?.base_url ?? 'https://api.openai.com/v1',
  })

  // ---------------------------------------------------------------------------
  // ADIM 1: İlk LLM çağrısı — ham analiz çıktısını al
  // Parse / validate / grounding / consistency / db-save → graph'ta yönetilir
  // ---------------------------------------------------------------------------

  let rawAnalysisOutput: string
  try {
    const completion = await openai.chat.completions.create({
      model:       OPENAI_MODEL,
      temperature: 0.2,
      max_tokens:  agentConfig.model?.max_tokens ?? 2048,
      messages: [
        { role: 'system', content: buildEvidenceAnalystSystemPrompt(projectLanguage) },
        {
          role: 'user',
          content: `Participant name: ${interview.participant_name}\n\nInterview transcript:\n${transcript}`,
        },
      ],
    })

    rawAnalysisOutput = completion.choices[0]?.message?.content?.trim() ?? ''

    if (!rawAnalysisOutput) {
      throw new Error('LLM boş yanıt döndürdü.')
    }
  } catch (err) {
    console.error('[Analyze] LLM çağrısı başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Yapay zeka analizi başarısız oldu. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // ---------------------------------------------------------------------------
  // ADIM 2+: Graph — parse → validate → retry → grounding → consistency → db
  // ---------------------------------------------------------------------------

  const groundingMessages = messageRows.map((m) => ({ id: m.id, content: m.content }))

  const graph        = buildAnalyzeGraph(agentConfig, projectLanguage)
  const initialState = buildInitialAnalyzeState(
    interviewId,
    interview.project_id,
    interview.participant_name,
    transcript,
    groundingMessages,
    rawAnalysisOutput
  )

  const finalState = await graph.invoke(initialState)

  // Graph analiz üretemedi
  if (!finalState.parsedAnalysis) {
    return NextResponse.json(
      { data: null, error: 'Analiz sonucu işlenemedi. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // --- Make.com webhook — fire-and-forget ---
  const webhookUrl = process.env.MAKE_WEBHOOK_ANALYSIS_URL
  if (webhookUrl && finalState.signalSummary) {
    const webhookPayload: AnalysisCompletedWebhookPayload = {
      event:            'analysis_completed',
      interview_id:     interviewId,
      project_id:       interview.project_id,
      participant_name: interview.participant_name,
      signal_summary:   finalState.signalSummary as SignalSummary,
      decision:         finalState.parsedAnalysis.decision,
      analyzed_at:      new Date().toISOString(),
    }

    void (async () => {
      try {
        await fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(webhookPayload),
        })
      } catch (err) {
        console.error('[Analyze] Make.com webhook gönderilemedi:', err)
      }
    })()
  }

  // --- Başarılı yanıt ---
  return NextResponse.json(
    {
      data: {
        decision:           finalState.parsedAnalysis.decision,
        signalSummary:      finalState.signalSummary as SignalSummary,
        evidenceReportSaved: finalState.evidenceReportSaved,
        signalScoreSaved:   finalState.signalScoreSaved,
      },
      error: null,
    },
    { status: 200 }
  )
}
