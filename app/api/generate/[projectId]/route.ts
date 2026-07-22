import { NextRequest } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { load as yamlLoad } from 'js-yaml'
import { callWithJsonRetry, parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateFullResearchBrief, validateInterviewScript } from '@/lib/ai-guards/brief-validator'
import { validateScriptCritique } from '@/lib/ai-guards/script-critique-validator'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'
import type {
  OpenAIAgentConfig,
  ConversationMessage,
  FullResearchBrief,
  InterviewScript,
  ScriptCritique,
  GenerateStreamChunk,
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
// System prompts
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

const SCRIPT_CRITIQUE_SYSTEM_PROMPT = `You are a critic evaluating whether an Interview Script truly tests the Research Brief's riskiest assumption and the assumption map.

You will receive a Research Brief JSON object and an Interview Script JSON object. Your task is to decide whether brief.riskiestAssumption and each assumptionMap row are covered by at least one question in script.questions.

Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

Output format:
{
  "alignmentScore": 0,
  "missingCoverage": ["assumption text or assumption map description not covered by any question"]
}

Consider every assumptionMap row individually. If a question does not clearly test the assumption, mark it as missing coverage. Score alignment from 0 to 100 based on how well the script covers the riskiest assumption and assumption map rows.`

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
  // ---------------------------------------------------------------------------

  const stream = new ReadableStream({
    async start(controller) {
      let rawBriefOutput = ''
      let rawScriptOutput = ''

      try {
        // ADIM 1: Research Brief
        const briefStream = await openai.chat.completions.create({
          model: agentConfig.model?.name ?? 'gemini-flash-latest',
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

        // --- ADIM 1: parse + validate + retry (stream UI zaten bitti) ---
        let parsedBrief: FullResearchBrief | null = parseAndClean<FullResearchBrief>(rawBriefOutput)

        if (parsedBrief !== null) {
          // Parse başarılı — validation yap, fail ederse retry
          const briefValidation = validateFullResearchBrief(parsedBrief)
          if (!briefValidation.ok) {
            console.warn('[Generate/brief] İlk çıktı validation\'ı geçemedi, retry başlıyor. Issues:', briefValidation.issues)
            parsedBrief = await callWithJsonRetry<FullResearchBrief>(
              openai,
              {
                model: agentConfig.model?.name ?? 'gemini-flash-latest',
                temperature: agentConfig.model?.temperature ?? 0.3,
                max_tokens: agentConfig.model?.max_tokens ?? 1500,
                stream: false,
                messages: [
                  { role: 'system', content: RESEARCH_BRIEF_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: `Product idea: ${project.product_idea}\n\nIntake conversation:\n${intakeTranscript}`,
                  },
                ],
              },
              validateFullResearchBrief,
              '[Generate/brief]'
            )
          }
        } else {
          // Parse başarısız — retry hem parse hem validate için
          console.warn('[Generate/brief] İlk çıktı JSON parse edilemedi, retry başlıyor.')
          parsedBrief = await callWithJsonRetry<FullResearchBrief>(
            openai,
            {
              model: agentConfig.model?.name ?? 'gemini-flash-latest',
              temperature: agentConfig.model?.temperature ?? 0.3,
              max_tokens: agentConfig.model?.max_tokens ?? 1500,
              stream: false,
              messages: [
                { role: 'system', content: RESEARCH_BRIEF_SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: `Product idea: ${project.product_idea}\n\nIntake conversation:\n${intakeTranscript}`,
                },
              ],
            },
            validateFullResearchBrief,
            '[Generate/brief]'
          )
        }

        if (parsedBrief) {
          try {
            await db
              .update(projects)
              .set({ research_brief: parsedBrief, updated_at: new Date() })
              .where(eq(projects.id, projectId))
          } catch (err) {
            console.error('[Generate] research_brief kaydı başarısız:', err)
          }
        }

        // ADIM 2: Interview Script
        const scriptStream = await openai.chat.completions.create({
          model: agentConfig.model?.name ?? 'gemini-flash-latest',
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

        // --- ADIM 2: parse + validate + retry (stream UI zaten bitti) ---
        let parsedScript: InterviewScript | null = parseAndClean<InterviewScript>(rawScriptOutput)

        if (parsedScript !== null) {
          // Parse başarılı — validation yap, fail ederse retry
          const scriptValidation = validateInterviewScript(parsedScript)
          if (!scriptValidation.ok) {
            console.warn('[Generate/script] İlk çıktı validation\'ı geçemedi, retry başlıyor. Issues:', scriptValidation.issues)
            parsedScript = await callWithJsonRetry<InterviewScript>(
              openai,
              {
                model: agentConfig.model?.name ?? 'gemini-flash-latest',
                temperature: agentConfig.model?.temperature ?? 0.4,
                max_tokens: agentConfig.model?.max_tokens ?? 2000,
                stream: false,
                messages: [
                  { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: `Research Brief:\n${rawBriefOutput}\n\nProduct idea: ${project.product_idea}`,
                  },
                ],
              },
              validateInterviewScript,
              '[Generate/script]'
            )
          }
        } else {
          // Parse başarısız — retry hem parse hem validate için
          console.warn('[Generate/script] İlk çıktı JSON parse edilemedi, retry başlıyor.')
          parsedScript = await callWithJsonRetry<InterviewScript>(
            openai,
            {
              model: agentConfig.model?.name ?? 'gemini-flash-latest',
              temperature: agentConfig.model?.temperature ?? 0.4,
              max_tokens: agentConfig.model?.max_tokens ?? 2000,
              stream: false,
              messages: [
                { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: `Research Brief:\n${rawBriefOutput}\n\nProduct idea: ${project.product_idea}`,
                },
              ],
            },
            validateInterviewScript,
            '[Generate/script]'
          )
        }

        if (parsedScript) {
          controller.enqueue(encodeChunk({ stage: 'critique', content: 'Tutarlılık kontrol ediliyor...' }))

          const parsedBriefJson = JSON.stringify(parsedBrief, null, 2)
          const parsedScriptJson = JSON.stringify(parsedScript, null, 2)

          const scriptCritique = await callWithJsonRetry<ScriptCritique>(
            openai,
            {
              model: agentConfig.model?.name ?? 'gemini-flash-latest',
              temperature: agentConfig.model?.temperature ?? 0.3,
              max_tokens: agentConfig.model?.max_tokens ?? 500,
              stream: false,
              messages: [
                { role: 'system', content: SCRIPT_CRITIQUE_SYSTEM_PROMPT },
                {
                  role: 'user',
                  content: `Research Brief:\n${parsedBriefJson}\n\nInterview Script:\n${parsedScriptJson}`,
                },
              ],
            },
            validateScriptCritique,
            '[Generate/critique]'
          )

          if (scriptCritique && scriptCritique.alignmentScore < 70 && scriptCritique.missingCoverage.length > 0) {
            console.warn(
              `[Generate/critique] Düşük alignmentScore=${scriptCritique.alignmentScore}, retry script üretimi başlıyor. Missing coverage: ${scriptCritique.missingCoverage.join('; ')}`
            )
            controller.enqueue(
              encodeChunk({
                stage: 'interview_script',
                content: 'Script eksik kapsam nedeniyle yeniden üretiliyor...',
              })
            )

            const retryScript = await callWithJsonRetry<InterviewScript>(
              openai,
              {
                model: agentConfig.model?.name ?? 'gemini-flash-latest',
                temperature: agentConfig.model?.temperature ?? 0.4,
                max_tokens: agentConfig.model?.max_tokens ?? 2000,
                stream: false,
                messages: [
                  { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: `Research Brief:\n${parsedBriefJson}\n\nProduct idea: ${project.product_idea}\n\nThe previous Interview Script did not sufficiently cover these assumptions:\n${scriptCritique.missingCoverage.map((item) => `- ${item}`).join('\n')}\n\nUpdate the Interview Script so it covers these missing assumptions. Output ONLY valid JSON in the same Interview Script format.`,
                  },
                ],
              },
              validateInterviewScript,
              '[Generate/script/retry]'
            )

            if (retryScript) {
              parsedScript = retryScript
              controller.enqueue(
                encodeChunk({
                  stage: 'interview_script',
                  content: 'Yeniden üretilen script hazır. Eksik kapsam kapatıldı.',
                })
              )
            } else {
              console.warn('[Generate/critique] Retry edilen script üretimi başarısız oldu. Orijinal script kullanılacak.')
            }
          }

          try {
            await db
              .update(projects)
              .set({ interview_script: parsedScript, updated_at: new Date() })
              .where(eq(projects.id, projectId))
          } catch (err) {
            console.error('[Generate] interview_script kaydı başarısız:', err)
          }
        }

        // Make.com webhook — fire-and-forget
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
        controller.enqueue(encodeChunk({ stage: 'error', content: 'Üretim sırasında bir hata oluştu.' }))
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
      'X-Accel-Buffering': 'no',
    },
  })
}
