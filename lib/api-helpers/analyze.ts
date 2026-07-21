/**
 * Analyze route pure helpers — evidence report ve signal score logic.
 * Next.js'e bağımlılığı yoktur.
 */

import type {
  StructuredAnalysis,
  SignalScore,
  SignalSummary,
  StrongSignalEntry,
  MediumSignalEntry,
  WeakSignalEntry,
  NegativeSignalEntry,
} from '@/types/index'

/**
 * StructuredAnalysis çıktısından SignalScore JSONB yapısını türetir.
 * Tüm açıklama alanları (whyItMatters, context, whyItIsWeak, whyItIsNegative) korunur.
 */
export function buildSignalScore(analysis: StructuredAnalysis): SignalScore {
  return {
    strong: analysis.strongEvidence.map((e): StrongSignalEntry => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItMatters: e.whyItMatters,
    })),
    medium: analysis.mediumEvidence.map((e): MediumSignalEntry => ({
      quote: e.quote,
      message_id: e.message_id,
      context: e.context,
    })),
    weak: analysis.weakEvidence.map((e): WeakSignalEntry => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItIsWeak: e.whyItIsWeak,
    })),
    negative: analysis.negativeEvidence.map((e): NegativeSignalEntry => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItIsNegative: e.whyItIsNegative,
    })),
  }
}

/**
 * StructuredAnalysis çıktısından sinyal sayım özetini türetir.
 */
export function buildSignalSummary(analysis: StructuredAnalysis): SignalSummary {
  return {
    strong_count: analysis.strongEvidence.length,
    medium_count: analysis.mediumEvidence.length,
    weak_count: analysis.weakEvidence.length,
    negative_count: analysis.negativeEvidence.length,
  }
}

/**
 * SKILL.md Skill 6 şablonuna göre Markdown Evidence Report üretir.
 */
export function buildMarkdownReport(
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
    analysis.strongEvidence.forEach((e) =>
      lines.push(`| ${e.quote} | ${e.whyItMatters} |`)
    )
    lines.push('')
  }

  if (analysis.mediumEvidence.length > 0) {
    lines.push('## Medium evidence')
    lines.push('| Quote or observation | Context |')
    lines.push('|---|---|')
    analysis.mediumEvidence.forEach((e) =>
      lines.push(`| ${e.quote} | ${e.context} |`)
    )
    lines.push('')
  }

  if (analysis.weakEvidence.length > 0) {
    lines.push('## Weak or misleading evidence')
    lines.push('| Quote or observation | Why it is weak |')
    lines.push('|---|---|')
    analysis.weakEvidence.forEach((e) =>
      lines.push(`| ${e.quote} | ${e.whyItIsWeak} |`)
    )
    lines.push('')
  }

  if (analysis.negativeEvidence.length > 0) {
    lines.push('## Negative evidence')
    lines.push('| Quote or observation | Why it is negative |')
    lines.push('|---|---|')
    analysis.negativeEvidence.forEach((e) =>
      lines.push(`| ${e.quote} | ${e.whyItIsNegative} |`)
    )
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
