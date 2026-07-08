/**
 * Integration tests — analyze route loop entegrasyonu
 *
 * Kapsam:
 * - parseAndClean + validateStructuredAnalysis pipeline:
 *     geçerli JSON → pass
 *     leading prose + JSON → pass (parseAndClean atlar)
 *     geçersiz decision → validate fail
 *     signalScore eksik alan → validate fail
 * - callWithJsonRetry + validateStructuredAnalysis loop:
 *     ilk yanıt geçerli → tek çağrı
 *     decision geçersiz enum → retry → geçerli → başarı
 *     parse fail → retry → başarı
 *     tüm denemeler geçersiz decision → null
 * - Transcript formatı: [message_id] Role: content satırları
 * - Analyze flow'undaki tüm 5 geçerli decision değerleri
 */

import { describe, it, expect, vi } from 'vitest'
import { parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'
import { callWithJsonRetry } from '@/lib/ai-guards/json-retry'
import type { StructuredAnalysis } from '@/types/index'
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

function makeValidAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Participant showed clear evidence of problem but no budget signal yet identified.',
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'medium',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'weak',
    },
    strongEvidence: [
      { quote: 'We built the wrong feature because I misread the signals last quarter.', message_id: 'msg-010', whyItMatters: 'Concrete past wrong decision caused by misclassification.' },
    ],
    mediumEvidence: [
      { quote: 'It is annoying to write up notes after every call manually.', message_id: 'msg-006', context: 'Plausible pain but no urgency proof.' },
    ],
    weakEvidence: [
      { quote: 'I would love a tool that does this automatically for me.', message_id: 'msg-008', whyItIsWeak: 'Future hypothetical, not current behavior.' },
    ],
    negativeEvidence: [],
    openQuestions: [
      'Does this happen often enough to justify regular spend?',
      'Is the PM the actual buyer or does a team lead approve tools?',
    ],
    recommendedNextStep: 'Run 3 more interviews targeting senior PMs with budget authority at Series A+ startups.',
    ...overrides,
  }
}

const BASE_PARAMS: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
  model: 'test-model',
  stream: false,
  messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'test' }],
}

// ─────────────────────────────────────────────────────────────────────────────
// parseAndClean + validateStructuredAnalysis pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('Analysis parse + validate pipeline', () => {
  it('geçerli JSON → parse OK, validate OK', () => {
    const parsed = parseAndClean<StructuredAnalysis>(JSON.stringify(makeValidAnalysis()))
    expect(validateStructuredAnalysis(parsed).ok).toBe(true)
  })

  it('leading prose + JSON → parseAndClean atlar, validate OK', () => {
    const raw = 'Based on my analysis of the transcript:\n' + JSON.stringify(makeValidAnalysis())
    const parsed = parseAndClean<StructuredAnalysis>(raw)
    expect(validateStructuredAnalysis(parsed).ok).toBe(true)
  })

  it('fence wrapped → parse OK, validate OK', () => {
    const raw = '```json\n' + JSON.stringify(makeValidAnalysis()) + '\n```'
    const parsed = parseAndClean<StructuredAnalysis>(raw)
    expect(validateStructuredAnalysis(parsed).ok).toBe(true)
  })

  it('geçersiz decision → validate FAIL, issue decision\'ı içerir', () => {
    const analysis = makeValidAnalysis({ decision: 'I recommend continuing the discovery process' })
    const validation = validateStructuredAnalysis(parseAndClean(JSON.stringify(analysis)))
    expect(validation.ok).toBe(false)
    if (validation.ok) throw new Error()
    expect(validation.issues.some((i) => i.includes('decision'))).toBe(true)
  })

  it('signalScore.urgency geçersiz → validate FAIL', () => {
    const analysis = makeValidAnalysis({
      signalScore: { ...makeValidAnalysis().signalScore, urgency: 'moderate' as 'medium' },
    })
    const validation = validateStructuredAnalysis(parseAndClean(JSON.stringify(analysis)))
    expect(validation.ok).toBe(false)
    if (validation.ok) throw new Error()
    expect(validation.issues.some((i) => i.includes('urgency'))).toBe(true)
  })

  it('openQuestions boş array → validate FAIL (min 1)', () => {
    const analysis = makeValidAnalysis({ openQuestions: [] })
    expect(validateStructuredAnalysis(parseAndClean(JSON.stringify(analysis))).ok).toBe(false)
  })

  it('summary boş string → validate FAIL', () => {
    expect(validateStructuredAnalysis(parseAndClean(JSON.stringify(makeValidAnalysis({ summary: '' })))).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tüm geçerli decision değerleri
// ─────────────────────────────────────────────────────────────────────────────

describe('Analysis — tüm 5 geçerli decision değeri', () => {
  const VALID_DECISIONS = [
    'continue discovery',
    'test commitment',
    'change segment',
    'stop',
    'build narrow prototype',
  ] as const

  VALID_DECISIONS.forEach((decision) => {
    it(`"${decision}" → parse + validate OK`, () => {
      const analysis = makeValidAnalysis({ decision })
      const parsed = parseAndClean<StructuredAnalysis>(JSON.stringify(analysis))
      const result = validateStructuredAnalysis(parsed)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error()
      expect(result.value.decision).toBe(decision)
    })
  })

  it('geçersiz değer "pivot" → validate FAIL', () => {
    expect(validateStructuredAnalysis(parseAndClean(JSON.stringify(makeValidAnalysis({ decision: 'pivot' })))).ok).toBe(false)
  })

  it('boş string decision → validate FAIL', () => {
    expect(validateStructuredAnalysis(parseAndClean(JSON.stringify(makeValidAnalysis({ decision: '' })))).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Analysis loop: callWithJsonRetry + validateStructuredAnalysis
// ─────────────────────────────────────────────────────────────────────────────

describe('Analysis loop — callWithJsonRetry entegrasyonu', () => {
  it('ilk yanıt geçerli → tek LLM çağrısı, doğru decision döner', async () => {
    const analysis = makeValidAnalysis({ decision: 'test commitment' })
    const openai = makeMockOpenAI([JSON.stringify(analysis)])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.decision).toBe('test commitment')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('ilk yanıt geçersiz decision → retry → geçerli decision → başarı', async () => {
    const badAnalysis = makeValidAnalysis({ decision: 'I recommend continuing discovery further' })
    const goodAnalysis = makeValidAnalysis({ decision: 'continue discovery' })

    const openai = makeMockOpenAI([
      JSON.stringify(badAnalysis),  // validate FAIL (geçersiz decision)
      JSON.stringify(goodAnalysis), // başarı
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.decision).toBe('continue discovery')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('ilk yanıt parse fail (boş yanıt benzeri prose) → retry → başarı', async () => {
    const analysis = makeValidAnalysis()
    const openai = makeMockOpenAI([
      'I have analyzed the transcript. The participant shows strong signals.',  // parse fail (JSON yok)
      JSON.stringify(analysis),
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.decision).toBeTruthy()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('fence wrapped geçersiz decision → retry → geçerli → başarı', async () => {
    const badAnalysis = makeValidAnalysis({ decision: 'continue with pivot' })
    const goodAnalysis = makeValidAnalysis({ decision: 'change segment' })

    const openai = makeMockOpenAI([
      '```json\n' + JSON.stringify(badAnalysis) + '\n```',
      JSON.stringify(goodAnalysis),
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.decision).toBe('change segment')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('tüm denemeler geçersiz decision → maxRetries → null', async () => {
    const badAnalysis = makeValidAnalysis({ decision: 'I recommend pivoting the product direction' })

    const openai = makeMockOpenAI([
      JSON.stringify(badAnalysis),
      JSON.stringify(badAnalysis),
      JSON.stringify(badAnalysis),
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]', 2
    )

    expect(result).toBeNull()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('API hatası → retry → başarı', async () => {
    const analysis = makeValidAnalysis()
    const openai = makeMockOpenAI([
      new Error('503 Service Unavailable'),
      JSON.stringify(analysis),
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.decision).toBeTruthy()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('openQuestions boş array → validate FAIL → retry → başarı', async () => {
    const noQuestions = makeValidAnalysis({ openQuestions: [] })
    const withQuestions = makeValidAnalysis()

    const openai = makeMockOpenAI([
      JSON.stringify(noQuestions),
      JSON.stringify(withQuestions),
    ])

    const result = await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    expect(result?.openQuestions.length).toBeGreaterThan(0)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Transcript format: [message_id] Role: content
// ─────────────────────────────────────────────────────────────────────────────

describe('Transcript format — message_id referans bütünlüğü', () => {
  interface TranscriptRow {
    id: string
    sender: string
    content: string
  }

  function buildTranscript(rows: TranscriptRow[]): string {
    return rows.map((m) => {
      const role = m.sender === 'agent' ? 'Interviewer' : 'Participant'
      return `[${m.id}] ${role}: ${m.content}`
    }).join('\n')
  }

  it('transcript her satıra message_id ekler', () => {
    const rows: TranscriptRow[] = [
      { id: 'msg-001', sender: 'agent', content: 'Tell me about the last time.' },
      { id: 'msg-002', sender: 'participant', content: 'Last month we had an issue.' },
    ]
    const transcript = buildTranscript(rows)
    expect(transcript).toContain('[msg-001] Interviewer:')
    expect(transcript).toContain('[msg-002] Participant:')
  })

  it('analysis strong evidence message_id transcript\'teki ID ile eşleşmeli', () => {
    const analysis = makeValidAnalysis({
      strongEvidence: [{ quote: 'We built the wrong feature.', message_id: 'msg-010', whyItMatters: 'Past mistake.' }],
    })
    const rows: TranscriptRow[] = [
      { id: 'msg-010', sender: 'participant', content: 'We built the wrong feature.' },
    ]
    const transcript = buildTranscript(rows)
    // Transcript'teki ID, analysis'teki ID ile eşleşiyor
    expect(transcript).toContain(`[${analysis.strongEvidence[0].message_id}]`)
  })

  it('message_id uuid formatında olabilir', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const row: TranscriptRow = { id: uuid, sender: 'participant', content: 'Test content here.' }
    const transcript = buildTranscript([row])
    expect(transcript).toContain(`[${uuid}]`)
  })

  it('agent mesajları Interviewer olarak işaretlenir', () => {
    const rows: TranscriptRow[] = [{ id: 'msg-001', sender: 'agent', content: 'Question?' }]
    expect(buildTranscript(rows)).toContain('Interviewer:')
  })

  it('participant mesajları Participant olarak işaretlenir', () => {
    const rows: TranscriptRow[] = [{ id: 'msg-002', sender: 'participant', content: 'Answer.' }]
    expect(buildTranscript(rows)).toContain('Participant:')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Analysis validation issues retry prompt'a dahil edilir
// ─────────────────────────────────────────────────────────────────────────────

describe('Validation issues retry prompt entegrasyonu', () => {
  it('retry çağrısında messages array daha uzun (issue\'lar eklendi)', async () => {
    const badAnalysis = makeValidAnalysis({ decision: 'bad value here for testing' })
    const goodAnalysis = makeValidAnalysis()

    // İlk çağrıdaki mesaj sayısını capture etmek için spy kullanıyoruz
    const callLengths: number[] = []
    const openai = {
      chat: {
        completions: {
          create: vi.fn(async (params: { messages: unknown[] }) => {
            callLengths.push(params.messages.length)
            const responses = [JSON.stringify(badAnalysis), JSON.stringify(goodAnalysis)]
            const r = responses[Math.min(callLengths.length - 1, responses.length - 1)]
            return {
              choices: [{ message: { content: r, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
            }
          }),
        },
      },
    } as unknown as OpenAI

    await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    // İlk çağrı: BASE_PARAMS mesajları (2)
    // İkinci çağrı: BASE_PARAMS + assistant + user retry prompt (4)
    expect(callLengths).toHaveLength(2)
    expect(callLengths[0]).toBe(BASE_PARAMS.messages.length)           // 2
    expect(callLengths[1]).toBe(BASE_PARAMS.messages.length + 2)       // 4
    expect(callLengths[1]).toBeGreaterThan(callLengths[0])
  })

  it('retry prompt issue metnini içerir', async () => {
    const badAnalysis = makeValidAnalysis({ decision: 'bad value here' })
    const goodAnalysis = makeValidAnalysis()

    const openai = makeMockOpenAI([
      JSON.stringify(badAnalysis),
      JSON.stringify(goodAnalysis),
    ])

    await callWithJsonRetry<StructuredAnalysis>(
      openai, BASE_PARAMS, validateStructuredAnalysis, '[Test/analyze]'
    )

    const secondCallMessages = (openai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[1][0].messages as Array<{ role: string; content: string }>
    const retryUserMessage = secondCallMessages[secondCallMessages.length - 1]

    expect(retryUserMessage.role).toBe('user')
    expect(retryUserMessage.content).toContain('missing required fields')
  })
})
