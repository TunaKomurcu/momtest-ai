import type { ScriptCritique, ValidationResult } from '@/types/index'

function isNonEmptyString(value: unknown, minLength = 1): value is string {
  return typeof value === 'string' && value.trim().length >= minLength
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

export function validateScriptCritique(parsed: unknown): ValidationResult<ScriptCritique> {
  const issues: string[] = []

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, issues: ['Output is not a JSON object'] }
  }

  const p = parsed as Record<string, unknown>

  if (typeof p.alignmentScore !== 'number' || Number.isNaN(p.alignmentScore)) {
    issues.push('alignmentScore must be a number between 0 and 100')
  } else if (p.alignmentScore < 0 || p.alignmentScore > 100) {
    issues.push('alignmentScore must be between 0 and 100')
  }

  if (!Array.isArray(p.missingCoverage)) {
    issues.push('missingCoverage must be an array of strings')
  } else if (!isStringArray(p.missingCoverage)) {
    issues.push('missingCoverage must contain only non-empty strings')
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, value: parsed as ScriptCritique }
}
