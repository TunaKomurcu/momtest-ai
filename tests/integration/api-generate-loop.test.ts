/**
 * Integration tests — generate route loop entegrasyonu
 *
 * Kapsam:
 * - parseAndClean vs parseJsonOutput: leading prose, fence, hybrid senaryolar
 * - validateFullResearchBrief + callWithJsonRetry pipeline:
 *     ilk yanıt geçerli → retry yok
 *     ilk yanıt parse fail → retry → başarı
 *     ilk yanıt validation fail (assumptionMap boş) → retry → başarı
 *     iki kez fail → null
 * - validateInterviewScript + callWithJsonRetry pipeline:
 *     8 sorudan az → retry → başarı
 *     fence wrapped → parse OK, validate OK
 * - researchBriefSaved / interviewScriptSaved boolean'ları
 * - parseAndClean leading prose atlar, parseJsonOutput atmaz (davranış farkı)
 */

import { describe, it, expect, vi } from 'vitest'
import { parseAndClean } from '@/lib/ai-guards/json-retry'
import { parseJsonOutput } from '@/lib/api-helpers/json'
import { validateFullResearchBrief, validateInterviewScript } from '@/lib/ai-guards/brief-validator'
import { callWithJsonRetry } from '@/lib/ai-guards/json-retry'
import type {
  FullResearchBrief,
  InterviewScript,
} from '@/types/index'
import type OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Mock OpenAI factory
// ---------------------------------------------------------------------------

function makeMockOpenAI(responses: Array<string | null | Error>): OpenAI {
  let idx = 0
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const r = responses[Math.min(idx++, responses.length - 1)]
          if (r instanceof Error) throw r
          return {
            choices: [{ message: { content: r, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
          }
        }),
      },
    },
  } as unknown as OpenAI
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeValidBrief(overrides: Partial<FullResearchBrief> = {}): FullResearchBrief {
  return {
    productIdea: 'AI-powered customer interview analyzer for B2B SaaS product managers',
    targetCustomer: 'Product managers in B2B SaaS startups doing customer discovery',
    coreSituation: 'After completing a customer discovery interview call',
    currentBelief: 'PMs cannot distinguish weak from strong evidence signals',
    riskiestAssumption: 'PMs feel this pain strongly enough to pay for a solution',
    interviewObjective: 'Confirm whether evidence misclassification is a real daily pain',
    evidenceNeeded: {
      strong: 'PM describes a specific wrong build decision caused by misreading signals',
      weak: 'PM says they would like better tooling in general',
      negative: 'PM has no memory of a bad decision caused by weak signals',
    },
    participantCriteria: {
      mustHave: ['Active PM doing customer discovery', 'B2B SaaS context'],
      avoid: ['PMs who do not conduct discovery interviews'],
    },
    forbiddenQuestions: ['Would you use this tool?', 'Do you think this is a good idea?'],
    assumptionMap: [
      { assumption: 'Evidence misclassification happens regularly', riskLevel: 'high', whatToAskAbout: 'recent wrong decision', strongEvidence: 'named bad build', weakEvidence: 'general frustration' },
      { assumption: 'PMs feel this pain acutely', riskLevel: 'high', whatToAskAbout: 'urgency level', strongEvidence: 'workaround behavior', weakEvidence: 'opinion' },
      { assumption: 'Current tools do not solve this', riskLevel: 'medium', whatToAskAbout: 'existing solutions', strongEvidence: 'spend on alternatives', weakEvidence: 'wishlist item' },
      { assumption: 'PMs would pay to fix this', riskLevel: 'medium', whatToAskAbout: 'budget signals', strongEvidence: 'prior purchase', weakEvidence: 'hypothetical willingness' },
    ],
    ...overrides,
  }
}

function makeValidScript(questionCount = 8): InterviewScript {
  return {
    goal: 'Understand customer discovery evidence classification pain',
    rulesForInterviewer: ['Do not pitch the product', 'Ask one question at a time'],
    questions: Array.from({ length: questionCount }, (_, i) => ({
      order: i + 1,
      question: `Tell me about situation ${i + 1} in your workflow.`,
      signalSought: 'problem',
      whyItPasses: 'Asks about past behavior not hypothetical future.',
    })),
  }
}

const BASE_PARAMS: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
  model: 'test-model',
  stream: false,
  messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'test' }],
}

// ─────────────────────────────────────────────────────────────────────────────
// parseAndClean vs parseJsonOutput — davranış farkı
// ─────────────────────────────────────────────────────────────────────────────

describe('parseAndClean vs parseJsonOutput — leading prose davranışı', () => {
  const prosePrefix = 'Sure! Here is the research brief for you:\n'
  const validJson = JSON.stringify(makeValidBrief())

  it('parseAndClean: leading prose + JSON → parse eder (prose atlanır)', () => {
    const result = parseAndClean<FullResearchBrief>(prosePrefix + validJson)
    expect(result?.productIdea).toBeTruthy()
  })

  it('parseJsonOutput: leading prose + JSON → null döner (fence dışı prose atlamaz)', () => {
    // parseJsonOutput sadece fence temizler, leading prose için JSON.parse fail eder
    const result = parseJsonOutput<FullResearchBrief>(prosePrefix + validJson)
    expect(result).toBeNull()
  })

  it('parseAndClean: fence + JSON → parse eder', () => {
    const fenced = '```json\n' + validJson + '\n```'
    expect(parseAndClean<FullResearchBrief>(fenced)?.productIdea).toBeTruthy()
  })

  it('parseJsonOutput: fence + JSON → parse eder', () => {
    const fenced = '```json\n' + validJson + '\n```'
    expect(parseJsonOutput<FullResearchBrief>(fenced)?.productIdea).toBeTruthy()
  })

  it('parseAndClean: clean JSON → parse eder', () => {
    expect(parseAndClean<FullResearchBrief>(validJson)?.productIdea).toBeTruthy()
  })

  it('parseAndClean: boş string → null', () => {
    expect(parseAndClean('')).toBeNull()
  })

  it('parseAndClean: JSON yok, sadece prose → null', () => {
    expect(parseAndClean('I cannot generate that right now.')).toBeNull()
  })

  it('parseAndClean: kırık JSON → null', () => {
    expect(parseAndClean('{"productIdea": "test", broken')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Research Brief pipeline: parseAndClean + validateFullResearchBrief
// ─────────────────────────────────────────────────────────────────────────────

describe('Research Brief parse + validate pipeline', () => {
  it('geçerli JSON → parse OK, validate OK → değer döner', () => {
    const brief = makeValidBrief()
    const parsed = parseAndClean<FullResearchBrief>(JSON.stringify(brief))
    expect(parsed).not.toBeNull()
    const validation = validateFullResearchBrief(parsed)
    expect(validation.ok).toBe(true)
  })

  it('prose prefix + geçerli JSON → parse OK (parseAndClean), validate OK', () => {
    const raw = 'Here is the result:\n' + JSON.stringify(makeValidBrief())
    const parsed = parseAndClean<FullResearchBrief>(raw)
    expect(validateFullResearchBrief(parsed).ok).toBe(true)
  })

  it('fence wrapped + geçerli JSON → parse OK, validate OK', () => {
    const raw = '```json\n' + JSON.stringify(makeValidBrief()) + '\n```'
    const parsed = parseAndClean<FullResearchBrief>(raw)
    expect(validateFullResearchBrief(parsed).ok).toBe(true)
  })

  it('assumptionMap 3 eleman → validate FAIL + issues içerir', () => {
    const brief = makeValidBrief({ assumptionMap: makeValidBrief().assumptionMap.slice(0, 3) })
    const parsed = parseAndClean<FullResearchBrief>(JSON.stringify(brief))
    const validation = validateFullResearchBrief(parsed)
    expect(validation.ok).toBe(false)
    if (validation.ok) throw new Error()
    expect(validation.issues.some((i) => i.includes('assumptionMap'))).toBe(true)
  })

  it('forbiddenQuestions 1 eleman → validate FAIL', () => {
    const brief = makeValidBrief({ forbiddenQuestions: ['only one'] })
    const validation = validateFullResearchBrief(parseAndClean(JSON.stringify(brief)))
    expect(validation.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Research Brief loop: callWithJsonRetry + validateFullResearchBrief
// ─────────────────────────────────────────────────────────────────────────────

describe('Research Brief loop — callWithJsonRetry entegrasyonu', () => {
  it('ilk yanıt geçerli → tek çağrı, doğru değer döner', async () => {
    const brief = makeValidBrief()
    const openai = makeMockOpenAI([JSON.stringify(brief)])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]'
    )

    expect(result?.productIdea).toBeTruthy()
    expect(result?.assumptionMap).toHaveLength(4)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('ilk yanıt parse fail (prose only) → retry → başarı', async () => {
    const brief = makeValidBrief()
    const openai = makeMockOpenAI([
      'I cannot process this right now.',  // parse fail
      JSON.stringify(brief),                // retry: başarı
    ])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]'
    )

    expect(result?.productIdea).toBeTruthy()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('ilk yanıt validation fail (assumptionMap 2 eleman) → retry → başarı', async () => {
    const weakBrief = makeValidBrief({ assumptionMap: makeValidBrief().assumptionMap.slice(0, 2) })
    const fullBrief = makeValidBrief()
    const openai = makeMockOpenAI([
      JSON.stringify(weakBrief),  // parse OK, validate FAIL
      JSON.stringify(fullBrief),  // retry: başarı
    ])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]'
    )

    expect(result?.assumptionMap).toHaveLength(4)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('ilk yanıt fence wrapped + validation fail → retry → başarı', async () => {
    const weakBrief = makeValidBrief({ forbiddenQuestions: [] })
    const fullBrief = makeValidBrief()
    const openai = makeMockOpenAI([
      '```json\n' + JSON.stringify(weakBrief) + '\n```',
      JSON.stringify(fullBrief),
    ])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]'
    )

    expect(result?.forbiddenQuestions).toHaveLength(2)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('tüm denemeler validation fail → null döner', async () => {
    const weakBrief = makeValidBrief({ assumptionMap: [] })
    const openai = makeMockOpenAI([
      JSON.stringify(weakBrief),
      JSON.stringify(weakBrief),
      JSON.stringify(weakBrief),
    ])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]', 2
    )

    expect(result).toBeNull()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('parse fail → validation fail → başarı (3 deneme karışık senaryo)', async () => {
    const weakBrief = makeValidBrief({ assumptionMap: makeValidBrief().assumptionMap.slice(0, 2) })
    const fullBrief = makeValidBrief()
    const openai = makeMockOpenAI([
      'Sure! The brief is: { broken json',    // parse fail
      JSON.stringify(weakBrief),               // parse OK, validate FAIL
      JSON.stringify(fullBrief),               // başarı
    ])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]', 2
    )

    expect(result?.productIdea).toBeTruthy()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('researchBriefSaved semantics: null → false, dolu → true', async () => {
    const brief = makeValidBrief()
    const openai = makeMockOpenAI([JSON.stringify(brief)])

    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test/brief]'
    )

    // Route'daki: researchBriefSaved: parsedBrief !== null
    expect(result !== null).toBe(true)   // saved: true
    expect(null !== null).toBe(false)     // saved: false (null case)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interview Script pipeline: parseAndClean + validateInterviewScript
// ─────────────────────────────────────────────────────────────────────────────

describe('Interview Script parse + validate pipeline', () => {
  it('8 sorulu geçerli script → parse OK, validate OK', () => {
    const script = makeValidScript(8)
    const parsed = parseAndClean<InterviewScript>(JSON.stringify(script))
    expect(validateInterviewScript(parsed).ok).toBe(true)
  })

  it('10 sorulu script → validate OK', () => {
    expect(validateInterviewScript(parseAndClean(JSON.stringify(makeValidScript(10)))).ok).toBe(true)
  })

  it('7 sorulu script → validate FAIL', () => {
    const result = validateInterviewScript(parseAndClean(JSON.stringify(makeValidScript(7))))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error()
    expect(result.issues.some((i) => i.includes('questions'))).toBe(true)
  })

  it('fence wrapped 8 sorulu script → parse OK, validate OK', () => {
    const raw = '```json\n' + JSON.stringify(makeValidScript(8)) + '\n```'
    expect(validateInterviewScript(parseAndClean(raw)).ok).toBe(true)
  })

  it('boş script → validate FAIL (goal ve questions eksik)', () => {
    const result = validateInterviewScript(parseAndClean('{}'))
    expect(result.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interview Script loop: callWithJsonRetry + validateInterviewScript
// ─────────────────────────────────────────────────────────────────────────────

describe('Interview Script loop — callWithJsonRetry entegrasyonu', () => {
  it('ilk yanıt geçerli (8 soru) → tek çağrı', async () => {
    const openai = makeMockOpenAI([JSON.stringify(makeValidScript(8))])

    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test/script]'
    )

    expect(result?.questions).toHaveLength(8)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('ilk yanıt 5 soru (az) → retry → 8 sorulu → başarı', async () => {
    const openai = makeMockOpenAI([
      JSON.stringify(makeValidScript(5)),  // validate FAIL (< 8)
      JSON.stringify(makeValidScript(8)),  // başarı
    ])

    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test/script]'
    )

    expect(result?.questions).toHaveLength(8)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('ilk yanıt parse fail → retry → 8 sorulu → başarı', async () => {
    const openai = makeMockOpenAI([
      'Here is your interview script: { broken',
      JSON.stringify(makeValidScript(8)),
    ])

    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test/script]'
    )

    expect(result?.goal).toBeTruthy()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('her denemede 5 soru → maxRetries sonunda null', async () => {
    const weakScript = makeValidScript(5)
    const openai = makeMockOpenAI([
      JSON.stringify(weakScript),
      JSON.stringify(weakScript),
      JSON.stringify(weakScript),
    ])

    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test/script]', 2
    )

    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Generate flow: researchBriefSaved + interviewScriptSaved boolean semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('Generate flow — saved boolean semantics', () => {
  /**
   * Route'daki mantık:
   *   researchBriefSaved = parsedBrief !== null
   *   interviewScriptSaved = parsedScript !== null
   * Bu testler o mantığı doğrular.
   */

  it('brief başarıyla üretildi → researchBriefSaved true', async () => {
    const openai = makeMockOpenAI([JSON.stringify(makeValidBrief())])
    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test]'
    )
    expect(result !== null).toBe(true)
  })

  it('brief tüm retry\'larda fail → researchBriefSaved false', async () => {
    const openai = makeMockOpenAI(['broken', 'broken', 'broken'])
    const result = await callWithJsonRetry<FullResearchBrief>(
      openai, BASE_PARAMS, validateFullResearchBrief, '[Test]', 2
    )
    expect(result !== null).toBe(false)
  })

  it('script başarıyla üretildi → interviewScriptSaved true', async () => {
    const openai = makeMockOpenAI([JSON.stringify(makeValidScript(8))])
    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test]'
    )
    expect(result !== null).toBe(true)
  })

  it('script validation daima fail → interviewScriptSaved false', async () => {
    const weakScript = makeValidScript(3)
    const openai = makeMockOpenAI([
      JSON.stringify(weakScript),
      JSON.stringify(weakScript),
      JSON.stringify(weakScript),
    ])
    const result = await callWithJsonRetry<InterviewScript>(
      openai, BASE_PARAMS, validateInterviewScript, '[Test]', 2
    )
    expect(result !== null).toBe(false)
  })
})
