/**
 * Unit tests — lib/decision-consistency-checker.ts
 *
 * Kapsam:
 * - tutarlı strong+continue
 * - tutarsız weak+commitment
 * - tutarsız strong+stop
 * - sınırda karışık değerler
 */

import { describe, it, expect } from 'vitest'
import { checkDecisionConsistency } from '@/lib/decision-consistency-checker'
import type { StructuredAnalysis } from '@/types/index'

function makeAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Summary',
    signalScore: {
      problemEvidence: 'medium',
      urgency: 'medium',
      workaroundEvidence: 'medium',
      budgetOrCommitment: 'medium',
    },
    strongEvidence: [],
    mediumEvidence: [],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: [],
    recommendedNextStep: 'Do something',
    ...overrides,
  }
}

describe('checkDecisionConsistency', () => {
  it('tutarlı strong+continue durumda uyarı üretmez', () => {
    const analysis = makeAnalysis({
      decision: 'continue discovery',
      signalScore: {
        problemEvidence: 'strong',
        urgency: 'strong',
        workaroundEvidence: 'strong',
        budgetOrCommitment: 'medium',
      },
    })

    expect(checkDecisionConsistency(analysis)).toEqual([])
  })

  it('tutarsız weak+commitment durumda uyarı üretir', () => {
    const analysis = makeAnalysis({
      decision: 'test commitment',
      signalScore: {
        problemEvidence: 'weak',
        urgency: 'weak',
        workaroundEvidence: 'negative',
        budgetOrCommitment: 'strong',
      },
    })

    const warnings = checkDecisionConsistency(analysis)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/zayıf veya negatif kanıt/)
  })

  it('tutarsız strong+stop durumda uyarı üretir', () => {
    const analysis = makeAnalysis({
      decision: 'stop',
      signalScore: {
        problemEvidence: 'strong',
        urgency: 'strong',
        workaroundEvidence: 'strong',
        budgetOrCommitment: 'weak',
      },
    })

    const warnings = checkDecisionConsistency(analysis)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/güçlü kanıtlar çoğunlukta/)
  })

  it('sınırda karışık değerler durumunda yalnızca uygun uyarıları üretir', () => {
    const analysis = makeAnalysis({
      decision: 'change segment',
      signalScore: {
        problemEvidence: 'strong',
        urgency: 'weak',
        workaroundEvidence: 'weak',
        budgetOrCommitment: 'negative',
      },
    })

    expect(checkDecisionConsistency(analysis)).toEqual([])
  })
})
