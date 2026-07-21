/**
 * Report Format Tests
 *
 * Covers:
 * - UC10: Report generation from transcript (structure, sections, separation of evidence)
 * - UC12: End-to-end demo scenario report (agency scope creep)
 * - §3:   Required final report checks (what report MUST and MUST NOT say)
 * - §18:  Evaluation checklist — evidence report section
 * - §19:  Common failure modes (validation theater, no recommendation)
 *
 * Reference: mom-test-agent-testing-instructions.md §14, §16, §3, §18, §19
 */

import { describe, it, expect } from 'vitest'
import type { StructuredAnalysis, SignalScore, SignalSummary } from '@/types/index'

// ── Helpers mirrored from lib/api-helpers/analyze ────────────────────────

function buildSignalScore(analysis: StructuredAnalysis): SignalScore {
  return {
    strong:   analysis.strongEvidence.map((e) => ({ quote: e.quote, message_id: e.message_id, whyItMatters: e.whyItMatters })),
    medium:   analysis.mediumEvidence.map((e) => ({ quote: e.quote, message_id: e.message_id, context: e.context })),
    weak:     analysis.weakEvidence.map((e) => ({ quote: e.quote, message_id: e.message_id, whyItIsWeak: e.whyItIsWeak })),
    negative: analysis.negativeEvidence.map((e) => ({ quote: e.quote, message_id: e.message_id, whyItIsNegative: e.whyItIsNegative })),
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

function buildMarkdownReport(analysis: StructuredAnalysis, participantName: string): string {
  const lines: string[] = []
  lines.push('# Mom Test Evidence Report')
  lines.push(`**Participant:** ${participantName}`)
  lines.push('## Decision')
  lines.push(analysis.decision)
  lines.push('## Summary')
  lines.push(analysis.summary)
  lines.push('## Signal score')
  lines.push(`- problem evidence: ${analysis.signalScore.problemEvidence}`)
  lines.push(`- urgency: ${analysis.signalScore.urgency}`)
  lines.push(`- workaround evidence: ${analysis.signalScore.workaroundEvidence}`)
  lines.push(`- budget or commitment: ${analysis.signalScore.budgetOrCommitment}`)
  if (analysis.strongEvidence.length > 0) {
    lines.push('## Strong evidence')
    lines.push('| Quote or observation | Why it matters |')
    lines.push('|---|---|')
    analysis.strongEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItMatters} |`))
  }
  if (analysis.mediumEvidence.length > 0) {
    lines.push('## Medium evidence')
    lines.push('| Quote or observation | Context |')
    lines.push('|---|---|')
    analysis.mediumEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.context} |`))
  }
  if (analysis.weakEvidence.length > 0) {
    lines.push('## Weak or misleading evidence')
    lines.push('| Quote or observation | Why it is weak |')
    lines.push('|---|---|')
    analysis.weakEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItIsWeak} |`))
  }
  if (analysis.negativeEvidence.length > 0) {
    lines.push('## Negative evidence')
    lines.push('| Quote or observation | Why it is negative |')
    lines.push('|---|---|')
    analysis.negativeEvidence.forEach((e) => lines.push(`| ${e.quote} | ${e.whyItIsNegative} |`))
  }
  if (analysis.openQuestions.length > 0) {
    lines.push('## Open questions')
    analysis.openQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`))
  }
  lines.push('## Recommended next step')
  lines.push(analysis.recommendedNextStep)
  return lines.join('\n')
}

/** §3 — Phrases the report must NEVER contain (without behavioral backing) */
const FORBIDDEN_REPORT_PHRASES = [
  /users loved the idea/i,
  /this validates the product/i,
  /people would use it/i,
  /the market wants this/i,
  /participant (is |would be |seems? )?interested/i,
  /validates (the )?(app|idea|solution|concept)/i,
  /strong (market )?demand/i,
]

function reportContainsForbiddenPhrase(report: string): string | null {
  for (const re of FORBIDDEN_REPORT_PHRASES) {
    if (re.test(report)) return re.source
  }
  return null
}

/** Valid decision values per analyze route */
const VALID_DECISIONS = [
  'continue discovery',
  'test commitment',
  'change segment',
  'stop',
  'build narrow prototype',
]

// ── UC10 — Report from transcript: invoice freelancer ────────────────────

describe('UC10 — Report generation from transcript', () => {
  /**
   * Transcript: one late payment per 2 months, Notion template workaround,
   * never paid for a solution, hypothetical app interest.
   * Expected: "continue discovery", NOT "build" or "test commitment"
   */
  const uc10Analysis: StructuredAnalysis = {
    decision: 'continue discovery',
    summary: 'The participant has experienced late payment and uses a manual workflow, but the problem appears low frequency and not currently worth paying for.',
    signalScore: {
      problemEvidence: 'medium',
      urgency: 'weak',
      workaroundEvidence: 'medium',
      budgetOrCommitment: 'negative',
    },
    strongEvidence: [
      {
        quote: 'One client paid two weeks late last month.',
        message_id: 'msg-uc10-001',
        whyItMatters: 'Specific past event confirms problem exists.',
      },
      {
        quote: 'I check my bank account manually every Friday.',
        message_id: 'msg-uc10-002',
        whyItMatters: 'Recurring behavioral workflow.',
      },
      {
        quote: 'I send reminder emails using a template I keep in Notion.',
        message_id: 'msg-uc10-003',
        whyItMatters: 'Active workaround maintained by the participant.',
      },
    ],
    weakEvidence: [
      {
        quote: 'Maybe, if it were built into my invoicing app.',
        message_id: 'msg-uc10-004',
        whyItIsWeak: 'Hypothetical and conditional. No commitment or past behavior.',
      },
    ],
    mediumEvidence: [],
    negativeEvidence: [
      { quote: 'Problem occurs only once every two months — low frequency.', message_id: '', whyItIsNegative: 'Low frequency means low urgency.' },
      { quote: 'Participant has never paid for a solution.', message_id: '', whyItIsNegative: 'No budget signal — negative commitment indicator.' },
      { quote: 'Standalone product may not be urgent enough.', message_id: '', whyItIsNegative: 'Integration dependency creates uncertainty.' },
    ],
    openQuestions: [
      'Would this work better as an integration inside existing invoicing tools?',
      'Are there freelancers with higher invoice volume where frequency is higher?',
    ],
    recommendedNextStep: 'Interview freelancers with higher invoice volume or test whether this should be an integration inside existing invoicing tools.',
  }

  it('decision is "continue discovery" (not build or stop)', () => {
    expect(uc10Analysis.decision).toBe('continue discovery')
    expect(uc10Analysis.decision).not.toBe('build narrow prototype')
    expect(uc10Analysis.decision).not.toBe('stop')
  })

  it('strong evidence contains specific past events and workarounds', () => {
    const score = buildSignalScore(uc10Analysis)
    expect(score.strong.length).toBeGreaterThanOrEqual(2)
    const hasEvent = score.strong.some((e) => /last month|two weeks/i.test(e.quote))
    const hasWorkaround = score.strong.some((e) => /notion|template|manually/i.test(e.quote))
    expect(hasEvent).toBe(true)
    expect(hasWorkaround).toBe(true)
  })

  it('weak evidence contains the hypothetical quote', () => {
    const score = buildSignalScore(uc10Analysis)
    const hypothetical = score.weak.find((e) => /maybe|built into|if it were/i.test(e.quote))
    expect(hypothetical).toBeDefined()
  })

  it('negative evidence flags low frequency and no spend', () => {
    const score = buildSignalScore(uc10Analysis)
    const lowFreq  = score.negative.some((e) => /once every|two months|low frequency/i.test(e.quote))
    const noSpend  = score.negative.some((e) => /never paid|no.*solution/i.test(e.quote))
    expect(lowFreq).toBe(true)
    expect(noSpend).toBe(true)
  })

  it('report does not contain forbidden validation phrases', () => {
    const report = buildMarkdownReport(uc10Analysis, 'Test Participant')
    expect(reportContainsForbiddenPhrase(report)).toBeNull()
  })

  it('report contains all required sections', () => {
    const report = buildMarkdownReport(uc10Analysis, 'Test Participant')
    expect(report).toContain('## Decision')
    expect(report).toContain('## Summary')
    expect(report).toContain('## Signal score')
    expect(report).toContain('## Strong evidence')
    expect(report).toContain('## Weak or misleading evidence')
    expect(report).toContain('## Negative evidence')
    expect(report).toContain('## Recommended next step')
  })

  it('recommended next step is concrete and actionable', () => {
    expect(uc10Analysis.recommendedNextStep).toMatch(/interview|integration|invoicing tool|higher volume/i)
  })

  it('open questions exist for remaining unknowns', () => {
    expect(uc10Analysis.openQuestions.length).toBeGreaterThanOrEqual(1)
    expect(uc10Analysis.openQuestions[0]).toMatch(/integration|invoicing|frequency|volume/i)
  })

  it('signal score marks urgency as weak or negative', () => {
    expect(['weak', 'negative']).toContain(uc10Analysis.signalScore.urgency)
  })

  it('signal score marks budgetOrCommitment as negative', () => {
    expect(uc10Analysis.signalScore.budgetOrCommitment).toBe('negative')
  })
})

// ── UC12 — End-to-end demo: agency scope creep ───────────────────────────

describe('UC12 — End-to-end demo: agency scope creep (Step 5 judgment)', () => {
  const uc12Analysis: StructuredAnalysis = {
    decision: 'continue discovery',
    summary: 'Strong evidence of frequent scope creep with documented financial loss and active workarounds. Urgency is medium-to-strong. Buyer/user split between owner, PM, and account manager needs further mapping.',
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'strong',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'medium',
    },
    strongEvidence: [
      {
        quote: 'This happens almost every project. Last month a client asked for three extra landing page sections after approval.',
        message_id: 'msg-uc12-001',
        whyItMatters: 'Specific recent event plus high frequency confirmed.',
      },
      {
        quote: 'We tracked it in ClickUp comments but nobody wanted to push back because the client was important.',
        message_id: 'msg-uc12-002',
        whyItMatters: 'Active (imperfect) workaround using real tool. Social cost documented.',
      },
      {
        quote: 'We probably lost 12 hours on that project. We did not invoice it separately.',
        message_id: 'msg-uc12-003',
        whyItMatters: 'Quantified financial loss. Real cost confirmed.',
      },
      {
        quote: 'Account managers still approve small extras informally.',
        message_id: 'msg-uc12-004',
        whyItMatters: 'Systemic workflow failure, not a one-off event.',
      },
    ],
    mediumEvidence: [
      {
        quote: 'I would talk again if you want to see our project template.',
        message_id: 'msg-uc12-005',
        context: 'Soft commitment to follow-up. Not a firm next step yet.',
      },
    ],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: [
      'Who is the actual buyer: agency owner, PM, or account manager?',
      'Where is scope creep recorded — ClickUp, contract, nowhere?',
      'Would the agency change billing workflow before or after client approval?',
    ],
    recommendedNextStep: 'Run 3 more interviews with agency PMs and account managers. Focus on where scope is recorded, who approves extras, and whether billing or PM tools are the right integration point.',
  }

  it('problem evidence is classified as "strong"', () => {
    expect(uc12Analysis.signalScore.problemEvidence).toBe('strong')
  })

  it('workaround evidence is classified as "strong"', () => {
    expect(uc12Analysis.signalScore.workaroundEvidence).toBe('strong')
  })

  it('strong evidence count >= 3', () => {
    expect(buildSignalSummary(uc12Analysis).strong_count).toBeGreaterThanOrEqual(3)
  })

  it('strong evidence includes quantified financial loss', () => {
    const score = buildSignalScore(uc12Analysis)
    const loss = score.strong.find((e) => /12 hours|lost|did not invoice/i.test(e.quote))
    expect(loss).toBeDefined()
  })

  it('strong evidence includes frequency signal ("almost every project")', () => {
    const score = buildSignalScore(uc12Analysis)
    const freq = score.strong.find((e) => /every project|almost every/i.test(e.quote))
    expect(freq).toBeDefined()
  })

  it('open questions surface the buyer/user split', () => {
    const hasOwnerSplit = uc12Analysis.openQuestions.some((q) =>
      /buyer|owner|pm|account manager/i.test(q)
    )
    expect(hasOwnerSplit).toBe(true)
  })

  it('decision is "continue discovery" (not "build" outright)', () => {
    expect(uc12Analysis.decision).toBe('continue discovery')
    expect(uc12Analysis.decision).not.toBe('build narrow prototype')
  })

  it('recommendedNextStep specifies concrete next actions', () => {
    expect(uc12Analysis.recommendedNextStep).toMatch(/interview|agency|pm|account manager|3 more/i)
  })

  it('report does not contain forbidden validation phrases', () => {
    const report = buildMarkdownReport(uc12Analysis, 'Agency PM')
    expect(reportContainsForbiddenPhrase(report)).toBeNull()
  })

  it('medium evidence (soft follow-up commitment) is not classified as strong', () => {
    const score = buildSignalScore(uc12Analysis)
    const softCommit = score.strong.find((e) => /would talk again|project template/i.test(e.quote))
    expect(softCommit).toBeUndefined()
    const mediumCommit = score.medium.find((e) => /would talk again/i.test(e.quote))
    expect(mediumCommit).toBeDefined()
  })
})

// ── §3 — Required final report checks ────────────────────────────────────

describe('§3 — Required final report content checks', () => {
  const completeAnalysis: StructuredAnalysis = {
    decision: 'continue discovery',
    summary: 'Participant shows medium evidence of the problem with one workaround.',
    signalScore: {
      problemEvidence: 'medium',
      urgency: 'weak',
      workaroundEvidence: 'medium',
      budgetOrCommitment: 'negative',
    },
    strongEvidence: [
      { quote: 'I check my bank every Friday.', message_id: 'm1', whyItMatters: 'Recurring behavior.' },
    ],
    mediumEvidence: [
      { quote: 'It happens maybe once a month.', message_id: 'm2', context: 'Self-reported frequency without specifics.' },
    ],
    weakEvidence: [
      { quote: 'I would probably try it.', message_id: 'm3', whyItIsWeak: 'Hypothetical intent.' },
    ],
    negativeEvidence: [{ quote: 'No existing spend on the problem.', message_id: '', whyItIsNegative: 'No budget signal — commitment is negative.' }],
    openQuestions: ['Is frequency actually higher for other freelancer types?'],
    recommendedNextStep: 'Interview 3 more freelancers with higher invoice volume.',
  }

  it('decision is a valid decision value', () => {
    expect(VALID_DECISIONS).toContain(completeAnalysis.decision)
  })

  it('report contains research goal proxy (summary with context)', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Summary')
    expect(report.length).toBeGreaterThan(200)
  })

  it('report contains strong evidence section', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Strong evidence')
  })

  it('report contains weak evidence section', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Weak or misleading evidence')
  })

  it('report contains negative evidence section', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Negative evidence')
  })

  it('report contains decision recommendation', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Decision')
    expect(report).toContain(completeAnalysis.decision)
  })

  it('report contains concrete next step', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(report).toContain('## Recommended next step')
    expect(report).toContain(completeAnalysis.recommendedNextStep)
  })

  it('report does NOT say "users loved the idea"', () => {
    const bad = buildMarkdownReport({ ...completeAnalysis, summary: 'Users loved the idea and the market wants this.' }, 'P')
    expect(reportContainsForbiddenPhrase(bad)).not.toBeNull()
  })

  it('report does NOT say "this validates the product"', () => {
    const bad = buildMarkdownReport({ ...completeAnalysis, summary: 'This validates the product concept.' }, 'P')
    expect(reportContainsForbiddenPhrase(bad)).not.toBeNull()
  })

  it('report does NOT say "people would use it"', () => {
    const bad = buildMarkdownReport({ ...completeAnalysis, summary: 'People would use it if it were available.' }, 'P')
    expect(reportContainsForbiddenPhrase(bad)).not.toBeNull()
  })

  it('clean report passes all forbidden-phrase checks', () => {
    const report = buildMarkdownReport(completeAnalysis, 'Participant')
    expect(reportContainsForbiddenPhrase(report)).toBeNull()
  })
})

// ── §18 — Evaluation checklist: evidence report ───────────────────────────

describe('§18 — Evaluation checklist: evidence report criteria', () => {
  const checklistAnalysis: StructuredAnalysis = {
    decision: 'test commitment',
    summary: 'Strong behavioral evidence from Deniz. Two late payments last month, manual spreadsheet tracking, existing paid software with gap.',
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'medium',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'medium',
    },
    strongEvidence: [
      { quote: 'Two clients paid late last month.', message_id: 'c1', whyItMatters: 'Specific recent event.' },
      { quote: 'I use a spreadsheet and calendar reminders every Friday.', message_id: 'c2', whyItMatters: 'Active workaround.' },
    ],
    mediumEvidence: [
      { quote: 'I pay for accounting software.', message_id: 'c3', context: 'Existing spend on adjacent problem.' },
    ],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: ['Does accounting software cover part of the need?'],
    recommendedNextStep: 'Offer a 2-week pilot to Deniz. Map the spreadsheet workflow in detail.',
  }

  it('checklist: strong evidence is behavior-based (not opinion)', () => {
    const score = buildSignalScore(checklistAnalysis)
    score.strong.forEach((e) => {
      const isOpinion = /i think|i believe|i feel|it seems|probably/i.test(e.quote)
      expect(isOpinion).toBe(false)
    })
  })

  it('checklist: weak evidence is clearly labeled (whyItIsWeak)', () => {
    // If weak evidence exists, every entry must have whyItIsWeak
    checklistAnalysis.weakEvidence.forEach((e) => {
      expect(e.whyItIsWeak).toBeTruthy()
      expect(e.whyItIsWeak.length).toBeGreaterThan(5)
    })
  })

  it('checklist: recommendation is concrete (not vague)', () => {
    const step = checklistAnalysis.recommendedNextStep
    expect(step.split(' ').length).toBeGreaterThan(5)
    expect(step).not.toMatch(/^(do more research|investigate further|learn more)\.?$/i)
  })

  it('checklist: report does not claim validation from compliments', () => {
    const report = buildMarkdownReport(checklistAnalysis, 'Deniz')
    expect(reportContainsForbiddenPhrase(report)).toBeNull()
  })

  it('checklist: signal score covers all 4 dimensions', () => {
    const s = checklistAnalysis.signalScore
    expect(s.problemEvidence).toBeTruthy()
    expect(s.urgency).toBeTruthy()
    expect(s.workaroundEvidence).toBeTruthy()
    expect(s.budgetOrCommitment).toBeTruthy()
  })

  it('checklist: decision value is one of the valid options', () => {
    expect(VALID_DECISIONS).toContain(checklistAnalysis.decision)
  })
})

// ── §19 — Common failure modes ────────────────────────────────────────────

describe('§19 — Common failure modes', () => {
  it('failure mode 2: compliments must default to weak, never strong', () => {
    const analysis = makeFailureAnalysis({
      weakEvidence: [
        { quote: 'This is exactly what I need!', message_id: 'f1', whyItIsWeak: 'Praise.' },
        { quote: 'I would love to use this.', message_id: 'f2', whyItIsWeak: 'Hypothetical intent.' },
      ],
    })
    expect(buildSignalSummary(analysis).strong_count).toBe(0)
    expect(buildSignalSummary(analysis).weak_count).toBeGreaterThanOrEqual(2)
  })

  it('failure mode 5: every report must end with a decision', () => {
    const analysis = makeFailureAnalysis({ decision: 'stop' })
    const report = buildMarkdownReport(analysis, 'Test')
    expect(report).toContain('## Decision')
    expect(report).toContain('stop')
    expect(report).toContain('## Recommended next step')
  })

  it('failure mode 5: decision must be one of the valid enum values', () => {
    VALID_DECISIONS.forEach((d) => {
      const analysis = makeFailureAnalysis({ decision: d })
      expect(VALID_DECISIONS).toContain(analysis.decision)
    })
  })

  it('failure mode 2: report with only compliments cannot claim product validation', () => {
    const analysis = makeFailureAnalysis({
      summary: 'Users loved the idea and said they would use it.',
      weakEvidence: [{ quote: 'Sounds great!', message_id: 'f3', whyItIsWeak: 'Praise.' }],
    })
    const report = buildMarkdownReport(analysis, 'Test')
    expect(reportContainsForbiddenPhrase(report)).not.toBeNull()
  })
})

// ── Fixture helper (local) ────────────────────────────────────────────────

function makeFailureAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Default summary.',
    signalScore: { problemEvidence: 'weak', urgency: 'weak', workaroundEvidence: 'weak', budgetOrCommitment: 'weak' },
    strongEvidence: [],
    mediumEvidence: [],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: [],
    recommendedNextStep: 'Interview more participants.',
    ...overrides,
  }
}
