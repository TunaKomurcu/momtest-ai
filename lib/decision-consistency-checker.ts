import type { StructuredAnalysis } from '@/types/index'

const CONSISTENCY_STRONG_THRESHOLD = 3
const CONSISTENCY_WEAK_THRESHOLD = 3

const COMMITMENT_DECISIONS = new Set(['test commitment', 'build narrow prototype'])

function countWeakOrNegative(score: StructuredAnalysis['signalScore']): number {
  return [score.problemEvidence, score.urgency, score.workaroundEvidence, score.budgetOrCommitment]
    .filter((value) => value === 'weak' || value === 'negative').length
}

function countStrong(score: StructuredAnalysis['signalScore']): number {
  return [score.problemEvidence, score.urgency, score.workaroundEvidence, score.budgetOrCommitment]
    .filter((value) => value === 'strong').length
}

export function checkDecisionConsistency(analysis: StructuredAnalysis): string[] {
  const warnings: string[] = []
  const weakOrNegativeCount = countWeakOrNegative(analysis.signalScore)
  const strongCount = countStrong(analysis.signalScore)
  const decision = analysis.decision.toLowerCase()

  if (weakOrNegativeCount >= CONSISTENCY_WEAK_THRESHOLD && COMMITMENT_DECISIONS.has(decision)) {
    warnings.push(
      'Analizde genel olarak zayıf veya negatif kanıtlar hakim. Bu durumda "test commitment" veya "build narrow prototype" gibi ileri bir karar tutarsız görünüyor.'
    )
  }

  if (strongCount >= CONSISTENCY_STRONG_THRESHOLD && decision === 'stop') {
    warnings.push(
      'Analizde güçlü kanıtlar çoğunlukta. Bu durumda "stop" kararı verilmesi tutarsız görünebilir.'
    )
  }

  return warnings
}
