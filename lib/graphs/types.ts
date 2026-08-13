/**
 * LangGraph state tipleri.
 * generate-graph.ts ve analyze-graph.ts tarafından kullanılır.
 *
 * Kural: Bu dosyada uygulama tiplerine (types/index.ts) referans verilir,
 * çift tanım yapılmaz.
 */

import type {
  FullResearchBrief,
  InterviewScript,
  ScriptCritique,
  StructuredAnalysis,
  SignalScore,
  SignalSummary,
  ConversationMessage,
} from '@/types/index'

// ---------------------------------------------------------------------------
// GenerateGraph state
// ---------------------------------------------------------------------------

/**
 * generate pipeline boyunca taşınan state.
 *
 * Streaming chunk'ları route.ts'deki ReadableStream ile yönetilir —
 * graph sadece non-streaming (validate/retry/critique/db) adımları koordine eder.
 * rawBriefOutput ve rawScriptOutput route'tan graph'a enjekte edilir.
 */
export interface GenerateState {
  // Input — route'tan graph'a geçirilir
  projectId: string
  productIdea: string
  intakeTranscript: string

  // Brief pipeline
  rawBriefOutput: string
  parsedBrief: FullResearchBrief | null
  briefRetryCount: number

  // Script pipeline
  rawScriptOutput: string
  parsedScript: InterviewScript | null
  scriptRetryCount: number

  // Critique
  scriptCritique: ScriptCritique | null
  scriptCritiqueRetryCount: number

  // Output flags
  researchBriefSaved: boolean
  interviewScriptSaved: boolean

  // Hata mesajları — bloklayıcı hatalar buraya yazılır
  errors: string[]
}

// ---------------------------------------------------------------------------
// AnalyzeGraph state
// ---------------------------------------------------------------------------

/**
 * analyze pipeline boyunca taşınan state.
 */
export interface AnalyzeState {
  // Input — route'tan graph'a geçirilir
  interviewId: string
  projectId: string
  participantName: string
  transcript: string
  messageRows: Array<{ id: string; content: string }>

  // Analysis pipeline
  rawAnalysisOutput: string
  parsedAnalysis: StructuredAnalysis | null
  analysisRetryCount: number

  // Grounding
  groundingRetried: boolean

  // Consistency
  consistencyChecked: boolean

  // DB output
  signalScore: SignalScore | null
  signalSummary: SignalSummary | null
  markdownReport: string

  // Output flags
  signalScoreSaved: boolean
  evidenceReportSaved: boolean

  // Hata mesajları
  errors: string[]
}
