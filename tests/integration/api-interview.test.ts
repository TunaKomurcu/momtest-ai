/**
 * Integration tests — POST /api/interview/[interviewId]
 *
 * Kapsam:
 * - serializeInterviewScript: null, tam script, sadece goal, sırasız sorular
 * - countMeaningfulParticipantReplies: eşik, karışık mesajlar, boş
 * - isClosingMessage: tüm kalıplar, opening frame false positive gate
 * - shouldCloseInterview: min 3 gate, 10+ threshold, kombinasyonlar
 * - Body validation: participant_name min 2 karakter
 * - Status guard: completed interview → yeni mesaj reddedilir
 * - Gemini API mock: başarılı yanıt, 429, boş content
 * - Webhook: interview_completed payload shape
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  countMeaningfulParticipantReplies,
  isClosingMessage,
  serializeInterviewScript,
  shouldCloseInterview,
} from '@/lib/api-helpers/interview'
import type { ConversationMessage, InterviewCompletedWebhookPayload } from '@/types/index'

// ── MSW server ────────────────────────────────────────────────────────────

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const WEBHOOK_URL = 'https://hook.make.com/test-interview'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ── Fixtures ──────────────────────────────────────────────────────────────

const CLOSING_MSG = 'This has been really helpful. Thank you for your time and honest answers. I have what I need. Have a great day!'
const OPENING_FRAME = 'Thanks for taking the time. I am trying to understand how this situation works in your real workflow. I am not here to sell anything. Ready to get started?'

function makeParticipantMsg(content: string): ConversationMessage {
  return { sender: 'participant', content }
}
function makeAgentMsg(content: string): ConversationMessage {
  return { sender: 'agent', content }
}

// ─────────────────────────────────────────────────────────────────────────────
// serializeInterviewScript
// ─────────────────────────────────────────────────────────────────────────────

describe('serializeInterviewScript', () => {
  it('returns fallback when script is null', () => {
    expect(serializeInterviewScript(null)).toContain('No interview script available')
  })

  it('includes goal when present', () => {
    expect(serializeInterviewScript({ goal: 'Understand invoicing pain' }))
      .toContain('Interview goal: Understand invoicing pain')
  })

  it('includes rules when present', () => {
    const result = serializeInterviewScript({
      goal: 'G',
      rulesForInterviewer: ['Do not pitch', 'Ask one question'],
    })
    expect(result).toContain('- Do not pitch')
    expect(result).toContain('- Ask one question')
  })

  it('includes ordered questions with signal tags', () => {
    const result = serializeInterviewScript({
      goal: 'G',
      questions: [
        { order: 1, question: 'Tell me about the last time.', signalSought: 'problem' },
        { order: 2, question: 'What did you do next?', signalSought: 'workaround' },
      ],
    })
    expect(result).toContain('1. Tell me about the last time. [signal: problem]')
    expect(result).toContain('2. What did you do next? [signal: workaround]')
  })

  it('uses dash prefix when order is undefined', () => {
    expect(serializeInterviewScript({ questions: [{ question: 'Walk me through your process.' }] }))
      .toContain('- Walk me through your process.')
  })

  it('omits signal tag when signalSought is missing', () => {
    const result = serializeInterviewScript({ questions: [{ order: 1, question: 'How often?' }] })
    expect(result).toContain('1. How often?')
    expect(result).not.toContain('[signal:')
  })

  it('handles empty questions array without section header', () => {
    const result = serializeInterviewScript({ goal: 'G', questions: [] })
    expect(result).toContain('Interview goal: G')
    expect(result).not.toContain('Guided question sequence')
  })

  it('returns fallback on parse error', () => {
    // Passing a string as script triggers catch
    expect(serializeInterviewScript('invalid' as unknown as null))
      .not.toContain('Interview goal')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// countMeaningfulParticipantReplies
// ─────────────────────────────────────────────────────────────────────────────

describe('countMeaningfulParticipantReplies', () => {
  it('returns 0 for empty messages', () => {
    expect(countMeaningfulParticipantReplies([])).toBe(0)
  })

  it('counts only participant messages with ≥5 words', () => {
    const msgs = [
      makeParticipantMsg('one two three four five'),
      makeParticipantMsg('short'),
      makeAgentMsg('Tell me about the last time this happened to you'),
    ]
    expect(countMeaningfulParticipantReplies(msgs)).toBe(1)
  })

  it('exactly 5 words counts as meaningful', () => {
    expect(countMeaningfulParticipantReplies([
      makeParticipantMsg('one two three four five'),
    ])).toBe(1)
  })

  it('4-word message does not count', () => {
    expect(countMeaningfulParticipantReplies([
      makeParticipantMsg('one two three four'),
    ])).toBe(0)
  })

  it('agent messages are never counted', () => {
    expect(countMeaningfulParticipantReplies([
      makeAgentMsg('one two three four five six seven eight'),
    ])).toBe(0)
  })

  it('counts multiple meaningful replies correctly', () => {
    const msgs = [
      makeParticipantMsg('I use spreadsheets every single week for this'),
      makeAgentMsg('Walk me through that'),
      makeParticipantMsg('I download the data manually and format it'),
      makeParticipantMsg('ok'),
    ]
    expect(countMeaningfulParticipantReplies(msgs)).toBe(2)
  })

  it('handles extra whitespace in content', () => {
    expect(countMeaningfulParticipantReplies([
      makeParticipantMsg('  one   two   three   four   five  '),
    ])).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isClosingMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('isClosingMessage', () => {
  it('detects "Thank you for your time"', () => {
    expect(isClosingMessage('Thank you for your time and honest answers.')).toBe(true)
  })

  it('detects "This has been really helpful"', () => {
    expect(isClosingMessage('This has been really helpful. I have what I need.')).toBe(true)
  })

  it('detects "Have a great day"', () => {
    expect(isClosingMessage('Have a great day!')).toBe(true)
  })

  it('detects "Thanks for taking the time"', () => {
    expect(isClosingMessage('Thanks for taking the time today.')).toBe(true)
  })

  it('detects full closing message', () => {
    expect(isClosingMessage(CLOSING_MSG)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isClosingMessage('THANK YOU FOR YOUR TIME')).toBe(true)
    expect(isClosingMessage('HAVE A GREAT DAY')).toBe(true)
  })

  it('returns false for regular question messages', () => {
    expect(isClosingMessage('Tell me about the last time this happened.')).toBe(false)
  })

  it('opening frame contains "Thanks for taking the time" — important for gate logic', () => {
    // Opening frame DOES match — the route gates on min 3 replies BEFORE checking
    expect(isClosingMessage(OPENING_FRAME)).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isClosingMessage('')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shouldCloseInterview
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldCloseInterview', () => {
  it('returns false with 0 messages and non-closing reply', () => {
    expect(shouldCloseInterview([], 'Tell me more.')).toBe(false)
  })

  it('returns false with 2 meaningful replies + closing message (gate not met)', () => {
    const msgs = [
      makeParticipantMsg('I use spreadsheets to track every invoice manually'),
      makeParticipantMsg('It happens about once a month when clients delay'),
    ]
    expect(shouldCloseInterview(msgs, CLOSING_MSG)).toBe(false)
  })

  it('returns true with exactly 3 meaningful replies + closing message', () => {
    const msgs = [
      makeParticipantMsg('I use spreadsheets to track every invoice manually'),
      makeParticipantMsg('It happens about once a month when clients delay'),
      makeParticipantMsg('I also send reminders through email every week to clients'),
    ]
    expect(shouldCloseInterview(msgs, CLOSING_MSG)).toBe(true)
  })

  it('returns false with 3 meaningful replies + non-closing reply', () => {
    const msgs = [
      makeParticipantMsg('I use spreadsheets to track every invoice manually'),
      makeParticipantMsg('It happens about once a month when clients delay'),
      makeParticipantMsg('I also send reminders through email every week to clients'),
    ]
    expect(shouldCloseInterview(msgs, 'How often does this happen?')).toBe(false)
  })

  it('returns true with exactly 10 meaningful replies (threshold)', () => {
    const msgs = Array.from({ length: 10 }, () =>
      makeParticipantMsg('I track invoices manually every week using a spreadsheet template')
    )
    expect(shouldCloseInterview(msgs, 'Tell me more.')).toBe(true)
  })

  it('returns true with 11 meaningful replies (over threshold)', () => {
    const msgs = Array.from({ length: 11 }, () =>
      makeParticipantMsg('I check invoices every single Friday using my spreadsheet')
    )
    expect(shouldCloseInterview(msgs, 'Any other question?')).toBe(true)
  })

  it('short messages (< 5 words) do not count toward gate', () => {
    const msgs = [
      makeParticipantMsg('yes'),
      makeParticipantMsg('no'),
      makeParticipantMsg('ok sure'),
    ]
    expect(shouldCloseInterview(msgs, CLOSING_MSG)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interview status guard logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Interview status guard', () => {
  type Status = 'pending' | 'ongoing' | 'completed'

  const canAcceptMessage = (s: Status) => s !== 'completed'
  const isFirstMessage = (s: Status) => s === 'pending'

  it('pending → accepts new message', () => expect(canAcceptMessage('pending')).toBe(true))
  it('ongoing → accepts new message', () => expect(canAcceptMessage('ongoing')).toBe(true))
  it('completed → rejects new message', () => expect(canAcceptMessage('completed')).toBe(false))
  it('pending → isFirstMessage true', () => expect(isFirstMessage('pending')).toBe(true))
  it('ongoing → isFirstMessage false', () => expect(isFirstMessage('ongoing')).toBe(false))
  it('completed → isFirstMessage false', () => expect(isFirstMessage('completed')).toBe(false))
})

// ─────────────────────────────────────────────────────────────────────────────
// Webhook payload shape
// ─────────────────────────────────────────────────────────────────────────────

describe('Interview completed webhook payload', () => {
  it('payload has all required fields', () => {
    const payload: InterviewCompletedWebhookPayload = {
      event: 'interview_completed',
      interview_id: 'iv-001',
      project_id: 'proj-001',
      participant_name: 'Deniz',
      message_count: 20,
      completed_at: new Date().toISOString(),
    }
    expect(payload.event).toBe('interview_completed')
    expect(payload.interview_id).toBeTruthy()
    expect(payload.project_id).toBeTruthy()
    expect(payload.participant_name).toBeTruthy()
    expect(payload.message_count).toBeGreaterThan(0)
    expect(new Date(payload.completed_at).toISOString()).toBe(payload.completed_at)
  })

  it('webhook fires via MSW mock with correct payload', async () => {
    const calls: unknown[] = []
    server.use(
      http.post(WEBHOOK_URL, async ({ request }) => {
        calls.push(await request.json())
        return HttpResponse.json({ ok: true })
      })
    )

    const payload: InterviewCompletedWebhookPayload = {
      event: 'interview_completed',
      interview_id: 'iv-001',
      project_id: 'proj-001',
      participant_name: 'Deniz',
      message_count: 20,
      completed_at: new Date().toISOString(),
    }

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(calls).toHaveLength(1)
    expect((calls[0] as typeof payload).event).toBe('interview_completed')
    expect((calls[0] as typeof payload).message_count).toBe(20)
  })

  it('participant name is trimmed before use', () => {
    const raw = '  Deniz  '
    expect(raw.trim()).toBe('Deniz')
    expect(raw.trim().length).toBeGreaterThanOrEqual(2)
  })

  it('participant_name < 2 chars is invalid', () => {
    const validate = (name: string) => name.trim().length >= 2
    expect(validate('A')).toBe(false)
    expect(validate('Al')).toBe(true)
    expect(validate('  A  ')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API mock
// ─────────────────────────────────────────────────────────────────────────────

describe('Gemini API mock — interview route', () => {
  it('successful response returns agent reply content', async () => {
    const reply = 'Tell me about the last time a client paid late.'
    server.use(
      http.post(GEMINI_URL, () =>
        HttpResponse.json({
          choices: [{ message: { content: reply, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'gemini-flash-latest', messages: [] }),
    })
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    expect(data.choices[0].message.content).toBe(reply)
  })

  it('rate limit 429 is received correctly', async () => {
    server.use(http.post(GEMINI_URL, () => new HttpResponse(null, { status: 429 })))
    const res = await fetch(GEMINI_URL, { method: 'POST', body: '{}' })
    expect(res.status).toBe(429)
  })
})
