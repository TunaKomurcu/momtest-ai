/**
 * Generate Pipeline — LangGraph Graph
 *
 * Bu graph'ın sorumluluğu:
 *   rawBriefOutput (route'tan gelir)  → parseBrief → validateBrief → (retry?)
 *   rawScriptOutput (route'tan gelir) → parseScript → validateScript → (retry?)
 *   critiqueScript → (alignmentScore < 70 → retryScript?) → saveToDb
 *
 * Streaming (token akışı) route.ts'deki ReadableStream içinde kalır — bu graph
 * sadece non-streaming adımları (validate / retry / critique / db-save) koordine eder.
 * rawBriefOutput ve rawScriptOutput route'tan graph'a başlangıç state'i olarak geçirilir.
 *
 * Node isimleri konvansiyonu: snake_case (LangGraph standart)
 */

import { StateGraph, END, START } from '@langchain/langgraph'
import { Annotation } from '@langchain/langgraph'
import OpenAI from 'openai'
import { OPENAI_MODEL } from '@/lib/llm/config'
import { db } from '@/lib/db/index'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callWithJsonRetry, parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateFullResearchBrief, validateInterviewScript } from '@/lib/ai-guards/brief-validator'
import { validateScriptCritique } from '@/lib/ai-guards/script-critique-validator'
import type {
  FullResearchBrief,
  InterviewScript,
  ScriptCritique,
  OpenAIAgentConfig,
} from '@/types/index'
import type { GenerateState } from '@/lib/graphs/types'

// ---------------------------------------------------------------------------
// LangGraph Annotation — state kanalları
// ---------------------------------------------------------------------------

const GenerateAnnotation = Annotation.Root({
  projectId:               Annotation<string>(),
  productIdea:             Annotation<string>(),
  intakeTranscript:        Annotation<string>(),
  rawBriefOutput:          Annotation<string>(),
  parsedBrief:             Annotation<FullResearchBrief | null>(),
  briefRetryCount:         Annotation<number>(),
  rawScriptOutput:         Annotation<string>(),
  parsedScript:            Annotation<InterviewScript | null>(),
  scriptRetryCount:        Annotation<number>(),
  scriptCritique:          Annotation<ScriptCritique | null>(),
  scriptCritiqueRetryCount: Annotation<number>(),
  researchBriefSaved:      Annotation<boolean>(),
  interviewScriptSaved:    Annotation<boolean>(),
  errors:                  Annotation<string[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
})

type GraphState = typeof GenerateAnnotation.State

// ---------------------------------------------------------------------------
// System prompts (generate/route.ts ile aynı — tek kaynak)
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

function buildOpenAIClient(agentConfig: Partial<OpenAIAgentConfig>): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.openai.com/v1',
  })
}

// ---------------------------------------------------------------------------
// Node: parse_brief
// Raw LLM çıktısını parse eder. Streaming node değil — rawBriefOutput hazır gelir.
// ---------------------------------------------------------------------------

async function parseBriefNode(state: GraphState): Promise<Partial<GraphState>> {
  const parsed = parseAndClean<FullResearchBrief>(state.rawBriefOutput)
  if (parsed !== null) {
    const validation = validateFullResearchBrief(parsed)
    if (validation.ok) {
      return { parsedBrief: validation.value }
    }
    console.warn('[GenerateGraph/parse_brief] Validation başarısız:', validation.issues)
  } else {
    console.warn('[GenerateGraph/parse_brief] JSON parse başarısız')
  }
  return { parsedBrief: null }
}

// ---------------------------------------------------------------------------
// Node: retry_brief
// Brief parse/validate başarısız — LLM'e non-streaming retry gönder.
// ---------------------------------------------------------------------------

async function retryBriefNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  const openai = buildOpenAIClient(agentConfig)
  console.warn(`[GenerateGraph/retry_brief] Retry ${state.briefRetryCount + 1}/2`)

  const result = await callWithJsonRetry<FullResearchBrief>(
    openai,
    {
      model: OPENAI_MODEL,
      temperature: agentConfig.model?.temperature ?? 0.3,
      max_tokens: agentConfig.model?.max_tokens ?? 1500,
      stream: false,
      messages: [
        { role: 'system', content: RESEARCH_BRIEF_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Product idea: ${state.productIdea}\n\nIntake conversation:\n${state.intakeTranscript}`,
        },
      ],
    },
    validateFullResearchBrief,
    '[GenerateGraph/retry_brief]'
  )

  return {
    parsedBrief: result,
    briefRetryCount: state.briefRetryCount + 1,
  }
}

// ---------------------------------------------------------------------------
// Node: parse_script
// rawScriptOutput'u parse eder.
// ---------------------------------------------------------------------------

async function parseScriptNode(state: GraphState): Promise<Partial<GraphState>> {
  const parsed = parseAndClean<InterviewScript>(state.rawScriptOutput)
  if (parsed !== null) {
    const validation = validateInterviewScript(parsed)
    if (validation.ok) {
      return { parsedScript: validation.value }
    }
    console.warn('[GenerateGraph/parse_script] Validation başarısız:', validation.issues)
  } else {
    console.warn('[GenerateGraph/parse_script] JSON parse başarısız')
  }
  return { parsedScript: null }
}

// ---------------------------------------------------------------------------
// Node: retry_script
// Script parse/validate başarısız — LLM'e non-streaming retry gönder.
// ---------------------------------------------------------------------------

async function retryScriptNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  const openai = buildOpenAIClient(agentConfig)
  const briefJson = state.parsedBrief ? JSON.stringify(state.parsedBrief) : state.rawBriefOutput
  console.warn(`[GenerateGraph/retry_script] Retry ${state.scriptRetryCount + 1}/2`)

  const result = await callWithJsonRetry<InterviewScript>(
    openai,
    {
      model: OPENAI_MODEL,
      temperature: agentConfig.model?.temperature ?? 0.4,
      max_tokens: agentConfig.model?.max_tokens ?? 2000,
      stream: false,
      messages: [
        { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Research Brief:\n${briefJson}\n\nProduct idea: ${state.productIdea}`,
        },
      ],
    },
    validateInterviewScript,
    '[GenerateGraph/retry_script]'
  )

  return {
    parsedScript: result,
    scriptRetryCount: state.scriptRetryCount + 1,
  }
}

// ---------------------------------------------------------------------------
// Node: critique_script
// Brief + script'i critique LLM'e gönderir, alignment score alır.
// ---------------------------------------------------------------------------

async function critiqueScriptNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  const openai = buildOpenAIClient(agentConfig)
  const briefJson  = JSON.stringify(state.parsedBrief, null, 2)
  const scriptJson = JSON.stringify(state.parsedScript, null, 2)

  const critique = await callWithJsonRetry<ScriptCritique>(
    openai,
    {
      model: OPENAI_MODEL,
      temperature: agentConfig.model?.temperature ?? 0.3,
      max_tokens: agentConfig.model?.max_tokens ?? 500,
      stream: false,
      messages: [
        { role: 'system', content: SCRIPT_CRITIQUE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Research Brief:\n${briefJson}\n\nInterview Script:\n${scriptJson}`,
        },
      ],
    },
    validateScriptCritique,
    '[GenerateGraph/critique_script]'
  )

  return { scriptCritique: critique }
}

// ---------------------------------------------------------------------------
// Node: coverage_retry_script
// Critique alignmentScore < 70 — eksik coverage için script yeniden üretilir.
// ---------------------------------------------------------------------------

async function coverageRetryScriptNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  const openai = buildOpenAIClient(agentConfig)
  const briefJson = JSON.stringify(state.parsedBrief, null, 2)
  const missing = state.scriptCritique?.missingCoverage ?? []

  console.warn(
    `[GenerateGraph/coverage_retry_script] alignmentScore=${state.scriptCritique?.alignmentScore}, ` +
    `missing: ${missing.join('; ')}`
  )

  const result = await callWithJsonRetry<InterviewScript>(
    openai,
    {
      model: OPENAI_MODEL,
      temperature: agentConfig.model?.temperature ?? 0.4,
      max_tokens: agentConfig.model?.max_tokens ?? 2000,
      stream: false,
      messages: [
        { role: 'system', content: INTERVIEW_SCRIPT_SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Research Brief:\n${briefJson}\n\nProduct idea: ${state.productIdea}\n\n` +
            `The previous Interview Script did not sufficiently cover these assumptions:\n` +
            `${missing.map((item) => `- ${item}`).join('\n')}\n\n` +
            `Update the Interview Script so it covers these missing assumptions. Output ONLY valid JSON in the same Interview Script format.`,
        },
      ],
    },
    validateInterviewScript,
    '[GenerateGraph/coverage_retry_script]'
  )

  return {
    parsedScript: result ?? state.parsedScript,
    scriptCritiqueRetryCount: state.scriptCritiqueRetryCount + 1,
  }
}

// ---------------------------------------------------------------------------
// Node: save_to_db
// parsedBrief ve parsedScript'i DB'ye yazar.
// ---------------------------------------------------------------------------

async function saveToDbNode(state: GraphState): Promise<Partial<GraphState>> {
  let researchBriefSaved = false
  let interviewScriptSaved = false

  try {
    await db
      .update(projects)
      .set({
        research_brief:   state.parsedBrief   ?? undefined,
        interview_script: state.parsedScript  ?? undefined,
        updated_at:       new Date(),
      })
      .where(eq(projects.id, state.projectId))

    researchBriefSaved  = state.parsedBrief  !== null
    interviewScriptSaved = state.parsedScript !== null
  } catch (err) {
    console.error('[GenerateGraph/save_to_db] DB yazma başarısız:', err)
  }

  return { researchBriefSaved, interviewScriptSaved }
}

// ---------------------------------------------------------------------------
// Conditional edge fonksiyonları
// ---------------------------------------------------------------------------

const MAX_BRIEF_RETRIES  = 2
const MAX_SCRIPT_RETRIES = 2

function routeAfterParseBrief(state: GraphState): 'parse_script_prep' | 'retry_brief' | typeof END {
  if (state.parsedBrief !== null) return 'parse_script_prep'
  if (state.briefRetryCount < MAX_BRIEF_RETRIES) return 'retry_brief'
  console.error('[GenerateGraph] Brief üretilemedi, max retry aşıldı')
  return END
}

function routeAfterRetryBrief(state: GraphState): 'parse_script_prep' | 'retry_brief' | typeof END {
  if (state.parsedBrief !== null) return 'parse_script_prep'
  if (state.briefRetryCount < MAX_BRIEF_RETRIES) return 'retry_brief'
  console.error('[GenerateGraph] Brief üretilemedi, max retry aşıldı')
  return END
}

function routeAfterParseScript(state: GraphState): 'critique_script' | 'retry_script' | typeof END {
  if (state.parsedScript !== null) return 'critique_script'
  if (state.scriptRetryCount < MAX_SCRIPT_RETRIES) return 'retry_script'
  console.error('[GenerateGraph] Script üretilemedi, max retry aşıldı')
  return END
}

function routeAfterRetryScript(state: GraphState): 'critique_script' | 'retry_script' | typeof END {
  if (state.parsedScript !== null) return 'critique_script'
  if (state.scriptRetryCount < MAX_SCRIPT_RETRIES) return 'retry_script'
  console.error('[GenerateGraph] Script üretilemedi, max retry aşıldı')
  return END
}

function routeAfterCritique(state: GraphState): 'coverage_retry_script' | 'save_to_db' {
  if (
    state.scriptCritique !== null &&
    state.scriptCritique.alignmentScore < 70 &&
    state.scriptCritique.missingCoverage.length > 0 &&
    state.scriptCritiqueRetryCount === 0   // coverage retry yalnızca bir kez
  ) {
    return 'coverage_retry_script'
  }
  return 'save_to_db'
}

// ---------------------------------------------------------------------------
// Graph factory — agentConfig dışarıdan enjekte edilir
// ---------------------------------------------------------------------------

/**
 * GenerateGraph'ı compile eder ve döndürür.
 * Her route isteğinde yeniden compile edilmez — modül seviyesinde cache'lenir.
 *
 * @param agentConfig  openai.yaml'dan yüklenen model konfigürasyonu
 */
export function buildGenerateGraph(agentConfig: Partial<OpenAIAgentConfig>) {
  // Node'ları agentConfig ile partial application yap
  const retryBrief          = (s: GraphState) => retryBriefNode(s, agentConfig)
  const retryScript         = (s: GraphState) => retryScriptNode(s, agentConfig)
  const critiqueScript      = (s: GraphState) => critiqueScriptNode(s, agentConfig)
  const coverageRetryScript = (s: GraphState) => coverageRetryScriptNode(s, agentConfig)

  const graph = new StateGraph(GenerateAnnotation)

  graph
    // Nodes
    .addNode('parse_brief',            parseBriefNode)
    .addNode('retry_brief',            retryBrief)
    .addNode('parse_script_prep',      parseScriptNode)
    .addNode('retry_script',           retryScript)
    .addNode('critique_script',        critiqueScript)
    .addNode('coverage_retry_script',  coverageRetryScript)
    .addNode('save_to_db',             saveToDbNode)

    // Entry
    .addEdge(START, 'parse_brief')

    // Brief branch
    .addConditionalEdges('parse_brief', routeAfterParseBrief, {
      parse_script_prep: 'parse_script_prep',
      retry_brief:       'retry_brief',
      [END]:              END,
    })
    .addConditionalEdges('retry_brief', routeAfterRetryBrief, {
      parse_script_prep: 'parse_script_prep',
      retry_brief:       'retry_brief',
      [END]:              END,
    })

    // Script branch
    .addConditionalEdges('parse_script_prep', routeAfterParseScript, {
      critique_script: 'critique_script',
      retry_script:    'retry_script',
      [END]:            END,
    })
    .addConditionalEdges('retry_script', routeAfterRetryScript, {
      critique_script: 'critique_script',
      retry_script:    'retry_script',
      [END]:            END,
    })

    // Critique branch
    .addConditionalEdges('critique_script', routeAfterCritique, {
      coverage_retry_script: 'coverage_retry_script',
      save_to_db:            'save_to_db',
    })
    .addEdge('coverage_retry_script', 'save_to_db')

    // Final
    .addEdge('save_to_db', END)

  return graph.compile()
}

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

/**
 * Graph'a geçirilecek başlangıç state'ini oluşturur.
 * rawBriefOutput ve rawScriptOutput route'taki streaming tamamlandıktan
 * sonra doldurularak graph.invoke() çağrısına eklenir.
 */
export function buildInitialGenerateState(
  projectId: string,
  productIdea: string,
  intakeTranscript: string,
  rawBriefOutput: string,
  rawScriptOutput: string
): GenerateState {
  return {
    projectId,
    productIdea,
    intakeTranscript,
    rawBriefOutput,
    parsedBrief:             null,
    briefRetryCount:         0,
    rawScriptOutput,
    parsedScript:            null,
    scriptRetryCount:        0,
    scriptCritique:          null,
    scriptCritiqueRetryCount: 0,
    researchBriefSaved:      false,
    interviewScriptSaved:    false,
    errors:                  [],
  }
}
