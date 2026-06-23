/**
 * Question Quality Tests
 *
 * Covers:
 * - UC2:  Bad question rewriting (verdict + replacement)
 * - UC3:  Mom-Test-safe interview script generation rules
 * - UC7:  Feature request → underlying problem probe
 * - UC11: Anti-pattern detection / script audit
 * - §3:   Global pass/fail rubric criteria
 * - §17:  Banned question patterns
 * - §18:  Evaluation checklist — question quality section
 *
 * Reference: mom-test-agent-testing-instructions.md §6, §7, §11, §15
 */

import { describe, it, expect } from 'vitest'
import type { InterviewQuestion, InterviewScript } from '@/types/index'

// ── Helpers ───────────────────────────────────────────────────────────────

/** Banned question patterns per §6 and §17 */
const BANNED_PATTERNS = [
  /would you use/i,
  /do you (like|think|want)/i,
  /would you pay/i,
  /would this (save|help|work|be useful)/i,
  /is this interesting/i,
  /should we build/i,
  /do you think this is a good idea/i,
  /could you imagine (using|trying)/i,
  /^would you/i,
  /do you like (our|this|the) (product|idea|app|tool)/i,
  /what features do you want/i,
  /is .* painful\?/i,
  /which feature should we build/i,
]

/** Past-behavior patterns — good questions per §7 */
const PAST_BEHAVIOR_PATTERNS = [
  /tell me about the last time/i,
  /walk me through (how|the last|your)/i,
  /when did (this|that) (happen|last occur)/i,
  /what did you do (next|after)/i,
  /how (often|long|much) (does|did|has)/i,
  /have you (ever |already )?(paid|tried|used|bought)/i,
  /what (tools|spreadsheet|system|people|process) (are|were|do you)/i,
  /what (happened|went wrong|broke)/i,
  /who else (should I|is involved|deals with)/i,
]

function containsBannedPattern(question: string): boolean {
  return BANNED_PATTERNS.some((re) => re.test(question))
}

function containsPastBehaviorPattern(question: string): boolean {
  return PAST_BEHAVIOR_PATTERNS.some((re) => re.test(question))
}

function auditScript(questions: string[]): {
  banned: string[]
  passed: string[]
  score: 0 | 1 | 2 | 3
} {
  const banned = questions.filter(containsBannedPattern)
  const passed = questions.filter((q) => !containsBannedPattern(q))
  const ratio = passed.length / questions.length
  const score: 0 | 1 | 2 | 3 =
    banned.length === questions.length ? 0
    : ratio < 0.5 ? 1
    : ratio < 1.0 ? 2
    : 3
  return { banned, passed, score }
}

// ── UC2 — Bad question detection and rewriting ────────────────────────────

describe('UC2 — Bad question detection and rewriting', () => {
  const badQuestions = [
    'Would you use a dashboard for sponsorships?',
    'Do you think this would save you time?',
    'How much would you pay for it?',
    'What features do you want?',
    'Is managing sponsorships painful?',
  ]

  it('detects all 5 UC2 questions as containing banned patterns', () => {
    badQuestions.forEach((q) => {
      expect(containsBannedPattern(q)).toBe(true)
    })
  })

  it('script audit scores 0 when all questions are banned', () => {
    const result = auditScript(badQuestions)
    expect(result.score).toBe(0)
    expect(result.banned).toHaveLength(5)
    expect(result.passed).toHaveLength(0)
  })

  const rewrittenQuestions = [
    'Walk me through the last sponsorship deal you managed.',
    'How much time did the last sponsorship deal take from first contact to payment?',
    'Have you paid for any tools, templates, assistants, or managers to help with sponsorships?',
    'What was the most annoying part of your last sponsorship workflow?',
    'Tell me about the last time something went wrong while managing a sponsorship.',
  ]

  it('rewritten questions do NOT contain banned patterns', () => {
    rewrittenQuestions.forEach((q) => {
      expect(containsBannedPattern(q)).toBe(false)
    })
  })

  it('rewritten questions contain past-behavior patterns', () => {
    const hasBehavior = rewrittenQuestions.filter(containsPastBehaviorPattern)
    expect(hasBehavior.length).toBeGreaterThanOrEqual(3)
  })

  it('rewritten audit scores 3 (strong pass)', () => {
    const result = auditScript(rewrittenQuestions)
    expect(result.score).toBe(3)
    expect(result.banned).toHaveLength(0)
  })

  it('"Would you use a dashboard?" is banned', () => {
    expect(containsBannedPattern('Would you use a dashboard for sponsorships?')).toBe(true)
  })

  it('"How much would you pay?" is banned', () => {
    expect(containsBannedPattern('How much would you pay for it?')).toBe(true)
  })

  it('"Do you think this would save you time?" is banned', () => {
    expect(containsBannedPattern('Do you think this would save you time?')).toBe(true)
  })
})

// ── UC3 — Mom-Test-safe interview script rules ────────────────────────────

describe('UC3 — Mom-Test-safe interview script structure', () => {
  /**
   * Reference script from §7 for the freelance invoice reminder brief.
   * 9 questions covering all required signal areas.
   */
  const referenceScript: InterviewScript = {
    goal: 'Learn how designers currently handle unpaid invoices and whether the problem creates enough urgency.',
    rulesForInterviewer: [
      'Do not pitch the product.',
      'Ask one question at a time.',
      'Ask for recent past examples.',
      'Redirect compliments to behavior.',
      'Probe vague answers.',
    ],
    questions: [
      { order: 1, question: 'Tell me about the last time a client paid an invoice late.', signalSought: 'problem', whyItPasses: 'Past event, not future hypothetical.' },
      { order: 2, question: 'How did you notice the payment was late?', signalSought: 'workflow', whyItPasses: 'Probes current detection method.' },
      { order: 3, question: 'What did you do next?', signalSought: 'workaround', whyItPasses: 'Reveals response behavior.' },
      { order: 4, question: 'What tools, reminders, spreadsheets, or people were involved?', signalSought: 'current system', whyItPasses: 'Maps existing toolkit.' },
      { order: 5, question: 'How often does this happen in a typical month?', signalSought: 'frequency', whyItPasses: 'Quantifies problem recurrence.' },
      { order: 6, question: 'What does late payment usually cost you in time, cash flow, or stress?', signalSought: 'cost and urgency', whyItPasses: 'Probes real impact.' },
      { order: 7, question: 'Have you ever paid for a tool, template, accountant, assistant, or service to help with this?', signalSought: 'budget behavior', whyItPasses: 'Past spending is strong evidence.' },
      { order: 8, question: 'What would make you change the way you handle this today?', signalSought: 'switching trigger', whyItPasses: 'Reveals inertia without pitching product.' },
      { order: 9, question: 'Who else should I talk to who deals with this often?', signalSought: 'referral', whyItPasses: 'Segment discovery and commitment signal.' },
    ],
  }

  it('script has 8-10 questions', () => {
    expect(referenceScript.questions.length).toBeGreaterThanOrEqual(8)
    expect(referenceScript.questions.length).toBeLessThanOrEqual(10)
  })

  it('no questions contain banned patterns', () => {
    referenceScript.questions.forEach((q: InterviewQuestion) => {
      expect(containsBannedPattern(q.question)).toBe(false)
    })
  })

  it('at least one question probes workaround', () => {
    const workaround = referenceScript.questions.find((q) =>
      /workaround|did (you do|you use|you try)|what did you do/i.test(q.question) ||
      q.signalSought === 'workaround'
    )
    expect(workaround).toBeDefined()
  })

  it('at least one question probes frequency', () => {
    const freq = referenceScript.questions.find((q) =>
      /how often|typical month|per month/i.test(q.question) ||
      q.signalSought === 'frequency'
    )
    expect(freq).toBeDefined()
  })

  it('at least one question probes cost or urgency', () => {
    const cost = referenceScript.questions.find((q) =>
      /cost|cash flow|stress|time|money|urgency/i.test(q.question) ||
      q.signalSought === 'cost and urgency'
    )
    expect(cost).toBeDefined()
  })

  it('at least one question probes existing spend or budget behavior', () => {
    const budget = referenceScript.questions.find((q) =>
      /paid for|pay for|budget|assistant|accountant|template/i.test(q.question) ||
      q.signalSought === 'budget behavior'
    )
    expect(budget).toBeDefined()
  })

  it('questions are ordered from context to commitment', () => {
    const orders = referenceScript.questions.map((q) => q.order)
    const isSorted = orders.every((v, i) => i === 0 || v > orders[i - 1])
    expect(isSorted).toBe(true)
  })

  it('rulesForInterviewer explicitly bans pitching the product', () => {
    const hasBan = referenceScript.rulesForInterviewer.some((r) =>
      /do not pitch|not pitch|never pitch/i.test(r)
    )
    expect(hasBan).toBe(true)
  })

  it('script audit scores 3 for reference script', () => {
    const questions = referenceScript.questions.map((q) => q.question)
    expect(auditScript(questions).score).toBe(3)
  })
})

// ── UC7 — Feature request → underlying problem probe ─────────────────────

describe('UC7 — Feature request translated to problem probe', () => {
  /**
   * Participant says: "It should integrate with WhatsApp so I can remind clients there."
   * Agent must NOT accept this as roadmap input.
   * Agent must probe the underlying workflow failure.
   */

  const featureRequest = 'It should integrate with WhatsApp so I can remind clients there.'
  const expectedProbe = 'What happened in your workflow that made WhatsApp reminders feel important? Can you tell me about the last client where email was not enough?'

  it('feature request itself is NOT a past-behavior question', () => {
    expect(containsPastBehaviorPattern(featureRequest)).toBe(false)
  })

  it('expected probe question contains past-behavior pattern', () => {
    expect(containsPastBehaviorPattern(expectedProbe)).toBe(true)
  })

  it('expected probe does not contain banned patterns', () => {
    expect(containsBannedPattern(expectedProbe)).toBe(false)
  })

  it('probe asks about last time / recent event', () => {
    expect(/last (client|time)|recent/i.test(expectedProbe)).toBe(true)
  })

  it('probe does not mention the proposed feature or product', () => {
    expect(/whatsapp integration|our product|our app|we are building/i.test(expectedProbe)).toBe(false)
  })

  it('feature request classification: should be weak evidence', () => {
    // Feature requests without underlying problem evidence are weak
    const isFeatureRequest = /should (integrate|add|have|include)|you should/i.test(featureRequest)
    expect(isFeatureRequest).toBe(true)
  })

  it('follow-up probe separates feature request from evidence', () => {
    // The probe asks about the PROBLEM (email not working), not the feature
    expect(/email was not enough|email/i.test(expectedProbe)).toBe(true)
  })
})

// ── UC11 — Anti-pattern detection / script audit ─────────────────────────

describe('UC11 — Script audit: full anti-pattern detection', () => {
  const antiPatternScript = [
    'Do you like our product idea?',
    'Would this save you time?',
    'Would you pay $10/month?',
    'Which feature should we build first?',
    'Could you imagine using it with clients?',
  ]

  it('all 5 anti-pattern questions are detected as banned', () => {
    antiPatternScript.forEach((q) => {
      expect(containsBannedPattern(q)).toBe(true)
    })
  })

  it('overall audit verdict is FAIL (score 0)', () => {
    const result = auditScript(antiPatternScript)
    expect(result.score).toBe(0)
  })

  it('"Do you like our product idea?" is banned (asks for praise)', () => {
    expect(containsBannedPattern('Do you like our product idea?')).toBe(true)
  })

  it('"Would this save you time?" is banned (hypothetical)', () => {
    expect(containsBannedPattern('Would this save you time?')).toBe(true)
  })

  it('"Would you pay $10/month?" is banned (imaginary pricing)', () => {
    expect(containsBannedPattern('Would you pay $10/month?')).toBe(true)
  })

  it('"Could you imagine using it with clients?" is banned (future speculation)', () => {
    expect(containsBannedPattern('Could you imagine using it with clients?')).toBe(true)
  })

  const replacementScript = [
    'How do you handle this workflow today?',
    'How much time did this take the last time it happened?',
    'Have you paid for anything to solve this?',
    'What broke or slowed you down in the last workflow?',
    'Tell me about the last client interaction where this problem appeared.',
  ]

  it('all 5 replacement questions pass the banned-pattern check', () => {
    replacementScript.forEach((q) => {
      expect(containsBannedPattern(q)).toBe(false)
    })
  })

  it('replacement script audit scores 3', () => {
    expect(auditScript(replacementScript).score).toBe(3)
  })

  it('replacements contain past-behavior language', () => {
    const behaviorCount = replacementScript.filter(containsPastBehaviorPattern).length
    expect(behaviorCount).toBeGreaterThanOrEqual(2)
  })
})

// ── §3 — Global pass/fail rubric ──────────────────────────────────────────

describe('§3 — Global pass/fail rubric scoring', () => {
  it('score 0: all questions banned → fail', () => {
    const questions = ['Would you use this?', 'Do you like it?', 'Would you pay?']
    expect(auditScript(questions).score).toBe(0)
  })

  it('score 1: less than 50% pass → weak', () => {
    const questions = [
      'Would you use this?',
      'Do you like it?',
      'Tell me about the last time this happened.',
    ]
    expect(auditScript(questions).score).toBe(1)
  })

  it('score 2: 50–99% pass → pass', () => {
    const questions = [
      'Would you use this?',
      'Tell me about the last time.',
      'How often does this happen?',
      'What tools do you use today?',
    ]
    expect(auditScript(questions).score).toBe(2)
  })

  it('score 3: 100% pass → strong pass', () => {
    const questions = [
      'Tell me about the last time a client paid late.',
      'What did you do next?',
      'How often does this happen?',
    ]
    expect(auditScript(questions).score).toBe(3)
  })
})

// ── §18 — Evaluation checklist: question quality ──────────────────────────

describe('§18 — Evaluation checklist: question quality criteria', () => {
  const goodScript: InterviewScript = {
    goal: 'Learn invoice follow-up pain.',
    rulesForInterviewer: ['Do not pitch the product.', 'Ask one question at a time.'],
    questions: [
      { order: 1, question: 'Tell me about the last invoice that was paid late.', signalSought: 'problem', whyItPasses: 'Past behavior.' },
      { order: 2, question: 'Walk me through what you did next.', signalSought: 'workaround', whyItPasses: 'Behavior.' },
      { order: 3, question: 'How often does this happen in a month?', signalSought: 'frequency', whyItPasses: 'Quantifies.' },
      { order: 4, question: 'What does it cost you in time or cash flow?', signalSought: 'cost', whyItPasses: 'Urgency.' },
      { order: 5, question: 'Have you paid for anything to help with this?', signalSought: 'budget', whyItPasses: 'Spend evidence.' },
    ],
  }

  it('checklist: questions focus on past behavior', () => {
    const pastBehaviorCount = goodScript.questions.filter((q) =>
      containsPastBehaviorPattern(q.question)
    ).length
    expect(pastBehaviorCount).toBeGreaterThanOrEqual(2)
  })

  it('checklist: questions avoid pitching the product', () => {
    goodScript.questions.forEach((q) => {
      expect(/our (app|product|tool|solution)|we are building|would you use our/i.test(q.question)).toBe(false)
    })
  })

  it('checklist: questions avoid hypotheticals', () => {
    goodScript.questions.forEach((q) => {
      expect(containsBannedPattern(q.question)).toBe(false)
    })
  })

  it('checklist: workaround is covered', () => {
    const hasWorkaround = goodScript.questions.some((q) =>
      /workaround|did (you do|you use)|what did you do/i.test(q.question) ||
      q.signalSought === 'workaround'
    )
    expect(hasWorkaround).toBe(true)
  })

  it('checklist: frequency is covered', () => {
    const hasFreq = goodScript.questions.some((q) =>
      /how often|per month|typical/i.test(q.question) ||
      q.signalSought === 'frequency'
    )
    expect(hasFreq).toBe(true)
  })

  it('checklist: cost or urgency is covered', () => {
    const hasCost = goodScript.questions.some((q) =>
      /cost|cash flow|time|stress|urgency/i.test(q.question) ||
      ['cost', 'cost and urgency', 'urgency'].includes(q.signalSought)
    )
    expect(hasCost).toBe(true)
  })

  it('checklist: existing spend or commitment is covered', () => {
    const hasSpend = goodScript.questions.some((q) =>
      /paid for|pay for|budget|assistant/i.test(q.question) ||
      q.signalSought === 'budget'
    )
    expect(hasSpend).toBe(true)
  })
})
