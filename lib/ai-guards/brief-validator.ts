import type { FullResearchBrief, AssumptionRow, ValidationResult } from '@/types/index'

// ---------------------------------------------------------------------------
// Yardımcı tip guard'ları
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown, minLength = 1): boolean {
  return typeof value === 'string' && value.trim().length >= minLength
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAssumptionRow(value: unknown): value is AssumptionRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    isNonEmptyString(row.assumption) &&
    (row.riskLevel === 'high' || row.riskLevel === 'medium' || row.riskLevel === 'low') &&
    isNonEmptyString(row.whatToAskAbout)
  )
}

// ---------------------------------------------------------------------------
// validateFullResearchBrief
// ---------------------------------------------------------------------------

/**
 * LLM'den gelen ham `unknown` değeri FullResearchBrief schema'sına karşı doğrular.
 * Her kontrol hatasını ayrı bir issue string olarak toplar.
 * Hiç issue yoksa `{ ok: true, value }` döner.
 */
export function validateFullResearchBrief(parsed: unknown): ValidationResult<FullResearchBrief> {
  const issues: string[] = []

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, issues: ['Output is not a JSON object'] }
  }

  const p = parsed as Record<string, unknown>

  // productIdea
  if (!isNonEmptyString(p.productIdea, 11)) {
    issues.push('productIdea must be a string longer than 10 characters')
  }

  // targetCustomer
  if (!isNonEmptyString(p.targetCustomer, 6)) {
    issues.push('targetCustomer must be a string longer than 5 characters')
  }

  // coreSituation
  if (!isNonEmptyString(p.coreSituation, 6)) {
    issues.push('coreSituation must be a string longer than 5 characters')
  }

  // currentBelief
  if (!isNonEmptyString(p.currentBelief, 6)) {
    issues.push('currentBelief must be a string longer than 5 characters')
  }

  // riskiestAssumption
  if (!isNonEmptyString(p.riskiestAssumption, 11)) {
    issues.push('riskiestAssumption must be a string longer than 10 characters')
  }

  // interviewObjective
  if (!isNonEmptyString(p.interviewObjective, 11)) {
    issues.push('interviewObjective must be a string longer than 10 characters')
  }

  // evidenceNeeded: { strong, weak, negative }
  if (typeof p.evidenceNeeded !== 'object' || p.evidenceNeeded === null) {
    issues.push('evidenceNeeded must be an object with strong, weak, negative fields')
  } else {
    const ev = p.evidenceNeeded as Record<string, unknown>
    if (!isNonEmptyString(ev.strong)) issues.push('evidenceNeeded.strong must be a non-empty string')
    if (!isNonEmptyString(ev.weak)) issues.push('evidenceNeeded.weak must be a non-empty string')
    if (!isNonEmptyString(ev.negative)) issues.push('evidenceNeeded.negative must be a non-empty string')
  }

  // participantCriteria: { mustHave: string[], avoid: string[] }
  if (typeof p.participantCriteria !== 'object' || p.participantCriteria === null) {
    issues.push('participantCriteria must be an object with mustHave and avoid arrays')
  } else {
    const pc = p.participantCriteria as Record<string, unknown>
    if (!isStringArray(pc.mustHave) || pc.mustHave.length < 1) {
      issues.push('participantCriteria.mustHave must be a string array with at least 1 item')
    }
    if (!isStringArray(pc.avoid)) {
      issues.push('participantCriteria.avoid must be a string array')
    }
  }

  // forbiddenQuestions: string[] en az 2 eleman
  if (!isStringArray(p.forbiddenQuestions) || p.forbiddenQuestions.length < 2) {
    issues.push('forbiddenQuestions must be a string array with at least 2 items')
  }

  // assumptionMap: AssumptionRow[] en az 4 eleman, her elemanın zorunlu alanları dolu
  if (!Array.isArray(p.assumptionMap) || p.assumptionMap.length < 4) {
    issues.push('assumptionMap must be an array with at least 4 items')
  } else {
    p.assumptionMap.forEach((row: unknown, idx: number) => {
      if (!isAssumptionRow(row)) {
        issues.push(
          `assumptionMap[${idx}] must have non-empty assumption, riskLevel ("high"|"medium"|"low"), and whatToAskAbout`
        )
      }
    })
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: parsed as FullResearchBrief }
}

// ---------------------------------------------------------------------------
// validateInterviewScript
// ---------------------------------------------------------------------------

import type { InterviewScript, InterviewQuestion } from '@/types/index'

function isInterviewQuestion(value: unknown): value is InterviewQuestion {
  if (typeof value !== 'object' || value === null) return false
  const q = value as Record<string, unknown>
  return (
    typeof q.order === 'number' &&
    isNonEmptyString(q.question) &&
    isNonEmptyString(q.signalSought)
  )
}

/**
 * LLM'den gelen ham `unknown` değeri InterviewScript schema'sına karşı doğrular.
 * goal non-empty, questions en az 8 eleman, her elemanın zorunlu alanları dolu.
 */
export function validateInterviewScript(parsed: unknown): ValidationResult<InterviewScript> {
  const issues: string[] = []

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, issues: ['Output is not a JSON object'] }
  }

  const p = parsed as Record<string, unknown>

  // goal
  if (!isNonEmptyString(p.goal)) {
    issues.push('goal must be a non-empty string')
  }

  // rulesForInterviewer — array, boş olabilir ama array olmalı
  if (!Array.isArray(p.rulesForInterviewer)) {
    issues.push('rulesForInterviewer must be an array')
  }

  // questions — en az 8 eleman, her birinin order/question/signalSought alanları dolu
  if (!Array.isArray(p.questions) || p.questions.length < 8) {
    issues.push('questions must be an array with at least 8 items')
  } else {
    p.questions.forEach((q: unknown, idx: number) => {
      if (!isInterviewQuestion(q)) {
        issues.push(
          `questions[${idx}] must have numeric order, non-empty question, and non-empty signalSought`
        )
      }
    })
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: parsed as InterviewScript }
}
