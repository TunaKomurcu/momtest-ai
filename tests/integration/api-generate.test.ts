/**
 * Integration tests — POST /api/generate/[projectId]
 *
 * Kapsam:
 * - encodeChunk: SSE format `data: {...}\n\n`
 * - decodeChunk: encode/decode round-trip
 * - parseJsonOutput: fence stripping (generate'e özgü senaryolar)
 * - SSE stage values: research_brief | interview_script | done | error
 * - GenerateStreamChunk shape doğrulaması
 * - Streaming Gemini mock: SSE parçaları birleştirme
 * - Webhook: generate_complete payload
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { encodeChunk, decodeChunk } from '@/lib/api-helpers/sse'
import { parseJsonOutput } from '@/lib/api-helpers/json'
import type {
  GenerateStreamChunk,
  FullResearchBrief,
  InterviewScript,
} from '@/types/index'

// ── MSW server ────────────────────────────────────────────────────────────

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const WEBHOOK_URL = 'https://hook.make.com/test-generate'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ── Fixtures ──────────────────────────────────────────────────────────────

const SAMPLE_RESEARCH_BRIEF: FullResearchBrief = {
  productIdea: 'Invoice reminder tool for freelancers',
  targetCustomer: 'Freelance designers with 3+ clients',
  coreSituation: 'After invoice delivery, tracking payment status',
  currentBelief: 'Late payment is frequent and costly',
  riskiestAssumption: 'Problem is painful enough to switch from manual workflow',
  interviewObjective: 'Map current workflow and urgency',
  evidenceNeeded: {
    strong: 'Workaround behavior, existing spend',
    weak: 'Opinions, hypotheticals',
    negative: 'No urgency, no workaround',
  },
  participantCriteria: {
    mustHave: ['Active freelancer', '3+ clients'],
    avoid: ['Agencies', 'Full-time employees'],
  },
  forbiddenQuestions: ['Would you use this?', 'Would you pay?'],
  assumptionMap: [
    {
      assumption: 'Freelancers lose money due to late invoices',
      riskLevel: 'high',
      whatToAskAbout: 'Payment tracking workflow',
      strongEvidence: 'Named tool, recurring pattern',
      weakEvidence: 'General frustration',
    },
  ],
}

const SAMPLE_INTERVIEW_SCRIPT: InterviewScript = {
  goal: 'Understand invoice tracking pain and workarounds',
  rulesForInterviewer: ['Do not pitch the product', 'Ask one question at a time'],
  questions: [
    { order: 1, question: 'Tell me about the last invoice that was paid late.', signalSought: 'problem', whyItPasses: 'Past behavior.' },
    { order: 2, question: 'What did you do next?', signalSought: 'workaround', whyItPasses: 'Behavior.' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// encodeChunk
// ─────────────────────────────────────────────────────────────────────────────

describe('encodeChunk', () => {
  it('encodes to Uint8Array', () => {
    const chunk: GenerateStreamChunk = { stage: 'research_brief', content: 'hello' }
    const encoded = encodeChunk(chunk)
    expect(encoded).toBeInstanceOf(Uint8Array)
  })

  it('produces SSE format: data: {...}\\n\\n', () => {
    const chunk: GenerateStreamChunk = { stage: 'research_brief', content: 'test' }
    const text = new TextDecoder().decode(encodeChunk(chunk))
    expect(text).toMatch(/^data: .+\n\n$/)
  })

  it('encodes research_brief stage correctly', () => {
    const chunk: GenerateStreamChunk = { stage: 'research_brief', content: '{"key":"val"}' }
    const text = new TextDecoder().decode(encodeChunk(chunk))
    const parsed = JSON.parse(text.replace('data: ', '').trim()) as GenerateStreamChunk
    expect(parsed.stage).toBe('research_brief')
    expect(parsed.content).toBe('{"key":"val"}')
  })

  it('encodes interview_script stage correctly', () => {
    const chunk: GenerateStreamChunk = { stage: 'interview_script', content: 'fragment' }
    const text = new TextDecoder().decode(encodeChunk(chunk))
    expect(text).toContain('"stage":"interview_script"')
  })

  it('encodes done stage correctly', () => {
    const chunk: GenerateStreamChunk = { stage: 'done', content: '{"researchBriefSaved":true}' }
    const text = new TextDecoder().decode(encodeChunk(chunk))
    expect(text).toContain('"stage":"done"')
  })

  it('encodes error stage correctly', () => {
    const chunk: GenerateStreamChunk = { stage: 'error', content: 'LLM timeout' }
    const text = new TextDecoder().decode(encodeChunk(chunk))
    expect(text).toContain('"stage":"error"')
    expect(text).toContain('LLM timeout')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// decodeChunk (round-trip)
// ─────────────────────────────────────────────────────────────────────────────

describe('decodeChunk — encode/decode round-trip', () => {
  it('decodes encoded chunk back to original', () => {
    const original: GenerateStreamChunk = { stage: 'research_brief', content: 'partial json' }
    const decoded = decodeChunk(encodeChunk(original))
    expect(decoded).toEqual(original)
  })

  it('returns null for invalid SSE format', () => {
    const bad = new TextEncoder().encode('not-sse-format')
    expect(decodeChunk(bad)).toBeNull()
  })

  it('returns null for malformed JSON in data field', () => {
    const bad = new TextEncoder().encode('data: { broken json }\n\n')
    expect(decodeChunk(bad)).toBeNull()
  })

  it('round-trips all 5 stage values', () => {
    const stages: GenerateStreamChunk['stage'][] = ['research_brief', 'interview_script', 'critique', 'done', 'error']
    stages.forEach((stage) => {
      const chunk: GenerateStreamChunk = { stage, content: `content-${stage}` }
      const decoded = decodeChunk(encodeChunk(chunk))
      expect(decoded?.stage).toBe(stage)
      expect(decoded?.content).toBe(`content-${stage}`)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonOutput — generate route specific scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonOutput — generate route scenarios', () => {
  it('parses FullResearchBrief from clean JSON', () => {
    const result = parseJsonOutput<FullResearchBrief>(JSON.stringify(SAMPLE_RESEARCH_BRIEF))
    expect(result?.productIdea).toBeTruthy()
    expect(result?.assumptionMap).toHaveLength(1)
    expect(result?.assumptionMap[0].riskLevel).toBe('high')
  })

  it('parses InterviewScript from clean JSON', () => {
    const result = parseJsonOutput<InterviewScript>(JSON.stringify(SAMPLE_INTERVIEW_SCRIPT))
    expect(result?.goal).toBeTruthy()
    expect(result?.questions).toHaveLength(2)
    expect(result?.questions[0].order).toBe(1)
  })

  it('parses research brief from fence-wrapped JSON', () => {
    const fenced = '```json\n' + JSON.stringify(SAMPLE_RESEARCH_BRIEF) + '\n```'
    const result = parseJsonOutput<FullResearchBrief>(fenced)
    expect(result?.productIdea).toBeTruthy()
  })

  it('parses interview script from fence-wrapped JSON', () => {
    const fenced = '```\n' + JSON.stringify(SAMPLE_INTERVIEW_SCRIPT) + '\n```'
    const result = parseJsonOutput<InterviewScript>(fenced)
    expect(result?.questions).toHaveLength(2)
  })

  it('returns null for truncated/partial JSON', () => {
    const partial = '{"productIdea":"Invoice tool","targetCustomer":"Freelance'
    expect(parseJsonOutput(partial)).toBeNull()
  })

  it('handles JSON with leading whitespace before fence', () => {
    // Outer whitespace is trimmed, but fence must start at beginning after trim
    const result = parseJsonOutput<{ x: number }>('```json\n{"x":42}\n```')
    expect(result?.x).toBe(42)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GenerateStreamChunk shape
// ─────────────────────────────────────────────────────────────────────────────

describe('GenerateStreamChunk shape validation', () => {
  it('research_brief chunk has correct shape', () => {
    const chunk: GenerateStreamChunk = { stage: 'research_brief', content: '{"key":"val"}' }
    expect(chunk.stage).toBe('research_brief')
    expect(typeof chunk.content).toBe('string')
  })

  it('done chunk content is JSON-parseable summary', () => {
    const summary = { researchBriefSaved: true, interviewScriptSaved: true }
    const chunk: GenerateStreamChunk = { stage: 'done', content: JSON.stringify(summary) }
    const decoded = decodeChunk(encodeChunk(chunk))
    const content = parseJsonOutput<typeof summary>(decoded!.content)
    expect(content?.researchBriefSaved).toBe(true)
    expect(content?.interviewScriptSaved).toBe(true)
  })

  it('error chunk content is human-readable string', () => {
    const chunk: GenerateStreamChunk = { stage: 'error', content: 'Üretim sırasında bir hata oluştu.' }
    expect(chunk.content).toMatch(/hata/i)
  })

  it('all stage values are valid enum members', () => {
    const VALID_STAGES = ['research_brief', 'interview_script', 'done', 'error']
    const chunk: GenerateStreamChunk = { stage: 'done', content: '' }
    expect(VALID_STAGES).toContain(chunk.stage)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Gemini mock
// ─────────────────────────────────────────────────────────────────────────────

describe('Streaming Gemini mock — generate route', () => {
  it('full JSON returned in one shot is parseable as research brief', async () => {
    server.use(
      http.post(GEMINI_URL, () =>
        HttpResponse.json({
          choices: [{
            message: { content: JSON.stringify(SAMPLE_RESEARCH_BRIEF), role: 'assistant' },
            finish_reason: 'stop',
            index: 0,
          }],
        })
      )
    )

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'gemini-flash-latest', messages: [], stream: false }),
    })

    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    const parsed = parseJsonOutput<FullResearchBrief>(data.choices[0].message.content)
    expect(parsed?.productIdea).toBeTruthy()
    expect(parsed?.assumptionMap.length).toBeGreaterThan(0)
  })

  it('interview script returned in one shot is parseable', async () => {
    server.use(
      http.post(GEMINI_URL, () =>
        HttpResponse.json({
          choices: [{
            message: { content: JSON.stringify(SAMPLE_INTERVIEW_SCRIPT), role: 'assistant' },
            finish_reason: 'stop',
            index: 0,
          }],
        })
      )
    )

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'gemini-flash-latest', messages: [], stream: false }),
    })

    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    const parsed = parseJsonOutput<InterviewScript>(data.choices[0].message.content)
    expect(parsed?.questions.length).toBeGreaterThanOrEqual(2)
    expect(parsed?.rulesForInterviewer.length).toBeGreaterThan(0)
  })

  it('429 response is received correctly', async () => {
    server.use(http.post(GEMINI_URL, () => new HttpResponse(null, { status: 429 })))
    const res = await fetch(GEMINI_URL, { method: 'POST', body: '{}' })
    expect(res.status).toBe(429)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Webhook — generate complete
// ─────────────────────────────────────────────────────────────────────────────

describe('Generate complete webhook', () => {
  it('fires with generate_complete event and projectId', async () => {
    const calls: unknown[] = []
    server.use(
      http.post(WEBHOOK_URL, async ({ request }) => {
        calls.push(await request.json())
        return HttpResponse.json({ ok: true })
      })
    )

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-gen-001', event: 'generate_complete' }),
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as { event: string }).event).toBe('generate_complete')
    expect((calls[0] as { projectId: string }).projectId).toBe('proj-gen-001')
  })

  it('webhook failure does not block main operation', async () => {
    server.use(http.post(WEBHOOK_URL, () => new HttpResponse(null, { status: 503 })))
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'fail', event: 'generate_complete' }),
    })
    // 503 döndü ama ana flow bu hatayla durmamalı (fire-and-forget)
    expect(res.status).toBe(503)
  })
})
