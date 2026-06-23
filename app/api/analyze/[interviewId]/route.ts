import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import type { Database } from '@/types/database.types'
import type {
  ApiResponse,
  OpenAIAgentConfig,
  AnalyzeResponseData,
  AnalysisCompletedWebhookPayload,
  SignalScore,
  SignalSummary,
  StructuredAnalysis,
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
// Evidence Analyst system prompt — SKILL.md Skill 6 + evidence-rubric.md
// ---------------------------------------------------------------------------

const EVIDENCE_ANALYST_SYSTEM_PROMPT = `You are a strict customer-discovery analyst trained in Mom Test principles.

## Your job
Analyze the interview transcript and separate evidence from noise. Classify every participant signal. Produce a structured JSON analysis object.

## Evidence classification rules (from evidence-rubric.md)

### Strong evidence — count only when participant gives:
- A recent specific example
- Repeated occurrence
- Named tools or people in the workflow
- A workaround they currently maintain
- Money already spent
- Time regularly spent
- Reputation or operational risk
- Active search for alternatives
- Introduction to another stakeholder
- Pilot, preorder, deposit, or scheduled next step

### Medium evidence — plausible problem but lacks:
- Proof of urgency, cost, workaround, or commitment

### Weak evidence — treat as noise:
- Praise or compliments
- Opinions
- Hypotheticals ("I would...", "I think...", "probably...")
- Feature suggestions
- Future-tense promises
- Unsupported willingness to pay
- Generic claims ("usually", "always", "never")

### Negative evidence — red flags:
- Cannot remember a recent example
- Does not currently solve the problem
- Problem has no meaningful cost
- Workaround is good enough
- Not the buyer or user
- Unreachable as a segment
- Resists any concrete next step

## Decision criteria
- "continue discovery": strong evidence of problem but not yet enough for commitment test
- "test commitment": strong problem evidence + urgency + some budget signal
- "change segment": wrong participant, no pain, or negative evidence dominates
- "stop": no problem, no urgency, no workaround, nothing to learn
- "build narrow prototype": strong evidence across problem + frequency + workaround + budget dimensions

## Output format
Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

{
  "decision": "continue discovery | test commitment | change segment | stop | build narrow prototype",
  "summary": "2-3 sentence plain-language summary of what was learned",
  "signalScore": {
    "problemEvidence": "strong | medium | weak | negative",
    "urgency": "strong | medium | weak | negative",
    "workaroundEvidence": "strong | medium | weak | negative",
    "budgetOrCommitment": "strong | medium | weak | negative"
  },
  "strongEvidence": [
    { "quote": "exact or close paraphrase from participant", "message_id": "msg-uuid", "whyItMatters": "behavioral reason" }
  ],
  "mediumEvidence": [
    { "quote": "...", "message_id": "msg-uuid", "context": "why this is medium not strong" }
  ],
  "weakEvidence": [
    { "quote": "...", "message_id": "msg-uuid", "whyItIsWeak": "compliment/hypothetical/opinion/etc." }
  ],
  "negativeEvidence": [
    "plain description of what suggests the idea may be wrong"
  ],
  "openQuestions": [
    "next important unknown 1",
    "next important unknown 2",
    "next important unknown 3"
  ],
  "recommendedNextStep": "one concrete action"
}

Rules:
- Use the exact message_id provided in the transcript for each signal.
- Do not invent quotes. Use close paraphrases if exact quotes are long.
- Do not count agent questions as evidence — only participant answers matter.
- If the transcript is too short to analyze, set decision to "change segment" and explain in summary.`

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

/**
 * LLM çıktısını JSON'a parse eder.
 * Model bazen ```json ... ``` fence ekleyebilir — temizlenir.
 */
function parseJsonOutput<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch {
    console.error('[Analyze] JSON parse hatası. Ham çıktı:', raw.slice(0, 300))
    return null
  }
}

/**
 * StructuredAnalysis çıktısından SignalScore JSONB yapısını türetir.
 */
function buildSignalScore(analysis: StructuredAnalysis): SignalScore {
  return {
    strong: analysis.strongEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
    })),
    medium: analysis.mediumEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
    })),
    weak: analysis.weakEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
    })),
    negative: analysis.negativeEvidence.map((desc) => ({
      quote: desc,
      message_id: '',
    })),
  }
}

/**
 * StructuredAnalysis çıktısından SignalSummary sayım bilgisini türetir.
 */
function buildSignalSummary(analysis: StructuredAnalysis): SignalSummary {
  return {
    strong_count: analysis.strongEvidence.length,
    medium_count: analysis.mediumEvidence.length,
    weak_count: analysis.weakEvidence.length,
    negative_count: analysis.negativeEvidence.length,
  }
}

/**
 * SKILL.md Skill 6 Evidence Report şablonuna göre Markdown rapor üretir.
 */
function buildMarkdownReport(
  analysis: StructuredAnalysis,
  participantName: string
): string {
  const lines: string[] = []

  lines.push('# Mom Test Evidence Report')
  lines.push('')
  lines.push(`**Participant:** ${participantName}`)
  lines.push('')
  lines.push('## Decision')
  lines.push(analysis.decision)
  lines.push('')
  lines.push('## Summary')
  lines.push(analysis.summary)
  lines.push('')
  lines.push('## Signal score')
  lines.push(`- problem evidence: ${analysis.signalScore.problemEvidence}`)
  lines.push(`- urgency: ${analysis.signalScore.urgency}`)
  lines.push(`- workaround evidence: ${analysis.signalScore.workaroundEvidence}`)
  lines.push(`- budget or commitment: ${analysis.signalScore.budgetOrCommitment}`)
  lines.push('')

  if (analysis.strongEvidence.length > 0) {
    lines.push('## Strong evidence')
    lines.push('| Quote or observation | Why it matters |')
    lines.push('|---|---|')
    analysis.strongEvidence.forEach((e) => {
      lines.push(`| ${e.quote} | ${e.whyItMatters} |`)
    })
    lines.push('')
  }

  if (analysis.weakEvidence.length > 0) {
    lines.push('## Weak or misleading evidence')
    lines.push('| Quote or observation | Why it is weak |')
    lines.push('|---|---|')
    analysis.weakEvidence.forEach((e) => {
      lines.push(`| ${e.quote} | ${e.whyItIsWeak} |`)
    })
    lines.push('')
  }

  if (analysis.negativeEvidence.length > 0) {
    lines.push('## Negative evidence')
    analysis.negativeEvidence.forEach((desc) => {
      lines.push(`- ${desc}`)
    })
    lines.push('')
  }

  if (analysis.openQuestions.length > 0) {
    lines.push('## Open questions')
    analysis.openQuestions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q}`)
    })
    lines.push('')
  }

  lines.push('## Recommended next step')
  lines.push(analysis.recommendedNextStep)

  return lines.join('\n')
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

  // --- Supabase auth ---
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

  // --- Interview kaydını çek ---
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
    console.error('[Analyze] Beklenmeyen hata (interview sorgusu):', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }

  // --- Sahiplik doğrulama — projenin bu kullanıcıya ait olduğunu kontrol et ---
  try {
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', interview.project_id)
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

    if (projectData.user_id !== user.id) {
      return NextResponse.json(
        { data: null, error: 'Bu mülakata erişim yetkiniz yok.' },
        { status: 403 }
      )
    }
  } catch (err) {
    console.error('[Analyze] Beklenmeyen hata (proje sahiplik sorgusu):', err)
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
  type MessageRow = Pick<
    Database['public']['Tables']['messages']['Row'],
    'id' | 'sender' | 'content' | 'created_at'
  >

  let messages: MessageRow[] = []
  try {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, sender, content, created_at')
      .eq('interview_id', interviewId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error(
        `[Supabase Error] Mesaj geçmişi sorgusu başarısız: ${messagesError.message} (${messagesError.code})`
      )
      return NextResponse.json(
        { data: null, error: 'Mesajlar alınamadı.' },
        { status: 500 }
      )
    }

    messages = (messageRows ?? []) as MessageRow[]
  } catch (err) {
    console.error('[Analyze] Beklenmeyen hata (mesaj sorgusu):', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }

  if (messages.length === 0) {
    return NextResponse.json(
      { data: null, error: 'Bu mülakata ait mesaj bulunamadı.' },
      { status: 400 }
    )
  }

  // --- Transcript oluştur — her satıra message_id eklenir (LLM referans için) ---
  const transcript = messages
    .map((m) => {
      const role = m.sender === 'agent' ? 'Interviewer' : 'Participant'
      return `[${m.id}] ${role}: ${m.content}`
    })
    .join('\n')

  // --- Gemini config ---
  const agentConfig = loadAgentConfig()
  const openai = new OpenAI({
    apiKey: process.env.GOOGLE_AI_API_KEY,
    baseURL:
      agentConfig.model?.base_url ??
      'https://api.groq.com/openai/v1',
  })

  // --- Gemini çağrısı ---
  let rawAnalysis: string
  try {
    const completion = await openai.chat.completions.create({
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      // Analiz için daha düşük temperature: deterministik sınıflandırma
      temperature: 0.2,
      max_tokens: agentConfig.model?.max_tokens ?? 2048,
      messages: [
        { role: 'system', content: EVIDENCE_ANALYST_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Participant name: ${interview.participant_name}\n\nInterview transcript:\n${transcript}`,
        },
      ],
    })

    rawAnalysis = completion.choices[0]?.message?.content?.trim() ?? ''

    if (!rawAnalysis) {
      throw new Error('Gemini boş yanıt döndürdü.')
    }
  } catch (err) {
    console.error('[Analyze] Gemini çağrısı başarısız:', err)
    return NextResponse.json(
      { data: null, error: 'Yapay zeka analizi başarısız oldu. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // --- Analiz çıktısını parse et ---
  const analysis = parseJsonOutput<StructuredAnalysis>(rawAnalysis)

  if (!analysis) {
    return NextResponse.json(
      { data: null, error: 'Analiz sonucu işlenemedi. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }

  // --- JSONB yapılarını türet ---
  const signalScore = buildSignalScore(analysis)
  const signalSummary = buildSignalSummary(analysis)
  const markdownReport = buildMarkdownReport(analysis, interview.participant_name)

  // --- interviews.signal_score + evidence_report kaydet ---
  let signalScoreSaved = false
  let evidenceReportSaved = false

  try {
    const { error: interviewUpdateError } = await supabase
      .from('interviews')
      .update({
        signal_score: signalScore,
        evidence_report: markdownReport,
      })
      .eq('id', interviewId)

    if (interviewUpdateError) {
      console.error(
        `[Supabase Error] Interview güncelleme başarısız: ${interviewUpdateError.message} (${interviewUpdateError.code})`
      )
    } else {
      signalScoreSaved = true
      evidenceReportSaved = true
    }
  } catch (err) {
    console.error('[Analyze] Beklenmeyen hata (interview güncelleme):', err)
  }


  // --- Make.com webhook — fire-and-forget ---
  const webhookUrl = process.env.MAKE_WEBHOOK_ANALYSIS_URL
  if (webhookUrl) {
    const payload: AnalysisCompletedWebhookPayload = {
      event: 'analysis_completed',
      interview_id: interviewId,
      project_id: interview.project_id,
      participant_name: interview.participant_name,
      signal_summary: signalSummary,
      decision: analysis.decision,
      analyzed_at: new Date().toISOString(),
    }

    void (async () => {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
        decision: analysis.decision,
        signalSummary,
        evidenceReportSaved,
        signalScoreSaved,
      },
      error: null,
    },
    { status: 200 }
  )
}
