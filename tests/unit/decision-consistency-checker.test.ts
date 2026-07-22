/**
 * Unit tests — lib/decision-consistency-checker.ts
 *
 * Kapsam:
 * - Tutarlı strong + continue → boş uyarı
 * - Tutarsız weak/negative + "test commitment" → uyarı
 * - Tutarsız strong + "stop" → uyarı
 * - Sınırda karışık değerler (eşiğin tam altında) → boş uyarı
 * - Tam eşik durumları
 * - Her iki kuralın aynı anda tetiklenmediği durumlar
 *
 * Sıfır LLM / DB bağımlılığı.
 */

import { describe, it, expect } from 'vitest'
import { checkDecisionConsistency } from '@/lib/decision-consistency-checker'
import type { StructuredAnalysis } from '@/types/index'

// ── Fixture helper ────────────────────────────────────────────────────────────

function makeAnalysis(
  decision: string,
  problemEvidence: string,
  urgency: string,
  workaroundEvidence: string,
  budgetOrCommitment: string
): StructuredAnalysis {
  return {
    decision,
    summary: 'Test summary.',
    signalScore: {
      problemEvidence:    problemEvidence    as 'strong' | 'medium' | 'weak' | 'negative',
      urgency:            urgency            as 'strong' | 'medium' | 'weak' | 'negative',
      workaroundEvidence: workaroundEvidence as 'strong' | 'medium' | 'weak' | 'negative',
      budgetOrCommitment: budgetOrCommitment as 'strong' | 'medium' | 'weak' | 'negative',
    },
    strongEvidence:   [],
    mediumEvidence:   [],
    weakEvidence:     [],
    negativeEvidence: [],
    openQuestions:    [],
    recommendedNextStep: 'Run more interviews.',
  }
}

// ── Tutarlı senaryolar — boş uyarı bekleniyor ─────────────────────────────────

describe('checkDecisionConsistency — tutarlı senaryolar', () => {
  it('Senaryo 1: 4/4 strong + "continue discovery" → tutarlı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('continue discovery', 'strong', 'strong', 'strong', 'strong')
    )
    expect(warnings).toHaveLength(0)
  })

  it('Senaryo 2: karışık strong/medium + "continue discovery" → tutarlı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('continue discovery', 'strong', 'medium', 'strong', 'medium')
    )
    expect(warnings).toHaveLength(0)
  })

  it('Senaryo 3: 2 weak + 2 negative + "change segment" → tutarlı (ileri karar değil)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('change segment', 'weak', 'negative', 'weak', 'negative')
    )
    expect(warnings).toHaveLength(0)
  })

  it('Senaryo 4: 4/4 weak + "stop" → tutarlı (geri karar uygun)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('stop', 'weak', 'weak', 'weak', 'weak')
    )
    expect(warnings).toHaveLength(0)
  })

  it('Senaryo 5: 2 strong + 2 weak + "continue discovery" → tutarlı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('continue discovery', 'strong', 'strong', 'weak', 'weak')
    )
    expect(warnings).toHaveLength(0)
  })
})

// ── Tutarsız senaryolar — uyarı bekleniyor ────────────────────────────────────

describe('checkDecisionConsistency — tutarsız senaryolar', () => {
  it('Senaryo 1: 4/4 weak + "test commitment" → uyarı (zayıf kanıta rağmen ileri karar)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('test commitment', 'weak', 'weak', 'weak', 'weak')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('test commitment')
    expect(warnings[0]).toContain('4/4')
  })

  it('Senaryo 2: 3 weak + 1 negative + "test commitment" → uyarı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('test commitment', 'weak', 'weak', 'weak', 'negative')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('test commitment')
  })

  it('Senaryo 3: 3 negative + 1 weak + "build narrow prototype" → uyarı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('build narrow prototype', 'negative', 'negative', 'negative', 'weak')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('build narrow prototype')
  })

  it('Senaryo 4: 4/4 strong + "stop" → uyarı (güçlü kanıta rağmen durdurma)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('stop', 'strong', 'strong', 'strong', 'strong')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('stop')
    expect(warnings[0]).toContain('4/4')
  })

  it('Senaryo 5: 3 strong + 1 medium + "stop" → uyarı', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('stop', 'strong', 'strong', 'strong', 'medium')
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('stop')
  })
})

// ── Sınır durumları — eşiğin tam altı ───────────────────────────────────────

describe('checkDecisionConsistency — sınır durumları', () => {
  it('2 weak + 2 medium + "test commitment" → tutarlı (eşik altında: 2 < 3)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('test commitment', 'weak', 'weak', 'medium', 'medium')
    )
    expect(warnings).toHaveLength(0)
  })

  it('2 strong + 2 medium + "stop" → tutarlı (eşik altında: 2 < 3)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('stop', 'strong', 'strong', 'medium', 'medium')
    )
    expect(warnings).toHaveLength(0)
  })

  it('3 weak + 1 medium + "test commitment" → UYARI (tam eşik: 3 ≥ 3)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('test commitment', 'weak', 'weak', 'weak', 'medium')
    )
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('3 strong + 1 medium + "stop" → UYARI (tam eşik: 3 ≥ 3)', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('stop', 'strong', 'strong', 'strong', 'medium')
    )
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('"continue discovery" hiçbir zaman Kural 1 uyarısı almaz', () => {
    // "continue discovery" FORWARD_DECISIONS içinde değil
    const warnings = checkDecisionConsistency(
      makeAnalysis('continue discovery', 'weak', 'weak', 'weak', 'weak')
    )
    expect(warnings).toHaveLength(0)
  })

  it('"change segment" hiçbir zaman Kural 1 uyarısı almaz', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('change segment', 'weak', 'weak', 'weak', 'weak')
    )
    expect(warnings).toHaveLength(0)
  })

  it('uyarı string içeriği decision adını ve sayıyı içeriyor', () => {
    const warnings = checkDecisionConsistency(
      makeAnalysis('build narrow prototype', 'negative', 'negative', 'negative', 'negative')
    )
    expect(warnings[0]).toMatch(/build narrow prototype/i)
    expect(warnings[0]).toMatch(/\d+\/4/)
  })
})
