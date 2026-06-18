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
