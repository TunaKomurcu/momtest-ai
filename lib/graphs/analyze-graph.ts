/**
 * Analyze Pipeline — LangGraph Graph
 *
 * Sorumluluk:
 *   rawAnalysisOutput (route'tan gelir)
 *     → parse_analysis → validate → (retry?)
 *     → verify_grounding → (grounding sorun varsa → grounding_retry)
 *     → check_consistency
 *     → save_to_db
 *
 * Node isimleri konvansiyonu: snake_case
 */

import { StateGraph, END, START } from '@langchain/langgraph'
import { Annotation } from '@langchain/langgraph'
import OpenAI from 'openai'
import { db } from '@/lib/db/index'
import { interviews } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { callWithJsonRetry, parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'
import { verifyGrounding, issuesToWarnings } from '@/lib/ai-guards/grounding-verifier'
import { checkDecisionConsistency } from '@/lib/decision-consistency-checker'
import type {
  StructuredAnalysis,
  SignalScore,
  SignalSummary,
  StrongSignalEntry,
  MediumSignalEntry,
  WeakSignalEntry,
  NegativeSignalEntry,
  OpenAIAgentConfig,
} from '@/types/index'
import type { AnalyzeState } from '@/lib/graphs/types'

// ---------------------------------------------------------------------------
// LangGraph Annotation — state kanalları
// ---------------------------------------------------------------------------

const AnalyzeAnnotation = Annotation.Root({
  interviewId:       Annotation<string>(),
  projectId:         Annotation<string>(),
  participantName:   Annotation<string>(),
  transcript:        Annotation<string>(),
  messageRows:       Annotation<Array<{ id: string; content: string }>>(),
  rawAnalysisOutput: Annotation<string>(),
  parsedAnalysis:    Annotation<StructuredAnalysis | null>(),
  analysisRetryCount: Annotation<number>(),
  groundingRetried:  Annotation<boolean>(),
  consistencyChecked: Annotation<boolean>(),
  signalScore:       Annotation<SignalScore | null>(),
  signalSummary:     Annotation<SignalSummary | null>(),
  markdownReport:    Annotation<string>(),
  signalScoreSaved:  Annotation<boolean>(),
  evidenceReportSaved: Annotation<boolean>(),
  errors:            Annotation<string[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
})

type GraphState = typeof AnalyzeAnnotation.State

// ---------------------------------------------------------------------------
// System prompt (analyze/route.ts ile aynı — tek kaynak)
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
    { "quote": "exact or close paraphrase from participant", "message_id": "msg-uuid", "whyItIsNegative": "why this is a red flag" }
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

function buildOpenAIClient(agentConfig: Partial<OpenAIAgentConfig>): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })
}

function buildSignalScore(analysis: StructuredAnalysis): SignalScore {
  return {
    strong: analysis.strongEvidence.map((e): StrongSignalEntry => ({
      quote:        e.quote,
      message_id:   e.message_id,
      whyItMatters: e.whyItMatters,
    })),
    medium: analysis.mediumEvidence.map((e): MediumSignalEntry => ({
      quote:      e.quote,
      message_id: e.message_id,
      context:    e.context,
    })),
    weak: analysis.weakEvidence.map((e): WeakSignalEntry => ({
      quote:        e.quote,
      message_id:   e.message_id,
      whyItIsWeak:  e.whyItIsWeak,
    })),
    negative: analysis.negativeEvidence.map((e): NegativeSignalEntry => ({
      quote:            e.quote,
      message_id:       e.message_id,
      whyItIsNegative:  e.whyItIsNegative,
    })),
  }
}

function buildSignalSummary(analysis: StructuredAnalysis): SignalSummary {
  return {
    strong_count:   analysis.strongEvidence.length,
    medium_count:   analysis.mediumEvidence.length,
    weak_count:     analysis.weakEvidence.length,
    negative_count: analysis.negativeEvidence.length,
  }
}

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
    analysis.strongEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItMatters} |`))
    lines.push('')
  }

  if (analysis.mediumEvidence.length > 0) {
    lines.push('## Medium evidence')
    lines.push('| Quote or observation | Context |')
    lines.push('|---|---|')
    analysis.mediumEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.context} |`))
    lines.push('')
  }

  if (analysis.weakEvidence.length > 0) {
    lines.push('## Weak or misleading evidence')
    lines.push('| Quote or observation | Why it is weak |')
    lines.push('|---|---|')
    analysis.weakEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItIsWeak} |`))
    lines.push('')
  }

  if (analysis.negativeEvidence.length > 0) {
    lines.push('## Negative evidence')
    lines.push('| Quote or observation | Why it is negative |')
    lines.push('|---|---|')
    analysis.negativeEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItIsNegative} |`))
    lines.push('')
  }

  if (analysis.openQuestions.length > 0) {
    lines.push('## Open questions')
    analysis.openQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`))
    lines.push('')
  }

  lines.push('## Recommended next step')
  lines.push(analysis.recommendedNextStep)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Node: parse_analysis
// rawAnalysisOutput'u parse + validate eder.
// ---------------------------------------------------------------------------

async function parseAnalysisNode(state: GraphState): Promise<Partial<GraphState>> {
  const parsed = parseAndClean<StructuredAnalysis>(state.rawAnalysisOutput)
  if (parsed !== null) {
    const validation = validateStructuredAnalysis(parsed)
    if (validation.ok) {
      return { parsedAnalysis: validation.value }
    }
    console.warn('[AnalyzeGraph/parse_analysis] Validation başarısız:', validation.issues)
  } else {
    console.warn('[AnalyzeGraph/parse_analysis] JSON parse başarısız')
  }
  return { parsedAnalysis: null }
}

// ---------------------------------------------------------------------------
// Node: retry_analysis
// Parse/validate başarısız — LLM retry.
// ---------------------------------------------------------------------------

async function retryAnalysisNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  const openai = buildOpenAIClient(agentConfig)
  console.warn(`[AnalyzeGraph/retry_analysis] Retry ${state.analysisRetryCount + 1}/2`)

  const result = await callWithJsonRetry<StructuredAnalysis>(
    openai,
    {
      model:       agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.2,
      max_tokens:  agentConfig.model?.max_tokens ?? 2048,
      stream:      false,
      messages: [
        { role: 'system', content: EVIDENCE_ANALYST_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Participant name: ${state.participantName}\n\nInterview transcript:\n${state.transcript}`,
        },
      ],
    },
    validateStructuredAnalysis,
    '[AnalyzeGraph/retry_analysis]'
  )

  return {
    parsedAnalysis:     result,
    analysisRetryCount: state.analysisRetryCount + 1,
  }
}

// ---------------------------------------------------------------------------
// Node: verify_grounding
// Deterministik — sıfır LLM çağrısı. Alıntıları transkripte karşı doğrular.
// ---------------------------------------------------------------------------

async function verifyGroundingNode(state: GraphState): Promise<Partial<GraphState>> {
  if (state.parsedAnalysis === null) return {}

  const issues = verifyGrounding(state.parsedAnalysis, state.messageRows)

  if (issues.length === 0) {
    return {}  // grounding temiz — state değişmez
  }

  // Sorun var — state'e yaz, edge grounding_retry'a yönlendirecek
  const warnings = issuesToWarnings(issues)
  return {
    parsedAnalysis: {
      ...state.parsedAnalysis,
      groundingWarnings: warnings,
    },
  }
}

// ---------------------------------------------------------------------------
// Node: grounding_retry
// Grounding sorunu olan alıntıları LLM'e gösterip yeniden ürettirir.
// ---------------------------------------------------------------------------

async function groundingRetryNode(
  state: GraphState,
  agentConfig: Partial<OpenAIAgentConfig>
): Promise<Partial<GraphState>> {
  if (state.parsedAnalysis === null) return { groundingRetried: true }

  const openai = buildOpenAIClient(agentConfig)
  const warnings = state.parsedAnalysis.groundingWarnings ?? []

  console.warn(`[AnalyzeGraph/grounding_retry] ${warnings.length} grounding sorunu, LLM retry başlıyor`)

  const ungroundedQuotes = warnings
    .map(w => `- "${w.slice(0, 80)}"`)
    .join('\n')

  const retriedAnalysis = await callWithJsonRetry<StructuredAnalysis>(
    openai,
    {
      model:       agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.1,
      max_tokens:  agentConfig.model?.max_tokens ?? 2048,
      stream:      false,
      messages: [
        { role: 'system', content: EVIDENCE_ANALYST_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Participant name: ${state.participantName}\n\nInterview transcript:\n${state.transcript}`,
        },
        {
          role: 'assistant',
          content: JSON.stringify(state.parsedAnalysis),
        },
        {
          role: 'user',
          content:
            `The following quotes could NOT be found in the transcript above. ` +
            `Please revise the analysis and use ONLY quotes that appear verbatim or near-verbatim in the transcript. ` +
            `Do not invent or paraphrase beyond recognition.\n\nProblematic quotes:\n${ungroundedQuotes}\n\n` +
            `Return the complete corrected JSON analysis.`,
        },
      ],
    },
    validateStructuredAnalysis,
    '[AnalyzeGraph/grounding_retry]'
  )

  if (retriedAnalysis) {
    // Retry sonrası tekrar doğrula — iyileşme olduysa kullan
    const retriedIssues = verifyGrounding(retriedAnalysis, state.messageRows)
    const retriedWarnings = retriedIssues.length > 0 ? issuesToWarnings(retriedIssues) : undefined

    return {
      parsedAnalysis: {
        ...retriedAnalysis,
        ...(retriedWarnings ? { groundingWarnings: retriedWarnings } : {}),
      },
      groundingRetried: true,
    }
  }

  // Retry başarısız — orijinal analiz korunur
  console.warn('[AnalyzeGraph/grounding_retry] Retry başarısız, orijinal analiz korunuyor')
  return { groundingRetried: true }
}

// ---------------------------------------------------------------------------
// Node: check_consistency
// Deterministik — decision ile signalScore tutarsızlığını kontrol eder.
// ---------------------------------------------------------------------------

async function checkConsistencyNode(state: GraphState): Promise<Partial<GraphState>> {
  if (state.parsedAnalysis === null) return { consistencyChecked: true }

  const consistencyWarnings = checkDecisionConsistency(state.parsedAnalysis)

  if (consistencyWarnings.length > 0) {
    return {
      parsedAnalysis: {
        ...state.parsedAnalysis,
        consistencyWarnings: [
          ...(state.parsedAnalysis.consistencyWarnings ?? []),
          ...consistencyWarnings,
        ],
      },
      consistencyChecked: true,
    }
  }

  return { consistencyChecked: true }
}

// ---------------------------------------------------------------------------
// Node: build_outputs
// signalScore, signalSummary, markdownReport türetir — DB'ye yazılmadan önce.
// ---------------------------------------------------------------------------

async function buildOutputsNode(state: GraphState): Promise<Partial<GraphState>> {
  if (state.parsedAnalysis === null) return {}

  const signalScore    = buildSignalScore(state.parsedAnalysis)
  const signalSummary  = buildSignalSummary(state.parsedAnalysis)
  const markdownReport = buildMarkdownReport(state.parsedAnalysis, state.participantName)

  return { signalScore, signalSummary, markdownReport }
}

// ---------------------------------------------------------------------------
// Node: save_to_db
// interviews tablosuna signal_score, evidence_report, analysis_json yazar.
// ---------------------------------------------------------------------------

async function saveToDbNode(state: GraphState): Promise<Partial<GraphState>> {
  if (state.parsedAnalysis === null) {
    console.error('[AnalyzeGraph/save_to_db] parsedAnalysis null — kayıt atlanıyor')
    return { signalScoreSaved: false, evidenceReportSaved: false }
  }

  try {
    await db
      .update(interviews)
      .set({
        signal_score:    state.signalScore,
        evidence_report: state.markdownReport,
        analysis_json:   state.parsedAnalysis,
        analyzed_at:     new Date(),
        updated_at:      new Date(),
      })
      .where(eq(interviews.id, state.interviewId))

    return { signalScoreSaved: true, evidenceReportSaved: true }
  } catch (err) {
    console.error('[AnalyzeGraph/save_to_db] DB yazma başarısız:', err)
    return { signalScoreSaved: false, evidenceReportSaved: false }
  }
}

// ---------------------------------------------------------------------------
// Conditional edge fonksiyonları
// ---------------------------------------------------------------------------

const MAX_ANALYSIS_RETRIES = 2

function routeAfterParseAnalysis(
  state: GraphState
): 'verify_grounding' | 'retry_analysis' | typeof END {
  if (state.parsedAnalysis !== null) return 'verify_grounding'
  if (state.analysisRetryCount < MAX_ANALYSIS_RETRIES) return 'retry_analysis'
  console.error('[AnalyzeGraph] Analiz üretilemedi, max retry aşıldı')
  return END
}

function routeAfterRetryAnalysis(
  state: GraphState
): 'verify_grounding' | 'retry_analysis' | typeof END {
  if (state.parsedAnalysis !== null) return 'verify_grounding'
  if (state.analysisRetryCount < MAX_ANALYSIS_RETRIES) return 'retry_analysis'
  console.error('[AnalyzeGraph] Analiz üretilemedi, max retry aşıldı')
  return END
}

function routeAfterVerifyGrounding(
  state: GraphState
): 'grounding_retry' | 'check_consistency' {
  // groundingWarnings doluysa ve henüz retry yapılmadıysa grounding_retry'a git
  if (
    state.parsedAnalysis !== null &&
    (state.parsedAnalysis.groundingWarnings?.length ?? 0) > 0 &&
    !state.groundingRetried
  ) {
    return 'grounding_retry'
  }
  return 'check_consistency'
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

/**
 * AnalyzeGraph'ı compile eder ve döndürür.
 *
 * @param agentConfig  openai.yaml'dan yüklenen model konfigürasyonu
 */
export function buildAnalyzeGraph(agentConfig: Partial<OpenAIAgentConfig>) {
  const retryAnalysis   = (s: GraphState) => retryAnalysisNode(s, agentConfig)
  const groundingRetry  = (s: GraphState) => groundingRetryNode(s, agentConfig)

  const graph = new StateGraph(AnalyzeAnnotation)

  graph
    .addNode('parse_analysis',    parseAnalysisNode)
    .addNode('retry_analysis',    retryAnalysis)
    .addNode('verify_grounding',  verifyGroundingNode)
    .addNode('grounding_retry',   groundingRetry)
    .addNode('check_consistency', checkConsistencyNode)
    .addNode('build_outputs',     buildOutputsNode)
    .addNode('save_to_db',        saveToDbNode)

    .addEdge(START, 'parse_analysis')

    .addConditionalEdges('parse_analysis', routeAfterParseAnalysis, {
      verify_grounding: 'verify_grounding',
      retry_analysis:   'retry_analysis',
      [END]:             END,
    })
    .addConditionalEdges('retry_analysis', routeAfterRetryAnalysis, {
      verify_grounding: 'verify_grounding',
      retry_analysis:   'retry_analysis',
      [END]:             END,
    })

    .addConditionalEdges('verify_grounding', routeAfterVerifyGrounding, {
      grounding_retry:   'grounding_retry',
      check_consistency: 'check_consistency',
    })

    .addEdge('grounding_retry',   'check_consistency')
    .addEdge('check_consistency', 'build_outputs')
    .addEdge('build_outputs',     'save_to_db')
    .addEdge('save_to_db',        END)

  return graph.compile()
}

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

/**
 * Graph'a geçirilecek başlangıç state'ini oluşturur.
 * rawAnalysisOutput route'taki LLM çağrısı tamamlandıktan sonra doldurulur.
 */
export function buildInitialAnalyzeState(
  interviewId: string,
  projectId: string,
  participantName: string,
  transcript: string,
  messageRows: Array<{ id: string; content: string }>,
  rawAnalysisOutput: string
): AnalyzeState {
  return {
    interviewId,
    projectId,
    participantName,
    transcript,
    messageRows,
    rawAnalysisOutput,
    parsedAnalysis:     null,
    analysisRetryCount: 0,
    groundingRetried:   false,
    consistencyChecked: false,
    signalScore:        null,
    signalSummary:      null,
    markdownReport:     '',
    signalScoreSaved:   false,
    evidenceReportSaved: false,
    errors:             [],
  }
}
