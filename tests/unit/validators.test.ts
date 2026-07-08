/**
 * Unit tests — lib/ai-guards/brief-validator.ts + analysis-validator.ts
 *
 * Kapsam:
 * - validateFullResearchBrief: tüm zorunlu alanlar, edge case'ler
 * - validateInterviewScript: goal, questions min 8, field kontrolü
 * - validateStructuredAnalysis: decision enum, signalScore, array alanları
 *
 * Pure fonksiyonlar — LLM, DB, Next.js bağımlılığı yoktur.
 */

import { describe, it, expect } from 'vitest'
import { validateFullResearchBrief, validateInterviewScript } from '@/lib/ai-guards/brief-validator'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'

// ---------------------------------------------------------------------------
// Fixtures — geçerli minimal objeler
// ---------------------------------------------------------------------------

const VALID_BRIEF = {
  productIdea: 'AI-powered interview analysis tool for B2B SaaS PMs',
  targetCustomer: 'Product managers in B2B SaaS startups',
  coreSituation: 'After conducting a customer discovery interview',
  currentBelief: 'PMs cannot distinguish weak from strong evidence',
  riskiestAssumption: 'PMs feel the pain of misclassifying evidence strongly enough to pay',
  interviewObjective: 'Confirm whether evidence misclassification is a real daily pain',
  evidenceNeeded: {
    strong: 'PM describes a specific wrong decision caused by bad signal reading',
    weak: 'PM says they would like better analysis tools',
    negative: 'PM has no memory of a bad decision due to weak signals',
  },
  participantCriteria: {
    mustHave: ['Active PM doing customer discovery', 'B2B SaaS context'],
    avoid: ['PMs who do not conduct discovery interviews'],
  },
  forbiddenQuestions: ['Would you use this tool?', 'Do you think this is a good idea?'],
  assumptionMap: [
    { assumption: 'Evidence misclassification happens regularly', riskLevel: 'high', whatToAskAbout: 'recent wrong decision', strongEvidence: 'named bad build', weakEvidence: 'general frustration' },
    { assumption: 'PMs feel this pain acutely', riskLevel: 'high', whatToAskAbout: 'urgency', strongEvidence: 'workaround behavior', weakEvidence: 'opinion' },
    { assumption: 'Current tools do not solve this', riskLevel: 'medium', whatToAskAbout: 'existing solutions', strongEvidence: 'spend on alternatives', weakEvidence: 'wishlist' },
    { assumption: 'PMs would pay to fix this', riskLevel: 'medium', whatToAskAbout: 'budget signals', strongEvidence: 'prior purchase', weakEvidence: 'hypothetical willingness' },
  ],
}

function makeScript(questionCount: number) {
  return {
    goal: 'Understand discovery workflow pain',
    rulesForInterviewer: ['Do not pitch the product'],
    questions: Array.from({ length: questionCount }, (_, i) => ({
      order: i + 1,
      question: `Question ${i + 1} text here`,
      signalSought: 'problem',
      whyItPasses: 'Asks about past behavior',
    })),
  }
}

const VALID_ANALYSIS = {
  decision: 'continue discovery',
  summary: 'Participant showed clear evidence of problem but no budget signal yet.',
  signalScore: {
    problemEvidence: 'strong',
    urgency: 'medium',
    workaroundEvidence: 'strong',
    budgetOrCommitment: 'weak',
  },
  strongEvidence: [{ quote: 'We built the wrong thing', message_id: 'msg-001', whyItMatters: 'Concrete past mistake' }],
  mediumEvidence: [{ quote: 'It is annoying', message_id: 'msg-002', context: 'No urgency proof' }],
  weakEvidence: [{ quote: 'I would love a tool like that', message_id: 'msg-003', whyItIsWeak: 'Hypothetical' }],
  negativeEvidence: [],
  openQuestions: ['Does this happen often enough to justify spend?'],
  recommendedNextStep: 'Run 3 more interviews targeting senior PMs with budget authority',
}

// ---------------------------------------------------------------------------
// validateFullResearchBrief — geçerli input
// ---------------------------------------------------------------------------

describe('validateFullResearchBrief — geçerli input', () => {
  it('tam dolu geçerli brief → ok: true döner', () => {
    const result = validateFullResearchBrief(VALID_BRIEF)
    expect(result.ok).toBe(true)
  })

  it('ok: true ise value tam objeyi içerir', () => {
    const result = validateFullResearchBrief(VALID_BRIEF)
    if (!result.ok) throw new Error('Expected ok')
    expect(result.value.productIdea).toBe(VALID_BRIEF.productIdea)
    expect(result.value.assumptionMap).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// validateFullResearchBrief — geçersiz input
// ---------------------------------------------------------------------------

describe('validateFullResearchBrief — null / primitive input', () => {
  it('null → ok: false', () => {
    expect(validateFullResearchBrief(null).ok).toBe(false)
  })

  it('string → ok: false', () => {
    expect(validateFullResearchBrief('plain string').ok).toBe(false)
  })

  it('number → ok: false', () => {
    expect(validateFullResearchBrief(42).ok).toBe(false)
  })

  it('boş obje → birden fazla issue döner', () => {
    const result = validateFullResearchBrief({})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.length).toBeGreaterThan(3)
  })
})

describe('validateFullResearchBrief — alan uzunluk kontrolleri', () => {
  it('productIdea 10 karakter → fail', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, productIdea: 'Short txt.' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('productIdea'))).toBe(true)
  })

  it('productIdea 11 karakter → pass', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, productIdea: 'Exactly 11c' })
    expect(result.ok).toBe(true)
  })

  it('riskiestAssumption boş string → fail', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, riskiestAssumption: '' })
    expect(result.ok).toBe(false)
  })

  it('interviewObjective 5 karakter → fail', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, interviewObjective: 'Short' })
    expect(result.ok).toBe(false)
  })
})

describe('validateFullResearchBrief — evidenceNeeded kontrolleri', () => {
  it('evidenceNeeded eksik → fail + issue içerir', () => {
    const { evidenceNeeded: _ev, ...rest } = VALID_BRIEF
    const result = validateFullResearchBrief(rest)
    expect(result.ok).toBe(false)
  })

  it('evidenceNeeded.strong boş string → fail', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      evidenceNeeded: { ...VALID_BRIEF.evidenceNeeded, strong: '' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('evidenceNeeded.strong'))).toBe(true)
  })

  it('evidenceNeeded.negative eksik → fail', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      evidenceNeeded: { strong: 'ok', weak: 'ok' },
    })
    expect(result.ok).toBe(false)
  })
})

describe('validateFullResearchBrief — participantCriteria kontrolleri', () => {
  it('mustHave boş array → fail', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      participantCriteria: { mustHave: [], avoid: [] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('mustHave'))).toBe(true)
  })

  it('mustHave 1 eleman → pass', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      participantCriteria: { mustHave: ['Active PM'], avoid: [] },
    })
    expect(result.ok).toBe(true)
  })
})

describe('validateFullResearchBrief — forbiddenQuestions kontrolleri', () => {
  it('0 eleman → fail', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, forbiddenQuestions: [] })
    expect(result.ok).toBe(false)
  })

  it('1 eleman → fail', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, forbiddenQuestions: ['one'] })
    expect(result.ok).toBe(false)
  })

  it('2 eleman → pass', () => {
    const result = validateFullResearchBrief({ ...VALID_BRIEF, forbiddenQuestions: ['q1', 'q2'] })
    expect(result.ok).toBe(true)
  })
})

describe('validateFullResearchBrief — assumptionMap kontrolleri', () => {
  it('3 eleman → fail (min 4)', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      assumptionMap: VALID_BRIEF.assumptionMap.slice(0, 3),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('assumptionMap'))).toBe(true)
  })

  it('4 eleman → pass', () => {
    expect(validateFullResearchBrief(VALID_BRIEF).ok).toBe(true)
  })

  it('geçersiz riskLevel olan eleman → fail', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      assumptionMap: [
        ...VALID_BRIEF.assumptionMap.slice(0, 3),
        { assumption: 'test', riskLevel: 'critical', whatToAskAbout: 'topic', strongEvidence: 'x', weakEvidence: 'y' },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('assumptionMap[3]'))).toBe(true)
  })

  it('assumption alanı boş olan eleman → fail', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      assumptionMap: [
        ...VALID_BRIEF.assumptionMap.slice(0, 3),
        { assumption: '', riskLevel: 'high', whatToAskAbout: 'topic', strongEvidence: 'x', weakEvidence: 'y' },
      ],
    })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateInterviewScript
// ---------------------------------------------------------------------------

describe('validateInterviewScript — geçerli input', () => {
  it('8 sorulu script → ok: true', () => {
    expect(validateInterviewScript(makeScript(8)).ok).toBe(true)
  })

  it('10 sorulu script → ok: true', () => {
    expect(validateInterviewScript(makeScript(10)).ok).toBe(true)
  })
})

describe('validateInterviewScript — yetersiz soru sayısı', () => {
  it('7 soru → fail', () => {
    const result = validateInterviewScript(makeScript(7))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('questions'))).toBe(true)
  })

  it('0 soru → fail', () => {
    expect(validateInterviewScript(makeScript(0)).ok).toBe(false)
  })
})

describe('validateInterviewScript — alan kontrolleri', () => {
  it('goal boş → fail', () => {
    const result = validateInterviewScript({ ...makeScript(8), goal: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('goal'))).toBe(true)
  })

  it('rulesForInterviewer eksik (string) → fail', () => {
    const script = { ...makeScript(8), rulesForInterviewer: 'not-an-array' }
    expect(validateInterviewScript(script).ok).toBe(false)
  })

  it('soru objesinde signalSought eksik → fail', () => {
    const script = makeScript(8)
    script.questions[0] = { order: 1, question: 'Test?', signalSought: '', whyItPasses: 'ok' }
    const result = validateInterviewScript(script)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('questions[0]'))).toBe(true)
  })

  it('soru objesinde order sayı değil → fail', () => {
    const script = makeScript(8)
    // @ts-expect-error — kasıtlı yanlış tip
    script.questions[2] = { order: 'three', question: 'Test?', signalSought: 'problem' }
    expect(validateInterviewScript(script).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateStructuredAnalysis — geçerli input
// ---------------------------------------------------------------------------

describe('validateStructuredAnalysis — geçerli input', () => {
  it('tam dolu geçerli analiz → ok: true', () => {
    expect(validateStructuredAnalysis(VALID_ANALYSIS).ok).toBe(true)
  })

  it('ok: true ise value decision alanını içerir', () => {
    const result = validateStructuredAnalysis(VALID_ANALYSIS)
    if (!result.ok) throw new Error('Expected ok')
    expect(result.value.decision).toBe('continue discovery')
  })
})

// ---------------------------------------------------------------------------
// validateStructuredAnalysis — decision enum
// ---------------------------------------------------------------------------

describe('validateStructuredAnalysis — decision enum (5 geçerli değer)', () => {
  const VALID_DECISIONS = [
    'continue discovery',
    'test commitment',
    'change segment',
    'stop',
    'build narrow prototype',
  ] as const

  VALID_DECISIONS.forEach((decision) => {
    it(`"${decision}" → ok: true`, () => {
      expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, decision }).ok).toBe(true)
    })
  })

  it('"continue Discovery" (büyük harf) → fail (case-sensitive)', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, decision: 'continue Discovery' }).ok).toBe(false)
  })

  it('"I recommend continuing discovery" → fail', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, decision: 'I recommend continuing discovery' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('decision'))).toBe(true)
  })

  it('decision eksik → fail', () => {
    const { decision: _d, ...rest } = VALID_ANALYSIS
    expect(validateStructuredAnalysis(rest).ok).toBe(false)
  })

  it('decision boş string → fail', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, decision: '' }).ok).toBe(false)
  })

  it('decision sayı → fail', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, decision: 1 }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateStructuredAnalysis — signalScore
// ---------------------------------------------------------------------------

describe('validateStructuredAnalysis — signalScore kontrolleri', () => {
  const VALID_LEVELS = ['strong', 'medium', 'weak', 'negative'] as const

  VALID_LEVELS.forEach((level) => {
    it(`problemEvidence: "${level}" → pass`, () => {
      const result = validateStructuredAnalysis({
        ...VALID_ANALYSIS,
        signalScore: { ...VALID_ANALYSIS.signalScore, problemEvidence: level },
      })
      expect(result.ok).toBe(true)
    })
  })

  it('geçersiz signalScore seviyesi "moderate" → fail', () => {
    const result = validateStructuredAnalysis({
      ...VALID_ANALYSIS,
      signalScore: { ...VALID_ANALYSIS.signalScore, urgency: 'moderate' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('urgency'))).toBe(true)
  })

  it('signalScore eksik → fail', () => {
    const { signalScore: _ss, ...rest } = VALID_ANALYSIS
    expect(validateStructuredAnalysis(rest).ok).toBe(false)
  })

  it('signalScore.budgetOrCommitment eksik → fail', () => {
    const result = validateStructuredAnalysis({
      ...VALID_ANALYSIS,
      signalScore: { problemEvidence: 'strong', urgency: 'medium', workaroundEvidence: 'strong' },
    })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateStructuredAnalysis — array alanları
// ---------------------------------------------------------------------------

describe('validateStructuredAnalysis — array alan kontrolleri', () => {
  it('strongEvidence boş array → pass (array olması yeterli)', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, strongEvidence: [] }).ok).toBe(true)
  })

  it('strongEvidence string (array değil) → fail', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, strongEvidence: 'text' }).ok).toBe(false)
  })

  it('openQuestions boş array → fail (min 1)', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, openQuestions: [] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('openQuestions'))).toBe(true)
  })

  it('openQuestions 1 eleman → pass', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, openQuestions: ['What next?'] }).ok).toBe(true)
  })

  it('negativeEvidence boş array → pass', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, negativeEvidence: [] }).ok).toBe(true)
  })
})

describe('validateStructuredAnalysis — diğer zorunlu alanlar', () => {
  it('summary boş string → fail', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, summary: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('summary'))).toBe(true)
  })

  it('recommendedNextStep boş string → fail', () => {
    expect(validateStructuredAnalysis({ ...VALID_ANALYSIS, recommendedNextStep: '' }).ok).toBe(false)
  })

  it('null input → fail', () => {
    expect(validateStructuredAnalysis(null).ok).toBe(false)
  })

  it('boş obje → birden fazla issue', () => {
    const result = validateStructuredAnalysis({})
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.length).toBeGreaterThan(3)
  })
})

// ---------------------------------------------------------------------------
// Coverage gap kapatma — brief-validator.ts satır 69-70
// evidenceNeeded.weak ve evidenceNeeded.negative ayrı ayrı test
// ---------------------------------------------------------------------------

describe('validateFullResearchBrief — evidenceNeeded tek alan hataları (coverage)', () => {
  it('evidenceNeeded.weak boş string → fail, issue evidenceNeeded.weak içerir', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      evidenceNeeded: { ...VALID_BRIEF.evidenceNeeded, weak: '' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('evidenceNeeded.weak'))).toBe(true)
  })

  it('evidenceNeeded.negative boş string → fail, issue evidenceNeeded.negative içerir', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      evidenceNeeded: { ...VALID_BRIEF.evidenceNeeded, negative: '' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('evidenceNeeded.negative'))).toBe(true)
  })

  it('evidenceNeeded: strong OK, weak OK, negative boş → sadece negative issue', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      evidenceNeeded: { strong: 'ok', weak: 'ok', negative: '' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('evidenceNeeded.negative'))).toBe(true)
    expect(result.issues.some((i) => i.includes('evidenceNeeded.strong'))).toBe(false)
    expect(result.issues.some((i) => i.includes('evidenceNeeded.weak'))).toBe(false)
  })

  it('participantCriteria.avoid array değil → fail, issue avoid içerir', () => {
    const result = validateFullResearchBrief({
      ...VALID_BRIEF,
      participantCriteria: { mustHave: ['Active PM'], avoid: 'not-an-array' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('avoid'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Coverage gap kapatma — analysis-validator.ts satır 92-93, 145-146
// workaroundEvidence, budgetOrCommitment invalid + mediumEvidence, weakEvidence array olmayan
// ---------------------------------------------------------------------------

describe('validateStructuredAnalysis — coverage gap: signalScore workaround/budget', () => {
  it('signalScore.workaroundEvidence geçersiz → fail, issue workaroundEvidence içerir', () => {
    const result = validateStructuredAnalysis({
      ...VALID_ANALYSIS,
      signalScore: { ...VALID_ANALYSIS.signalScore, workaroundEvidence: 'high' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('workaroundEvidence'))).toBe(true)
  })

  it('signalScore.budgetOrCommitment geçersiz → fail, issue budgetOrCommitment içerir', () => {
    const result = validateStructuredAnalysis({
      ...VALID_ANALYSIS,
      signalScore: { ...VALID_ANALYSIS.signalScore, budgetOrCommitment: 'low' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('budgetOrCommitment'))).toBe(true)
  })
})

describe('validateStructuredAnalysis — coverage gap: mediumEvidence ve weakEvidence array kontrolleri', () => {
  it('mediumEvidence string (array değil) → fail, issue mediumEvidence içerir', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, mediumEvidence: 'not-array' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('mediumEvidence'))).toBe(true)
  })

  it('weakEvidence number (array değil) → fail, issue weakEvidence içerir', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, weakEvidence: 42 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('weakEvidence'))).toBe(true)
  })

  it('negativeEvidence object (array değil) → fail', () => {
    const result = validateStructuredAnalysis({ ...VALID_ANALYSIS, negativeEvidence: {} })
    expect(result.ok).toBe(false)
  })

  it('tüm evidence array\'leri boş olabilir (boş array geçer)', () => {
    const result = validateStructuredAnalysis({
      ...VALID_ANALYSIS,
      strongEvidence: [],
      mediumEvidence: [],
      weakEvidence: [],
      negativeEvidence: [],
    })
    expect(result.ok).toBe(true)
  })
})
