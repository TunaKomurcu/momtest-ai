/**
 * Decision Consistency Checker — Deterministik, sıfır LLM çağrısı.
 *
 * LLM'in ürettiği `decision` ile `signalScore` (4 boyut) arasındaki
 * mantıksal tutarsızlıkları tespit eder.
 * Prefix: [Analyze/consistency]
 */

import type { StructuredAnalysis } from '@/types/index'

// ---------------------------------------------------------------------------
// Ayarlanabilir eşikler — magic number gömme
// ---------------------------------------------------------------------------

/** Kaç boyutun weak/negative olması durumunda ileri karar tutarsız sayılır */
const WEAK_NEGATIVE_THRESHOLD = 3

/** Kaç boyutun strong olması durumunda 'stop' kararı tutarsız sayılır */
const STRONG_THRESHOLD = 3

/** İleri karar gerektiren decision değerleri */
const FORWARD_DECISIONS = new Set(['test commitment', 'build narrow prototype'])

/** Geri karar değerleri */
const BACKWARD_DECISIONS = new Set(['stop'])

// ---------------------------------------------------------------------------
// Yardımcı
// ---------------------------------------------------------------------------

type SignalLevel = 'strong' | 'medium' | 'weak' | 'negative'

function countLevels(
  score: StructuredAnalysis['signalScore'],
  levels: SignalLevel[]
): number {
  return [
    score.problemEvidence,
    score.urgency,
    score.workaroundEvidence,
    score.budgetOrCommitment,
  ].filter(v => levels.includes(v)).length
}

// ---------------------------------------------------------------------------
// checkDecisionConsistency
// ---------------------------------------------------------------------------

/**
 * decision ile signalScore arasındaki tutarsızlıkları döndürür.
 * Boş dizi → tutarsızlık yok.
 *
 * Kurallar:
 * 1. weak/negative sayısı ≥ WEAK_NEGATIVE_THRESHOLD VE
 *    decision ∈ FORWARD_DECISIONS → tutarsız (zayıf kanıta rağmen ileri karar)
 * 2. strong sayısı ≥ STRONG_THRESHOLD VE
 *    decision ∈ BACKWARD_DECISIONS → tutarsız (güçlü kanıta rağmen geri karar)
 */
export function checkDecisionConsistency(
  analysis: StructuredAnalysis
): string[] {
  const warnings: string[] = []
  const score = analysis.signalScore
  const decision = analysis.decision.toLowerCase().trim()

  const weakNegCount = countLevels(score, ['weak', 'negative'])
  const strongCount  = countLevels(score, ['strong'])

  // Kural 1: Zayıf kanıta rağmen ileri karar
  if (weakNegCount >= WEAK_NEGATIVE_THRESHOLD && FORWARD_DECISIONS.has(decision)) {
    const levelSummary = [
      `problemEvidence: ${score.problemEvidence}`,
      `urgency: ${score.urgency}`,
      `workaroundEvidence: ${score.workaroundEvidence}`,
      `budgetOrCommitment: ${score.budgetOrCommitment}`,
    ].join(', ')

    warnings.push(
      `Tutarsızlık: "${decision}" kararı verilmiş ancak ${weakNegCount}/4 sinyal boyutu ` +
      `weak/negative (${levelSummary}). Bu karar için yeterli kanıt gücü olmayabilir.`
    )

    console.warn(
      `[Analyze/consistency] Kural 1 tetiklendi — decision: "${decision}", ` +
      `weak/negative: ${weakNegCount}/4 (eşik: ${WEAK_NEGATIVE_THRESHOLD})`
    )
  }

  // Kural 2: Güçlü kanıta rağmen geri karar
  if (strongCount >= STRONG_THRESHOLD && BACKWARD_DECISIONS.has(decision)) {
    const levelSummary = [
      `problemEvidence: ${score.problemEvidence}`,
      `urgency: ${score.urgency}`,
      `workaroundEvidence: ${score.workaroundEvidence}`,
      `budgetOrCommitment: ${score.budgetOrCommitment}`,
    ].join(', ')

    warnings.push(
      `Tutarsızlık: "${decision}" kararı verilmiş ancak ${strongCount}/4 sinyal boyutu ` +
      `strong (${levelSummary}). Güçlü kanıt varken durdurma kararı beklenmedik olabilir.`
    )

    console.warn(
      `[Analyze/consistency] Kural 2 tetiklendi — decision: "${decision}", ` +
      `strong: ${strongCount}/4 (eşik: ${STRONG_THRESHOLD})`
    )
  }

  if (warnings.length === 0) {
    console.log(
      `[Analyze/consistency] Tutarlı — decision: "${decision}", ` +
      `strong: ${strongCount}/4, weak/negative: ${weakNegCount}/4`
    )
  }

  return warnings
}
