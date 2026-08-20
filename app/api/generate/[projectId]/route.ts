import { NextRequest } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import { buildGenerateGraph, buildInitialGenerateState } from '@/lib/graphs/generate-graph'
import type {
  OpenAIAgentConfig,
  ConversationMessage,
  GenerateStreamChunk,
} from '@/types/index'
import {
  shouldUseMockLLM,
  getMockGeneratePayload,
} from '@/lib/llm/mock'

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
// System prompts — streaming LLM çağrıları için (validate/retry graph'ta)
// ---------------------------------------------------------------------------

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

const INTERVIEW_SCRIPT_SYSTEM_PROMPT = `You are a customer discovery interview designer trained in Mom Test principles.

You will receive a Research Brief (JSON). Your task is to produce a structured Interview Script.

Core rules (NEVER violate):
- Do NOT pitch the product, mention the solution, or ask for opinions about the idea.
- Do NOT use banned patterns: "would you use", "do you like", "would you pay", "is this interesting", "should we build", "do you think this is a good idea", "could you imagine using this".
- Ask about PAST behavior and real examples, not future intentions.
- Ask one question at a time.
- Follow the default sequence: context → recent example → workflow → workaround → cost/frequency → alternatives → commitment history → close.

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
    const yamlPath = path.join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml')
    const raw = fs.readFileSync(yamlPath, 'utf-8')
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[Generate] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

function encodeChunk(chunk: GenerateStreamChunk): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
}

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
      controller.enqueue(encodeChunk({ stage, content: delta }))
    }
  }
  return fullContent
}

// ---------------------------------------------------------------------------
// POST handler — Streaming
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
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

  const { projectId } = await params

  if (!projectId) {
    return new Response(
      JSON.stringify({ data: null, error: 'projectId gereklidir.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Proje doğrulama ---
  let project: { id: string; product_idea: string } | undefined
  try {
    const rows = await db
      .select({ id: projects.id, product_idea: projects.product_idea })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    project = rows[0]
  } catch (err) {
    console.error('[Generate] Proje sorgusu başarısız:', err)
    return new Response(
      JSON.stringify({ data: null, error: 'Sunucu hatası.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!project) {
    return new Response(
      JSON.stringify({ data: null, error: 'Proje bulunamadı.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // --- Intake mesajlarını çek ---
  let intakeMessages: ConversationMessage[] = []
  try {
    const rows = await db
      .select({ sender: messages.sender, content: messages.content })
      .from(messages)
      .where(eq(messages.interview_id, projectId))
      .orderBy(asc(messages.created_at))

    intakeMessages = rows.map((m) => ({
      sender: m.sender as 'agent' | 'participant',
      content: m.content,
    }))
  } catch (err) {
    console.error('[Generate] Mesaj sorgusu başarısız:', err)
  }

  if (intakeMessages.length === 0) {
    return new Response(
      JSON.stringify({ data: null, error: 'Bu proje için tamamlanmış intake mesajı bulunamadı.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (shouldUseMockLLM()) {
    const payload = getMockGeneratePayload(project.product_idea)

    const stream = new ReadableStream({
      start(controller) {
        const mockText = JSON.stringify(payload)
        const chunk = new TextEncoder().encode(`data: ${JSON.stringify({ stage: 'brief', content: mockText })}\n\n`)
        controller.enqueue(chunk)
        controller.close()
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    })
  }

  const agentConfig = loadOpenAIConfig()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const intakeTranscript = intakeMessages
    .map((m) => `${m.sender === 'agent' ? 'Discovery Architect' : 'PM'}: ${m.content}`)
    .join('\n')

  // ---------------------------------------------------------------------------
  // Streaming ReadableStream
  //
  // ADIM 1 & 2: Brief + Script token akışı burada kalır (streaming korunur).
  // ADIM 3+  : validate / retry / critique / db-save → buildGenerateGraph ile yönetilir.
  // ---------------------------------------------------------------------------

  const readableStream = new ReadableStream({
    async start(controller) {
      let rawBriefOutput  = ''
      let rawScriptOutput = ''

      try {
        // ── ADIM 1: Research Brief streaming ──────────────────────────────────
        const briefStream = await openai.chat.completions.create({
          model:       agentConfig.model?.name ?? 'gemini-flash-latest',
          temperature: agentConfig.model?.temperature ?? 0.3,
          max_tokens:  agentConfig.model?.max_tokens ?? 1500,
          stream:      true,
          messages: [
            { role: 'system', content: RESEARCH_BRIEF_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Product idea: ${project.product_idea}\n\nIntake conversation:\n${intakeTranscript}`,
            },
          ],
        })

        rawBriefOutput = await streamAndCollect(briefStream, controller, 'research_brief')

        // ── ADIM 2: Interview Script streaming ────────────────────────────────
        const scriptStream = await openai.chat.completions.create({
          model:       agentConfig.model?.name ?? 'gemini-flash-latest',
          temperature: agentConfig.model?.temperature ?? 0.4,
          max_tokens:  agentConfig.model?.max_tokens ?? 2000,
          stream:      true,
          messages: [
            { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Research Brief:\n${rawBriefOutput}\n\nProduct idea: ${project.product_idea}`,
            },
          ],
        })

        rawScriptOutput = await streamAndCollect(scriptStream, controller, 'interview_script')

        // ── ADIM 3+: Graph — validate / retry / critique / db-save ────────────
        // Streaming tamamlandı. Ham çıktılar graph'a enjekte edilir.
        // Graph içinde tüm parse/validate/retry/critique/db mantığı çalışır.
        controller.enqueue(encodeChunk({ stage: 'critique', content: 'Tutarlılık kontrol ediliyor...' }))

        const graph = buildGenerateGraph(agentConfig)
        const initialState = buildInitialGenerateState(
          projectId,
          project.product_idea,
          intakeTranscript,
          rawBriefOutput,
          rawScriptOutput
        )

        const finalState = await graph.invoke(initialState)

        // Coverage retry olduysa kullanıcıya bildir
        if (finalState.scriptCritiqueRetryCount > 0) {
          controller.enqueue(
            encodeChunk({
              stage:   'interview_script',
              content: 'Script eksik kapsam nedeniyle yeniden üretildi.',
            })
          )
        }

        // Make.com webhook — fire-and-forget
        const webhookUrl = process.env.MAKE_WEBHOOK_ANALYSIS_URL
        if (webhookUrl) {
          void (async () => {
            try {
              await fetch(webhookUrl, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ projectId, event: 'generate_complete' }),
              })
            } catch (err) {
              console.error('[Generate] Make.com webhook gönderilemedi:', err)
            }
          })()
        }

        controller.enqueue(
          encodeChunk({
            stage:   'done',
            content: JSON.stringify({
              researchBriefSaved:   finalState.researchBriefSaved,
              interviewScriptSaved: finalState.interviewScriptSaved,
            }),
          })
        )
      } catch (err) {
        console.error('[Generate] Stream sırasında hata:', err)
        controller.enqueue(encodeChunk({ stage: 'error', content: 'Üretim sırasında bir hata oluştu.' }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readableStream, {
    status: 200,
    headers: {
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache, no-transform',
      Connection:        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
