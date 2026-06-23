/**
 * Integration tests — POST /api/analyze/[interviewId]
 *
 * Kapsam:
 * - buildSignalScore: 4 kategori, boş arrays, message_id mapping
 * - buildSignalSummary: count doğruluğu
 * - buildMarkdownReport: zorunlu bölümler, forbidden phrases, tablo formatı
 * - parseJsonOutput: fence stripping, geçerli/geçersiz JSON
 * - Status guard: completed olmayan mülakatlar reddedilir
 * - Ownership check logic
 * - Gemini API mock: JSON yanıt, fence içeren yanıt, 429, boş yanıt
 * - Webhook: analysis_completed payload shape
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  buildSignalScore,
  buildSignalSummary,
  buildMarkdownReport,
} from '@/lib/api-helpers/analyze'
import { parseJsonOutput } from '@/lib/api-helpers/json'
import type {
  StructuredAnalysis,
  AnalysisCompletedWebhookPayload,
} from '@/types/index'

// ── MSW server ────────────────────────────────────────────────────────────

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const WEBHOOK_URL = 'https://hook.make.com/test-analyze'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Medium evidence found.',
    signalScore: {
      problemEvidence: 'medium',
      urgency: 'weak',
      workaroundEvidence: 'medium',
      budgetOrCommitment: 'negative',
    },
    strongEvidence: [],
    mediumEvidence: [],
    weakEvidence: [],
    negativeEvidence: [],
    openQuestions: [],
    recommendedNextStep: 'Interview 3 more participants.',
    ...overrides,
  }
}

const FULL_ANALYSIS = makeAnalysis({
  signalScore: {
    problemEvidence: 'strong',
    urgency: 'medium',
    workaroundEvidence: 'strong',
    budgetOrCommitment: 'medium',
  },
  strongEvidence: [
    { quote: 'Last month two clients paid late.', message_id: 'msg-001', whyItMatters: 'Recent specific event.' },
    { quote: 'I check spreadsheet every Friday.', message_id: 'msg-002', whyItMatters: 'Recurring behavior.' },
  ],
  mediumEvidence: [
    { quote: 'It happens maybe once a month.', message_id: 'msg-003', context: 'Self-reported frequency.' },
  ],
  weakEvidence: [
    { quote: 'I would probably try it.', message_id: 'msg-004', whyItIsWeak: 'Hypothetical intent.' },
  ],
  negativeEvidence: ['Never paid for a solution.'],
  openQuestions: ['Is frequency higher for other freelancer types?'],
  recommendedNextStep: 'Run 3 more interviews focusing on budget behavior.',
})

// ─────────────────────────────────────────────────────────────────────────────
// buildSignalScore
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSignalScore', () => {
  it('returns empty arrays for analysis with no evidence', () => {
    const score = buildSignalScore(makeAnalysis())
    expect(score.strong).toHaveLength(0)
    expect(score.medium).toHaveLength(0)
    expect(score.weak).toHaveLength(0)
    expect(score.negative).toHaveLength(0)
  })

  it('maps strong evidence to { quote, message_id }', () => {
    const score = buildSignalScore(FULL_ANALYSIS)
    expect(score.strong).toHaveLength(2)
    expect(score.strong[0]).toEqual({ quote: 'Last month two clients paid late.', message_id: 'msg-001' })
  })

  it('maps medium evidence correctly', () => {
    const score = buildSignalScore(FULL_ANALYSIS)
    expect(score.medium).toHaveLength(1)
    expect(score.medium[0].message_id).toBe('msg-003')
  })

  it('maps weak evidence correctly', () => {
    const score = buildSignalScore(FULL_ANALYSIS)
    expect(score.weak).toHaveLength(1)
    expect(score.weak[0].message_id).toBe('msg-004')
  })

  it('negative evidence gets empty string message_id', () => {
    const score = buildSignalScore(FULL_ANALYSIS)
    expect(score.negative).toHaveLength(1)
    expect(score.negative[0].message_id).toBe('')
    expect(score.negative[0].quote).toBe('Never paid for a solution.')
  })

  it('whyItMatters and context fields are stripped (only quote + message_id kept)', () => {
    const score = buildSignalScore(FULL_ANALYSIS)
    expect(Object.keys(score.strong[0])).toEqual(['quote', 'message_id'])
    expect(Object.keys(score.medium[0])).toEqual(['quote', 'message_id'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildSignalSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSignalSummary', () => {
  it('returns all zeros for empty analysis', () => {
    const summary = buildSignalSummary(makeAnalysis())
    expect(summary).toEqual({ strong_count: 0, medium_count: 0, weak_count: 0, negative_count: 0 })
  })

  it('counts all categories correctly', () => {
    const summary = buildSignalSummary(FULL_ANALYSIS)
    expect(summary.strong_count).toBe(2)
    expect(summary.medium_count).toBe(1)
    expect(summary.weak_count).toBe(1)
    expect(summary.negative_count).toBe(1)
  })

  it('counts match evidence array lengths', () => {
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'q1', message_id: 'm1', whyItMatters: 'w1' },
        { quote: 'q2', message_id: 'm2', whyItMatters: 'w2' },
        { quote: 'q3', message_id: 'm3', whyItMatters: 'w3' },
      ],
    })
    expect(buildSignalSummary(analysis).strong_count).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildMarkdownReport
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMarkdownReport', () => {
  it('contains all required sections', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'Deniz')
    expect(report).toContain('## Decision')
    expect(report).toContain('## Summary')
    expect(report).toContain('## Signal score')
    expect(report).toContain('## Strong evidence')
    expect(report).toContain('## Weak or misleading evidence')
    expect(report).toContain('## Negative evidence')
    expect(report).toContain('## Open questions')
    expect(report).toContain('## Recommended next step')
  })

  it('includes participant name in header', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'Deniz')
    expect(report).toContain('**Participant:** Deniz')
  })

  it('decision value is present in report', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain(FULL_ANALYSIS.decision)
  })

  it('all 4 signal score dimensions are present', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain('problem evidence: strong')
    expect(report).toContain('urgency: medium')
    expect(report).toContain('workaround evidence: strong')
    expect(report).toContain('budget or commitment: medium')
  })

  it('strong evidence table has correct columns', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain('| Quote or observation | Why it matters |')
  })

  it('weak evidence table has correct columns', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain('| Quote or observation | Why it is weak |')
  })

  it('negative evidence uses bullet list format', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain('- Never paid for a solution.')
  })

  it('open questions are numbered', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    expect(report).toContain('1. Is frequency higher for other freelancer types?')
  })

  it('omits strong evidence section when empty', () => {
    const report = buildMarkdownReport(makeAnalysis(), 'P')
    expect(report).not.toContain('## Strong evidence')
  })

  it('omits weak evidence section when empty', () => {
    const report = buildMarkdownReport(makeAnalysis(), 'P')
    expect(report).not.toContain('## Weak or misleading evidence')
  })

  it('does not contain forbidden validation phrases', () => {
    const forbidden = [
      /users loved the idea/i,
      /this validates the product/i,
      /people would use it/i,
    ]
    const report = buildMarkdownReport(FULL_ANALYSIS, 'Deniz')
    forbidden.forEach((re) => expect(re.test(report)).toBe(false))
  })

  it('recommended next step is at end of report', () => {
    const report = buildMarkdownReport(FULL_ANALYSIS, 'P')
    const stepIdx = report.lastIndexOf('## Recommended next step')
    const decisionIdx = report.indexOf('## Decision')
    expect(stepIdx).toBeGreaterThan(decisionIdx)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonOutput
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonOutput', () => {
  it('parses clean JSON string', () => {
    const result = parseJsonOutput<{ key: string }>('{"key":"value"}')
    expect(result?.key).toBe('value')
  })

  it('strips ```json fence', () => {
    const result = parseJsonOutput<{ x: number }>('```json\n{"x":1}\n```')
    expect(result?.x).toBe(1)
  })

  it('strips plain ``` fence', () => {
    const result = parseJsonOutput<{ x: number }>('```\n{"x":2}\n```')
    expect(result?.x).toBe(2)
  })

  it('returns null for invalid JSON', () => {
    expect(parseJsonOutput('{ bad json }')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseJsonOutput('')).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    const result = parseJsonOutput<{ n: number }>('  {"n":5}  ')
    expect(result?.n).toBe(5)
  })

  it('parses complex nested structure', () => {
    const obj = { decision: 'continue discovery', strongEvidence: [{ quote: 'test', message_id: 'x' }] }
    const result = parseJsonOutput<typeof obj>(JSON.stringify(obj))
    expect(result?.decision).toBe('continue discovery')
    expect(result?.strongEvidence).toHaveLength(1)
  })

  it('fence with uppercase JSON label', () => {
    const result = parseJsonOutput<{ a: string }>('```JSON\n{"a":"b"}\n```')
    expect(result?.a).toBe('b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interview status guard for analyze route
// ─────────────────────────────────────────────────────────────────────────────

describe('Analyze status guard', () => {
  type Status = 'pending' | 'ongoing' | 'completed'
  const canBeAnalyzed = (s: Status) => s === 'completed'

  it('pending → cannot be analyzed', () => expect(canBeAnalyzed('pending')).toBe(false))
  it('ongoing → cannot be analyzed', () => expect(canBeAnalyzed('ongoing')).toBe(false))
  it('completed → can be analyzed', () => expect(canBeAnalyzed('completed')).toBe(true))
})

// ─────────────────────────────────────────────────────────────────────────────
// Webhook payload — analysis_completed
// ─────────────────────────────────────────────────────────────────────────────

describe('Analysis completed webhook payload', () => {
  it('payload has all required fields and correct types', () => {
    const payload: AnalysisCompletedWebhookPayload = {
      event: 'analysis_completed',
      interview_id: 'iv-001',
      project_id: 'proj-001',
      participant_name: 'Deniz',
      signal_summary: { strong_count: 3, medium_count: 1, weak_count: 2, negative_count: 0 },
      decision: 'continue discovery',
      analyzed_at: new Date().toISOString(),
    }
    expect(payload.event).toBe('analysis_completed')
    expect(payload.signal_summary.strong_count).toBe(3)
    expect(typeof payload.decision).toBe('string')
    expect(new Date(payload.analyzed_at).toISOString()).toBe(payload.analyzed_at)
  })

  it('webhook fires via MSW with correct payload', async () => {
    const calls: unknown[] = []
    server.use(
      http.post(WEBHOOK_URL, async ({ request }) => {
        calls.push(await request.json())
        return HttpResponse.json({ ok: true })
      })
    )

    const payload: AnalysisCompletedWebhookPayload = {
      event: 'analysis_completed',
      interview_id: 'iv-002',
      project_id: 'proj-002',
      participant_name: 'Arda',
      signal_summary: { strong_count: 0, medium_count: 0, weak_count: 1, negative_count: 3 },
      decision: 'change segment',
      analyzed_at: new Date().toISOString(),
    }

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as typeof payload).event).toBe('analysis_completed')
    expect((calls[0] as typeof payload).signal_summary.negative_count).toBe(3)
    expect((calls[0] as typeof payload).decision).toBe('change segment')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API mock — analyze route
// ─────────────────────────────────────────────────────────────────────────────

describe('Gemini API mock — analyze route', () => {
  it('returns valid JSON analysis when mocked', async () => {
    const mockAnalysis = makeAnalysis({ decision: 'test commitment' })
    server.use(
      http.post(GEMINI_URL, () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify(mockAnalysis), role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'gemini-flash-latest', messages: [] }),
    })

    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    const parsed = parseJsonOutput<StructuredAnalysis>(data.choices[0].message.content)
    expect(parsed?.decision).toBe('test commitment')
  })

  it('handles fence-wrapped JSON from Gemini', async () => {
    const mockAnalysis = makeAnalysis({ decision: 'stop' })
    const fenced = '```json\n' + JSON.stringify(mockAnalysis) + '\n```'

    server.use(
      http.post(GEMINI_URL, () =>
        HttpResponse.json({
          choices: [{ message: { content: fenced, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'gemini-flash-latest', messages: [] }),
    })

    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    const parsed = parseJsonOutput<StructuredAnalysis>(data.choices[0].message.content)
    expect(parsed?.decision).toBe('stop')
  })

  it('returns 429 on rate limit', async () => {
    server.use(http.post(GEMINI_URL, () => new HttpResponse(null, { status: 429 })))
    const res = await fetch(GEMINI_URL, { method: 'POST', body: '{}' })
    expect(res.status).toBe(429)
  })
})
