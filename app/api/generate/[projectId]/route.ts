import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { Database } from '@/types/database.types'
import type {
  OpenAIAgentConfig,
  ConversationMessage,
  FullResearchBrief,
  InterviewScript,
  GenerateStreamChunk,
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
// System prompts
// ---------------------------------------------------------------------------

/**
 * SKILL.md Skill 2 — Assumption Mapping
 * Intake mesajlarından yapılandırılmış Research Brief + Assumption Map üretir.
 */
const RESEARCH_BRIEF_SYSTEM_PROMPT = `You are a customer discovery architect trained in Mom Test principles.

You will receive a PM intake conversation. Your task is to produce a structured Research Brief and Assumption Map.

Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

Output format:
{
  "productIdea": "one sentence",
  "targetCustomer": "who-where segment",
  "coreSituation": "when the problem appears",
  "currentBelief": "what the PM believes is true",
  "riskiestAssumption": "the assumption most likely to kill the idea",
  "interviewObjective": "what the interview must learn",
  "evidenceNeeded": {
    "strong": "behavior or commitment that confirms the assumption",
    "weak": "compliment, opinion, or hypothetical",
    "negative": "no pain, no workaround, no urgency"
  },
  "participantCriteria": {
    "mustHave": ["criterion 1", "criterion 2"],
    "avoid": ["avoid 1", "avoid 2"]
  },
  "forbiddenQuestions": ["leading question 1", "pitchy question 2"],
  "assumptionMap": [
    {
      "assumption": "the belief being tested",
      "riskLevel": "high",
      "whatToAskAbout": "topic area",
      "strongEvidence": "concrete behavior that confirms",
      "weakEvidence": "vague claim or compliment"
    }
  ]
}

Assumption categories to cover: Problem, Frequency, Urgency, Workaround, Budget, Buyer/User split, Channel, Switching.
Risk levels: high, medium, low. Include at least 4 assumptions.`

/**
 * SKILL.md Skill 3 — Question Design
 * Research Brief + question-bank.md kalıplarından yönlendirici OLMAYAN Interview Script üretir.
 */
const INTERVIEW_SCRIPT_SYSTEM_PROMPT = `You are a customer discovery interview designer trained in Mom Test principles.

You will receive a Research Brief (JSON). Your task is to produce a structured Interview Script.

Core rules (NEVER violate):
- Do NOT pitch the product, mention the solution, or ask for opinions about the idea.
- Do NOT use banned patterns: "would you use", "do you like", "would you pay", "is this interesting", "should we build", "do you think this is a good idea", "could you imagine using this".
- Ask about PAST behavior and real examples, not future intentions.
- Ask one question at a time.
- Follow the default sequence: context → recent example → workflow → workaround → cost/frequency → alternatives → commitment history → close.

Good question patterns to draw from:
- Tell me about the last time this happened.
- Walk me through how you handled it.
- What did you do next?
- What tools or people were involved?
- What made that difficult?
- How often does this happen?
- What does it cost you in time, money, risk, or frustration?
- What have you tried already?
- Why did or didn't that solution work?
- Who else is involved in this decision?
- Where does the budget or approval come from?
- Who else should I talk to?
- Is there anything important I failed to ask?

Question bank categories: situation discovery, workflow discovery, workaround discovery, cost and urgency, budget and commitment, closing.

Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

Output format:
{
  "goal": "learning goal for this script",
  "rulesForInterviewer": [
    "do not pitch the product",
    "ask one question at a time",
    "ask for past examples",
    "redirect compliments to behavior",
    "probe vague answers"
  ],
  "questions": [
    {
      "order": 1,
      "question": "the interview question",
      "signalSought": "problem/frequency/workaround/budget/switching/etc.",
      "whyItPasses": "reason this question follows Mom Test rules"
    }
  ]
}

Generate 8-10 questions that cover the riskiest assumptions from the Research Brief.`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadOpenAIConfig(): Partial<OpenAIAgentConfig> {
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
    console.warn('[Generate] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

/**
 * SSE formatında bir chunk yazar.
 * Chunk: `data: <JSON>\n\n`
 */
function encodeChunk(chunk: GenerateStreamChunk): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
}

/**
 * Streaming OpenAI yanıtını toplar ve tam string olarak döner.
 * Aynı zamanda her delta'yı SSE controller'a yazar.
 */
async function streamAndCollect(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  controller: ReadableStreamDefaultController,
  stage: GenerateStreamChunk['stage']
): Promise<string> {
  let fullContent = ''

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ''
    if (delta) {
      fullContent += delta
      controller.enqueue(
        encodeChunk({ stage, content: delta })
      )
    }
  }

  return fullContent
}

/**
 * Toplanan LLM çıktısını JSON'a parse eder.
 * LLM bazen ```json ... ``` fence ekleyebilir — temizlenir.
 */
function parseJsonOutput<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch {
    console.error('[Generate] JSON parse hatası. Ham çıktı:', raw.slice(0, 200))
    return null
  }
}

// ---------------------------------------------------------------------------
// POST handler — Streaming
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  // --- Rate limiting ---
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ data: null, error: 'Çok fazla istek gönderildi. Lütfen bir dakika bekleyin.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- projectId ---
  const { projectId } = await params

  if (!projectId) {
    return new Response(
      JSON.stringify({ data: null, error: 'projectId gereklidir.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Supabase auth ---
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return new Response(
      JSON.stringify({ data: null, error: 'Kimlik doğrulaması gereklidir.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Proje doğrulama ---
  type ProjectRow = Pick<
    Database['public']['Tables']['projects']['Row'],
    'id' | 'user_id' | 'product_idea'
  >

  let project: ProjectRow
  try {
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id, product_idea')
      .eq('id', projectId)
      .single()

    if (projectError) {
      console.error(
        `[Supabase Error] Proje sorgusu başarısız: ${projectError.message} (${projectError.code})`
      )
      return new Response(
        JSON.stringify({ data: null, error: 'Proje bulunamadı.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    project = projectData as ProjectRow
  } catch (err) {
    console.error('[Generate] Beklenmeyen hata (proje sorgusu):', err)
    return new Response(
      JSON.stringify({ data: null, error: 'Sunucu hatası.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (project.user_id !== user.id) {
    return new Response(
      JSON.stringify({ data: null, error: 'Bu projeye erişim yetkiniz yok.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Intake mesajlarını çek ---
  let intakeMessages: ConversationMessage[] = []
  try {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('sender, content, created_at')
      .eq('interview_id', projectId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error(
        `[Supabase Error] Intake mesajları sorgusu başarısız: ${messagesError.message} (${messagesError.code})`
      )
    } else {
      intakeMessages = (messageRows ?? []).map((m) => ({
        sender: m.sender as 'agent' | 'participant',
        content: m.content,
      }))
    }
  } catch (err) {
    console.error('[Generate] Beklenmeyen hata (mesaj sorgusu):', err)
  }

  if (intakeMessages.length === 0) {
    return new Response(
      JSON.stringify({ data: null, error: 'Bu proje için tamamlanmış intake mesajı bulunamadı.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Gemini config (OpenAI SDK uyumluluk katmanı) ---
  const agentConfig = loadOpenAIConfig()
  const openai = new OpenAI({
    apiKey: process.env.GOOGLE_AI_API_KEY,
    baseURL:
      agentConfig.model?.base_url ??
      'https://generativelanguage.googleapis.com/v1beta/openai/',
  })

  // Intake konuşmasını tek string'e çevir (LLM bağlamı için)
  const intakeTranscript = intakeMessages
    .map((m) => `${m.sender === 'agent' ? 'Discovery Architect' : 'PM'}: ${m.content}`)
    .join('\n')

  // ---------------------------------------------------------------------------
  // Streaming response — ReadableStream
  // ---------------------------------------------------------------------------

  const stream = new ReadableStream({
    async start(controller) {
      let rawBriefOutput = ''
      let rawScriptOutput = ''

      try {
        // ----------------------------------------------------------------
        // ADIM 1: Research Brief (Skill 2)
        // ----------------------------------------------------------------
        const briefStream = await openai.chat.completions.create({
          model: agentConfig.model?.name ?? 'gemini-2.0-flash',
          temperature: agentConfig.model?.temperature ?? 0.3,
          max_tokens: agentConfig.model?.max_tokens ?? 1500,
          stream: true,
          messages: [
            { role: 'system', content: RESEARCH_BRIEF_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Product idea: ${project.product_idea}\n\nIntake conversation:\n${intakeTranscript}`,
            },
          ],
        })

        rawBriefOutput = await streamAndCollect(briefStream, controller, 'research_brief')

        // Brief'i parse et
        const parsedBrief = parseJsonOutput<FullResearchBrief>(rawBriefOutput)

        // Supabase'e kaydet
        if (parsedBrief) {
          try {
            const { error: briefUpdateError } = await supabase
              .from('projects')
              .update({ research_brief: parsedBrief })
              .eq('id', projectId)

            if (briefUpdateError) {
              console.error(
                `[Supabase Error] research_brief kaydı başarısız: ${briefUpdateError.message} (${briefUpdateError.code})`
              )
            }
          } catch (err) {
            console.error('[Generate] Beklenmeyen hata (research_brief kayıt):', err)
          }
        }

        // ----------------------------------------------------------------
        // ADIM 2: Interview Script (Skill 3)
        // ----------------------------------------------------------------
        const scriptStream = await openai.chat.completions.create({
          model: agentConfig.model?.name ?? 'gemini-2.0-flash',
          temperature: agentConfig.model?.temperature ?? 0.4,
          max_tokens: agentConfig.model?.max_tokens ?? 2000,
          stream: true,
          messages: [
            { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Research Brief:\n${rawBriefOutput}\n\nProduct idea: ${project.product_idea}`,
            },
          ],
        })

        rawScriptOutput = await streamAndCollect(scriptStream, controller, 'interview_script')

        // Script'i parse et
        const parsedScript = parseJsonOutput<InterviewScript>(rawScriptOutput)

        // Supabase'e kaydet
        if (parsedScript) {
          try {
            const { error: scriptUpdateError } = await supabase
              .from('projects')
              .update({ interview_script: parsedScript })
              .eq('id', projectId)

            if (scriptUpdateError) {
              console.error(
                `[Supabase Error] interview_script kaydı başarısız: ${scriptUpdateError.message} (${scriptUpdateError.code})`
              )
            }
          } catch (err) {
            console.error('[Generate] Beklenmeyen hata (interview_script kayıt):', err)
          }
        }

        // ----------------------------------------------------------------
        // Make.com webhook — fire-and-forget
        // ----------------------------------------------------------------
        const webhookUrl = process.env.MAKE_WEBHOOK_ANALYSIS_URL
        if (webhookUrl) {
          void (async () => {
            try {
              await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, event: 'generate_complete' }),
              })
            } catch (err) {
              console.error('[Generate] Make.com webhook gönderilemedi:', err)
            }
          })()
        }

        // ----------------------------------------------------------------
        // Done chunk
        // ----------------------------------------------------------------
        controller.enqueue(
          encodeChunk({
            stage: 'done',
            content: JSON.stringify({
              researchBriefSaved: parsedBrief !== null,
              interviewScriptSaved: parsedScript !== null,
            }),
          })
        )
      } catch (err) {
        console.error('[Generate] Stream sırasında hata:', err)
        controller.enqueue(
          encodeChunk({
            stage: 'error',
            content: 'Üretim sırasında bir hata oluştu.',
          })
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx proxy buffering'i devre dışı bırakır
    },
  })
}
