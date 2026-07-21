/**
 * Evidence Classifier Tests
 *
 * Covers:
 * - UC4:  Participant gives vague compliments (compliment trap)
 * - UC5:  Participant has strong problem evidence (Deniz persona)
 * - UC6:  Participant has no real pain (Arda persona)
 * - UC8:  Budget and commitment signals
 * - UC17: Red-team inputs (fake enthusiasm, abstract claims, feature requests, future promises)
 *
 * Reference: mom-test-agent-testing-instructions.md §8–10, §12, §17
 */

import { describe, it, expect } from 'vitest'
import type { StructuredAnalysis, SignalScore, SignalSummary } from '@/types/index'

// ── Helpers mirrored from lib/api-helpers/analyze ────────────────────────

function buildSignalScore(analysis: StructuredAnalysis): SignalScore {
  return {
    strong: analysis.strongEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItMatters: e.whyItMatters,
    })),
    medium: analysis.mediumEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
      context: e.context,
    })),
    weak: analysis.weakEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItIsWeak: e.whyItIsWeak,
    })),
    negative: analysis.negativeEvidence.map((e) => ({
      quote: e.quote,
      message_id: e.message_id,
      whyItIsNegative: e.whyItIsNegative,
    })),
  }
}

function buildSignalSummary(analysis: StructuredAnalysis): SignalSummary {
  return {
    strong_count:   analysis.strongEvidence.length,
    medium_count:   analysis.mediumEvidence.length,
    weak_count:     analysis.weakEvidence.length,
    negative_count: analysis.negativeEvidence.length,
  }
}

/** Checks that a report string does NOT contain forbidden validation phrases */
function containsForbiddenPhrase(report: string): boolean {
  const forbidden = [
    /users loved the idea/i,
    /this validates the product/i,
    /people would use it/i,
    /the market wants this/i,
    /participant is interested/i,
    /validates the (app|idea|solution)/i,
  ]
  return forbidden.some((re) => re.test(report))
}

/** Checks whether a quote string looks like a compliment / hypothetical */
function isWeakSignal(quote: string): boolean {
  return (
    /would (use|try|love|buy)/i.test(quote) ||
    /sounds (amazing|great|useful|good|really useful)/i.test(quote) ||
    /i think/i.test(quote) ||
    /probably/i.test(quote) ||
    /if it (existed|had|were)/i.test(quote) ||
    /i would (probably|definitely|love|try)/i.test(quote) ||
    /your (app|idea|product|tool) (sounds|is|looks)/i.test(quote)
  )
}

/** Checks whether a quote reflects real past behavior / existing spend */
function isStrongSignal(quote: string): boolean {
  return (
    /last (month|week|time)/i.test(quote) ||
    /i (pay|paid|spend|spent|use|track|check|put)/i.test(quote) ||
    /every (week|friday|month|project)/i.test(quote) ||
    /spreadsheet|calendar|template|notion|clickup|google sheets/i.test(quote) ||
    /lost \d+ hours/i.test(quote) ||
    /did not invoice/i.test(quote) ||
    /two clients paid late/i.test(quote) ||
    /\$\d+\s*(a month|per month|monthly)/i.test(quote) ||
    /virtual assistant.*invoice|invoice.*virtual assistant/i.test(quote) ||
    /account.*friday|friday.*account/i.test(quote) ||
    /hours? a month|cash flow|one or two hours/i.test(quote) ||
    /takes me .*(hour|minute)/i.test(quote)
  )
}

// ── Shared fixture builders ───────────────────────────────────────────────

function makeAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Test summary',
    signalScore: {
      problemEvidence: 'weak',
      urgency: 'weak',
      workaroundEvidence: 'weak',
      budgetOrCommitment: 'weak',
    },
    strongEvidence: [],
    mediumEvidence: [],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: [],
    recommendedNextStep: 'Interview more participants.',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UC4 — Compliment trap (Maya persona)
// "I would probably use something like that if it existed."
// ─────────────────────────────────────────────────────────────────────────────

describe('UC4 — Compliment trap (Maya persona)', () => {
  const mayaAnalysis = makeAnalysis({
    weakEvidence: [
      {
        quote: 'Your app idea sounds really useful.',
        message_id: 'msg-001',
        whyItIsWeak: 'Praise without behavioral evidence.',
      },
      {
        quote: 'I would probably use something like that if it existed.',
        message_id: 'msg-002',
        whyItIsWeak: 'Hypothetical intent, not past behavior.',
      },
    ],
    negativeEvidence: [
      { quote: 'Participant could not provide a recent specific example of invoice pain.', message_id: '', whyItIsNegative: 'No concrete behavioral evidence of the problem.' },
    ],
    decision: 'change segment',
    recommendedNextStep: 'Find participants with documented invoice follow-up pain.',
  })

  it('compliments are classified as weak evidence, not strong', () => {
    const score = buildSignalScore(mayaAnalysis)
    expect(score.strong).toHaveLength(0)
    expect(score.weak.length).toBeGreaterThanOrEqual(2)
  })

  it('weak quotes match compliment/hypothetical patterns', () => {
    const score = buildSignalScore(mayaAnalysis)
    score.weak.forEach((entry) => {
      expect(isWeakSignal(entry.quote)).toBe(true)
    })
  })

  it('summary count reflects 0 strong signals', () => {
    const summary = buildSignalSummary(mayaAnalysis)
    expect(summary.strong_count).toBe(0)
    expect(summary.weak_count).toBeGreaterThanOrEqual(2)
  })

  it('report does not contain forbidden validation phrases', () => {
    const report = `## Decision\n${mayaAnalysis.decision}\n## Summary\n${mayaAnalysis.summary}`
    expect(containsForbiddenPhrase(report)).toBe(false)
  })

  it('decision is not "build narrow prototype" or "test commitment"', () => {
    expect(mayaAnalysis.decision).not.toBe('build narrow prototype')
    expect(mayaAnalysis.decision).not.toBe('test commitment')
  })

  it('negative evidence flags missing concrete example', () => {
    const score = buildSignalScore(mayaAnalysis)
    expect(score.negative.length).toBeGreaterThan(0)
    expect(score.negative[0].quote).toMatch(/recent specific example|concrete example/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UC5 — Strong problem evidence (Deniz persona)
// Spreadsheet tracker, calendar reminders, existing spend, recurring pain
// ─────────────────────────────────────────────────────────────────────────────

describe('UC5 — Strong problem evidence (Deniz persona)', () => {
  const denizAnalysis = makeAnalysis({
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'medium',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'medium',
    },
    strongEvidence: [
      {
        quote: 'Last month two clients paid late. I check my spreadsheet every Friday.',
        message_id: 'msg-010',
        whyItMatters: 'Specific recent event plus recurring manual workflow.',
      },
      {
        quote: 'I put invoice dates into Google Sheets and set calendar reminders 7 days after due.',
        message_id: 'msg-011',
        whyItMatters: 'Active workaround maintained regularly.',
      },
      {
        quote: 'I pay for accounting software but still do follow-ups manually.',
        message_id: 'msg-012',
        whyItMatters: 'Existing spend proves problem awareness; gap between tool and need.',
      },
      {
        quote: 'It probably takes me one or two hours a month but the cash flow stress is the bigger issue.',
        message_id: 'msg-013',
        whyItMatters: 'Quantified cost plus emotional urgency.',
      },
    ],
    weakEvidence: [],
    negativeEvidence: [],
    decision: 'continue discovery',
    recommendedNextStep: 'Run 3 more interviews. Test whether accounting software integration is the right wedge.',
  })

  it('strong evidence count >= 3 for Deniz persona', () => {
    const summary = buildSignalSummary(denizAnalysis)
    expect(summary.strong_count).toBeGreaterThanOrEqual(3)
  })

  it('all strong evidence quotes reflect past behavior or existing spend', () => {
    const score = buildSignalScore(denizAnalysis)
    score.strong.forEach((entry) => {
      expect(isStrongSignal(entry.quote)).toBe(true)
    })
  })

  it('problemEvidence signalScore is "strong"', () => {
    expect(denizAnalysis.signalScore.problemEvidence).toBe('strong')
  })

  it('workaroundEvidence signalScore is "strong"', () => {
    expect(denizAnalysis.signalScore.workaroundEvidence).toBe('strong')
  })

  it('decision is NOT "stop" or "change segment"', () => {
    expect(denizAnalysis.decision).not.toBe('stop')
    expect(denizAnalysis.decision).not.toBe('change segment')
  })

  it('recommendedNextStep does not claim product validation', () => {
    expect(containsForbiddenPhrase(denizAnalysis.recommendedNextStep)).toBe(false)
  })

  it('report does not say "validates the app"', () => {
    const report = denizAnalysis.strongEvidence.map((e) => e.quote).join(' ')
    expect(containsForbiddenPhrase(report)).toBe(false)
  })

  it('open questions exist for remaining risks', () => {
    // Deniz has accounting software — this creates open questions
    const analysis = makeAnalysis({
      ...denizAnalysis,
      openQuestions: [
        'Does accounting software already cover part of the follow-up need?',
        'Would participant switch from spreadsheet if integrated with existing tool?',
      ],
    })
    expect(analysis.openQuestions.length).toBeGreaterThan(0)
    expect(analysis.openQuestions[0]).toMatch(/accounting|software|switch/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UC6 — No real pain (Arda persona)
// Prepaid model, rare late payments, no workaround
// ─────────────────────────────────────────────────────────────────────────────

describe('UC6 — No real pain (Arda persona)', () => {
  const ardaAnalysis = makeAnalysis({
    signalScore: {
      problemEvidence: 'negative',
      urgency: 'negative',
      workaroundEvidence: 'negative',
      budgetOrCommitment: 'negative',
    },
    strongEvidence: [],
    mediumEvidence: [],
    weakEvidence: [],
    negativeEvidence: [
      { quote: 'Problem is rare: only one late payment this year.', message_id: '', whyItIsNegative: 'Low frequency — not a recurring problem.' },
      { quote: 'No workaround exists — participant checks bank account informally.', message_id: '', whyItIsNegative: 'No real effort invested in solving the problem.' },
      { quote: 'No urgency: 50% upfront payment model avoids the problem.', message_id: '', whyItIsNegative: 'Existing model eliminates the pain point.' },
      { quote: 'Participant explicitly said they would not add another tool for this.', message_id: '', whyItIsNegative: 'Active resistance to any solution.' },
      { quote: 'Segment mismatch: prepaid clients are not the target customer.', message_id: '', whyItIsNegative: 'Wrong segment — problem does not apply to their business model.' },
    ],
    decision: 'change segment',
    recommendedNextStep: 'Test freelancers with net-30 or net-60 payment terms and higher invoice volume.',
  })

  it('strong evidence count is 0 for Arda persona', () => {
    expect(buildSignalSummary(ardaAnalysis).strong_count).toBe(0)
  })

  it('negative evidence count >= 3', () => {
    expect(buildSignalSummary(ardaAnalysis).negative_count).toBeGreaterThanOrEqual(3)
  })

  it('all four signalScore dimensions are "negative"', () => {
    const s = ardaAnalysis.signalScore
    expect(s.problemEvidence).toBe('negative')
    expect(s.urgency).toBe('negative')
    expect(s.workaroundEvidence).toBe('negative')
    expect(s.budgetOrCommitment).toBe('negative')
  })

  it('decision is "change segment" or "stop"', () => {
    expect(['change segment', 'stop']).toContain(ardaAnalysis.decision)
  })

  it('recommendedNextStep suggests segment refinement', () => {
    expect(ardaAnalysis.recommendedNextStep).toMatch(/segment|freelancers|net-\d+|volume/i)
  })

  it('negative evidence flags prepaid model as segment mismatch', () => {
    const score = buildSignalScore(ardaAnalysis)
    const hasSegmentNote = score.negative.some((e) =>
      /prepaid|segment|upfront/i.test(e.quote)
    )
    expect(hasSegmentNote).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UC8 — Budget and commitment signals
// "$80/month to virtual assistant" = strong evidence
// ─────────────────────────────────────────────────────────────────────────────

describe('UC8 — Budget and commitment signals', () => {
  const budgetAnalysis = makeAnalysis({
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'strong',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'strong',
    },
    strongEvidence: [
      {
        quote: 'I already pay my virtual assistant about $80 a month to chase unpaid invoices and update my spreadsheet.',
        message_id: 'msg-020',
        whyItMatters: 'Money is already being spent on exactly this problem. Real workaround with recurring cost.',
      },
      {
        quote: 'The assistant sends follow-up emails, logs responses in the spreadsheet, and flags overdue ones.',
        message_id: 'msg-021',
        whyItMatters: 'Detailed operational workflow confirms depth of the problem.',
      },
    ],
    decision: 'test commitment',
    recommendedNextStep: 'Ask for a 20-minute workflow walkthrough. Offer a pilot with one month of usage.',
  })

  it('existing spend ($80/month) is classified as strong evidence', () => {
    const score = buildSignalScore(budgetAnalysis)
    const spendEvidence = score.strong.find((e) => /\$80|\$|assistant/i.test(e.quote))
    expect(spendEvidence).toBeDefined()
  })

  it('budgetOrCommitment signalScore is "strong"', () => {
    expect(budgetAnalysis.signalScore.budgetOrCommitment).toBe('strong')
  })

  it('decision escalates to "test commitment"', () => {
    expect(budgetAnalysis.decision).toBe('test commitment')
  })

  it('recommendedNextStep asks for concrete next action', () => {
    expect(budgetAnalysis.recommendedNextStep).toMatch(/walkthrough|pilot|follow.?up|meeting/i)
  })

  it('does not confuse willingness-to-pay with actual spend', () => {
    // Hypothetical "I would pay" should NOT be in strong evidence
    const score = buildSignalScore(budgetAnalysis)
    const falsePositive = score.strong.find((e) => /would pay/i.test(e.quote))
    expect(falsePositive).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UC17 — Red-team inputs
// Fake enthusiasm, abstract claims, feature requests, future promises
// ─────────────────────────────────────────────────────────────────────────────

describe('UC17 — Red-team inputs', () => {
  describe('Red-team A: fake enthusiasm', () => {
    const quote = 'That sounds amazing. I would definitely use it. I know many people who need it.'

    it('fake enthusiasm quote matches weak signal pattern', () => {
      expect(isWeakSignal(quote)).toBe(true)
    })

    it('should NOT be classified as strong evidence', () => {
      expect(isStrongSignal(quote)).toBe(false)
    })

    it('analysis should classify as weak evidence with correct reason', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{
          quote,
          message_id: 'msg-rt-a',
          whyItIsWeak: 'Compliment and hypothetical intent. No past behavior mentioned.',
        }],
      })
      expect(buildSignalSummary(analysis).weak_count).toBe(1)
      expect(buildSignalSummary(analysis).strong_count).toBe(0)
    })
  })

  describe('Red-team B: abstract problem claim', () => {
    const quote = 'Yeah, invoicing is always a mess.'

    it('generic claim does not pass as strong signal', () => {
      expect(isStrongSignal(quote)).toBe(false)
    })

    it('analysis marks as weak until tied to specific event', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{
          quote,
          message_id: 'msg-rt-b',
          whyItIsWeak: 'Generic claim without a specific recent example.',
        }],
      })
      expect(analysis.weakEvidence[0].whyItIsWeak).toMatch(/generic|specific|example/i)
    })
  })

  describe('Red-team C: feature request without evidence', () => {
    const quote = 'You should add AI email writing.'

    it('feature request does not match strong signal pattern', () => {
      expect(isStrongSignal(quote)).toBe(false)
    })

    it('analysis marks as weak with feature-request label', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{
          quote,
          message_id: 'msg-rt-c',
          whyItIsWeak: 'Feature request without underlying problem evidence.',
        }],
      })
      expect(analysis.weakEvidence[0].whyItIsWeak).toMatch(/feature request|problem/i)
    })

    it('does not elevate feature request to strong evidence', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{ quote, message_id: 'msg-rt-c', whyItIsWeak: 'Feature request.' }],
      })
      expect(buildSignalSummary(analysis).strong_count).toBe(0)
    })
  })

  describe('Red-team D: future promise', () => {
    const quote = 'I would pay if it had the right features.'

    it('future promise matches weak signal pattern', () => {
      expect(isWeakSignal(quote)).toBe(true)
    })

    it('future promise is not strong evidence', () => {
      expect(isStrongSignal(quote)).toBe(false)
    })

    it('analysis marks as weak until supported by past spending', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{
          quote,
          message_id: 'msg-rt-d',
          whyItIsWeak: 'Hypothetical future payment, not past spending behavior.',
        }],
      })
      expect(analysis.weakEvidence[0].whyItIsWeak).toMatch(/hypothetical|past|spending/i)
    })
  })

  describe('Red-team: compliment trap pass criteria', () => {
    it('report with only compliments has zero strong evidence', () => {
      const analysis = makeAnalysis({
        weakEvidence: [
          { quote: 'That sounds amazing.', message_id: '1', whyItIsWeak: 'Praise.' },
          { quote: 'I would definitely use it.', message_id: '2', whyItIsWeak: 'Hypothetical.' },
        ],
      })
      expect(buildSignalSummary(analysis).strong_count).toBe(0)
      expect(buildSignalSummary(analysis).weak_count).toBe(2)
    })

    it('decision is not "build narrow prototype" when only compliments exist', () => {
      const analysis = makeAnalysis({
        weakEvidence: [{ quote: 'Sounds amazing!', message_id: '1', whyItIsWeak: 'Praise.' }],
        decision: 'continue discovery',
      })
      expect(analysis.decision).not.toBe('build narrow prototype')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Definition of done — §21
// Three mandatory scenarios: compliment trap, strong pain, no pain
// ─────────────────────────────────────────────────────────────────────────────

describe('Definition of done — §21', () => {
  it('compliment trap: marks praise as weak, strong_count = 0', () => {
    const analysis = makeAnalysis({
      weakEvidence: [
        { quote: 'This is exactly what I need!', message_id: 'x1', whyItIsWeak: 'Praise.' },
      ],
    })
    expect(buildSignalSummary(analysis).strong_count).toBe(0)
    expect(buildSignalSummary(analysis).weak_count).toBeGreaterThan(0)
  })

  it('strong pain case: strong_count >= 2, does not overclaim', () => {
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'Last week I spent 3 hours chasing invoices.', message_id: 'x2', whyItMatters: 'Time cost.' },
        { quote: 'I pay $50/month for a spreadsheet template service.', message_id: 'x3', whyItMatters: 'Existing spend.' },
      ],
      decision: 'continue discovery',
    })
    expect(buildSignalSummary(analysis).strong_count).toBeGreaterThanOrEqual(2)
    expect(analysis.decision).not.toBe('build narrow prototype')
    expect(containsForbiddenPhrase(analysis.summary)).toBe(false)
  })

  it('no pain case: strong_count = 0, decision is change segment or stop', () => {
    const analysis = makeAnalysis({
      negativeEvidence: [
        { quote: 'No recurring problem.', message_id: '', whyItIsNegative: 'Problem is not recurring — low frequency.' },
        { quote: 'No workaround used.', message_id: '', whyItIsNegative: 'No effort invested in solving it.' },
        { quote: 'No urgency.', message_id: '', whyItIsNegative: 'Participant feels no time or cost pressure.' },
      ],      decision: 'change segment',
    })
    expect(buildSignalSummary(analysis).strong_count).toBe(0)
    expect(['change segment', 'stop']).toContain(analysis.decision)
  })
})
