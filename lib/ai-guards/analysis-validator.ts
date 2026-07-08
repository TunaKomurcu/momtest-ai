import type { StructuredAnalysis, ValidationResult } from '@/types/index'

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const VALID_DECISIONS = new Set([
  'continue discovery',
  'test commitment',
  'change segment',
  'stop',
  'build narrow prototype',
] as const)

const VALID_SIGNAL_LEVELS = new Set(['strong', 'medium', 'weak', 'negative'] as const)

// ---------------------------------------------------------------------------
// Yardımcı tip guard'ları
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isValidSignalLevel(value: unknown): boolean {
  return typeof value === 'string' && VALID_SIGNAL_LEVELS.has(value as 'strong' | 'medium' | 'weak' | 'negative')
}

// ---------------------------------------------------------------------------
// validateStructuredAnalysis
// ---------------------------------------------------------------------------

/**
 * LLM'den gelen ham `unknown` değeri StructuredAnalysis schema'sına karşı doğrular.
 * Her kontrol hatasını ayrı bir issue string olarak toplar.
 * Hiç issue yoksa `{ ok: true, value }` döner.
 */
export function validateStructuredAnalysis(parsed: unknown): ValidationResult<StructuredAnalysis> {
  const issues: string[] = []

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, issues: ['Output is not a JSON object'] }
  }

  const p = parsed as Record<string, unknown>

  // decision — tam olarak 5 geçerli değerden biri
  if (typeof p.decision !== 'string' || !VALID_DECISIONS.has(p.decision as 'continue discovery' | 'test commitment' | 'change segment' | 'stop' | 'build narrow prototype')) {
    issues.push(
      `decision must be exactly one of: "continue discovery" | "test commitment" | "change segment" | "stop" | "build narrow prototype" (got: ${String(p.decision)})`
    )
  }

  // summary
  if (!isNonEmptyString(p.summary)) {
    issues.push('summary must be a non-empty string')
  }

  // signalScore: { problemEvidence, urgency, workaroundEvidence, budgetOrCommitment }
  if (typeof p.signalScore !== 'object' || p.signalScore === null) {
    issues.push('signalScore must be an object with problemEvidence, urgency, workaroundEvidence, budgetOrCommitment')
  } else {
    const ss = p.signalScore as Record<string, unknown>
    if (!isValidSignalLevel(ss.problemEvidence)) {
      issues.push('signalScore.problemEvidence must be "strong" | "medium" | "weak" | "negative"')
    }
    if (!isValidSignalLevel(ss.urgency)) {
      issues.push('signalScore.urgency must be "strong" | "medium" | "weak" | "negative"')
    }
    if (!isValidSignalLevel(ss.workaroundEvidence)) {
      issues.push('signalScore.workaroundEvidence must be "strong" | "medium" | "weak" | "negative"')
    }
    if (!isValidSignalLevel(ss.budgetOrCommitment)) {
      issues.push('signalScore.budgetOrCommitment must be "strong" | "medium" | "weak" | "negative"')
    }
  }

  // strongEvidence — array (boş olabilir)
  if (!isPlainArray(p.strongEvidence)) {
    issues.push('strongEvidence must be an array')
  }

  // mediumEvidence — array (boş olabilir)
  if (!isPlainArray(p.mediumEvidence)) {
    issues.push('mediumEvidence must be an array')
  }

  // weakEvidence — array (boş olabilir)
  if (!isPlainArray(p.weakEvidence)) {
    issues.push('weakEvidence must be an array')
  }

  // negativeEvidence — array (boş olabilir)
  if (!isPlainArray(p.negativeEvidence)) {
    issues.push('negativeEvidence must be an array')
  }

  // openQuestions — array, en az 1 eleman
  if (!isPlainArray(p.openQuestions) || p.openQuestions.length < 1) {
    issues.push('openQuestions must be an array with at least 1 item')
  }

  // recommendedNextStep
  if (!isNonEmptyString(p.recommendedNextStep)) {
    issues.push('recommendedNextStep must be a non-empty string')
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: parsed as StructuredAnalysis }
}
