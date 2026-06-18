/**
 * Uygulama katmanı tip tanımlamaları.
 * API response yapıları, AI prompt mapping yapıları ve ara katman tipleri burada tanımlanır.
 * Supabase DB tipleri için: types/database.types.ts
 */

// ---------------------------------------------------------------------------
// Generic API Response
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  data: T
  error: null
}

export interface ApiError {
  data: null
  error: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ---------------------------------------------------------------------------
// Intake API — app/api/intake/[projectId]/route.ts
// ---------------------------------------------------------------------------

/** POST /api/intake/[projectId] istek gövdesi */
export interface IntakeRequestBody {
  message: string
}

/** POST /api/intake/[projectId] başarılı yanıt datası */
export interface IntakeResponseData {
  reply: string
  isComplete: boolean
}

// ---------------------------------------------------------------------------
// PM Intake — AI bağlamı için toplanan proje bilgileri
// ---------------------------------------------------------------------------

/**
 * Intake sohbeti tamamlandığında AI'dan çıkarılan yapılandırılmış PM bağlamı.
 * projects.research_brief JSONB alanında saklanır.
 */
export interface ResearchBrief {
  researchGoal: string
  targetCustomerSegment: string
  coreSituation: string
  riskiestAssumption: string
  interviewObjective: string
  evidenceNeeded: string
  forbiddenQuestions: string[]
  participantCriteria: string
}

/**
 * Intake konuşmasında tespit edilen eksik alan takibi.
 * Hangi soruların henüz yanıtlanmadığını izler.
 */
export interface IntakeCompletionStatus {
  hasProductIdea: boolean
  hasTargetSegment: boolean
  hasRiskiestAssumption: boolean
}

// ---------------------------------------------------------------------------
// OpenAI config — openai.yaml dosyasından parse edilen yapı
// ---------------------------------------------------------------------------

export interface OpenAIAgentConfig {
  interface: {
    display_name: string
    short_description: string
    icon: string
    brand_color: string
  }
  model?: string
  temperature?: number
  max_tokens?: number
}

// ---------------------------------------------------------------------------
// Message — konuşma geçmişi için kullanılan hafif tip
// (Database['public']['Tables']['messages']['Row'] yerine kullanılır)
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  sender: 'agent' | 'participant'
  content: string
}

// ---------------------------------------------------------------------------
// Generate API — app/api/generate/[projectId]/route.ts
// ---------------------------------------------------------------------------

/** POST /api/generate/[projectId] başarılı yanıt datası (streaming öncesi meta) */
export interface GenerateResponseData {
  researchBriefSaved: boolean
  interviewScriptSaved: boolean
}

/**
 * Skill 2 — Assumption Map tablosundaki tek bir satır
 */
export interface AssumptionRow {
  assumption: string
  riskLevel: 'high' | 'medium' | 'low'
  whatToAskAbout: string
  strongEvidence: string
  weakEvidence: string
}

/**
 * projects.research_brief JSONB alanında saklanan tam yapı.
 * Skill 1 output + Skill 2 assumption map içerir.
 */
export interface FullResearchBrief {
  productIdea: string
  targetCustomer: string
  coreSituation: string
  currentBelief: string
  riskiestAssumption: string
  interviewObjective: string
  evidenceNeeded: {
    strong: string
    weak: string
    negative: string
  }
  participantCriteria: {
    mustHave: string[]
    avoid: string[]
  }
  forbiddenQuestions: string[]
  assumptionMap: AssumptionRow[]
}

/**
 * Skill 3 — Interview Script'teki tek bir soru satırı
 */
export interface InterviewQuestion {
  order: number
  question: string
  signalSought: string
  whyItPasses: string
}

/**
 * projects.interview_script JSONB alanında saklanan tam yapı.
 * Skill 3 output formatına uygun.
 */
export interface InterviewScript {
  goal: string
  rulesForInterviewer: string[]
  questions: InterviewQuestion[]
}

/**
 * Streaming response chunk tipi.
 * İstemci tarafında SSE parse ederken kullanılır.
 */
export interface GenerateStreamChunk {
  stage: 'research_brief' | 'interview_script' | 'done' | 'error'
  content: string
}
