/**
 * Unit tests — lib/ai-guards/interview-reply-guard.ts
 *
 * Kapsam:
 * - applyInterviewGuard: BLOCKED kalıpları (SKILL.md Skill 3+5 yasaklı sorular,
 *   ürün ifşası, gelecek niyet), RISKY kalıpları (aşırı onaylama, framing bias,
 *   çok soru), CLEAN geçişleri
 * - checkInterviewReplyIsolated: MSW mock ile LLM yanıtı simüle
 * - INTERVIEW_FALLBACK_MESSAGE: Mom Test uyumlu olmalı
 *
 * Pure fonksiyonlar için LLM/DB bağımlılığı yoktur.
 * Checker testi MSW ile izole edilir.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  applyInterviewGuard,
  checkInterviewReplyIsolated,
  INTERVIEW_FALLBACK_MESSAGE,
} from '@/lib/ai-guards/interview-reply-guard'
import OpenAI from 'openai'

// ── MSW server ────────────────────────────────────────────────────────────────

const MOCK_BASE_URL = 'https://mock-interview-checker.test/v1'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const mockOpenAI = new OpenAI({ apiKey: 'test', baseURL: MOCK_BASE_URL })

function mockCheckerResponse(verdict: 'pass' | 'fail', reason = 'test reason') {
  server.use(
    http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
      HttpResponse.json({
        choices: [{
          message: { content: JSON.stringify({ verdict, reason }), role: 'assistant' },
          finish_reason: 'stop',
          index: 0,
        }],
      })
    )
  )
}

// ── applyInterviewGuard — BLOCKED: ürün ifşası ───────────────────────────────

describe('applyInterviewGuard — BLOCKED: ürün ifşası', () => {
  it('"our product" → blocked', () => {
    const result = applyInterviewGuard('Our product would help you handle this automatically.')
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/ürün ifşası/i)
  })

  it('"our app" → blocked', () => {
    const result = applyInterviewGuard('Our app is designed to solve exactly this.')
    expect(result.verdict).toBe('blocked')
  })

  it('"our solution" → blocked', () => {
    const result = applyInterviewGuard('Our solution handles invoice reminders automatically.')
    expect(result.verdict).toBe('blocked')
  })

  it('"what we\'re building" → blocked', () => {
    const result = applyInterviewGuard("Let me tell you about what we're building.")
    expect(result.verdict).toBe('blocked')
  })

  it('"the app would help" → blocked', () => {
    const result = applyInterviewGuard('The app would help you track these payments.')
    expect(result.verdict).toBe('blocked')
  })

  it('"I think you would benefit from" → blocked', () => {
    const result = applyInterviewGuard('I think you would benefit from an automated reminder system.')
    expect(result.verdict).toBe('blocked')
  })
})

// ── applyInterviewGuard — BLOCKED: yasaklı görüş/onay soruları ───────────────

describe('applyInterviewGuard — BLOCKED: görüş/onay soruları (SKILL.md Skill 3)', () => {
  it('"Would you use this?" → blocked', () => {
    const result = applyInterviewGuard('Would you use this kind of tool?')
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/yasaklı soru/i)
  })

  it('"Would you use something like this?" → blocked', () => {
    const result = applyInterviewGuard('Would you use something like this in your workflow?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Would you pay for this?" → blocked', () => {
    const result = applyInterviewGuard('Would you pay for this kind of service?')
    expect(result.verdict).toBe('blocked')
  })

  it('"How much would you pay?" → blocked', () => {
    const result = applyInterviewGuard('How much would you pay for a solution like this?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Do you like this idea?" → blocked', () => {
    const result = applyInterviewGuard('Do you like this idea?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Is this a good idea?" → blocked', () => {
    const result = applyInterviewGuard('Is this a good idea for your business?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Is this interesting to you?" → blocked', () => {
    const result = applyInterviewGuard('Is this interesting to you?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Should we build this?" → blocked', () => {
    const result = applyInterviewGuard('Should we build this feature?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Could you imagine using this?" → blocked', () => {
    const result = applyInterviewGuard('Could you imagine using this in your team?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Would this be useful?" → blocked', () => {
    const result = applyInterviewGuard('Would this be useful for your workflow?')
    expect(result.verdict).toBe('blocked')
  })

  it('"What features do you want?" → blocked', () => {
    const result = applyInterviewGuard('What features do you want to see in a tool like this?')
    expect(result.verdict).toBe('blocked')
  })
})

// ── applyInterviewGuard — BLOCKED: gelecek niyet soruları ────────────────────

describe('applyInterviewGuard — BLOCKED: gelecek niyet / "Would you..." başlangıcı', () => {
  it('"Would you consider..." → blocked', () => {
    const result = applyInterviewGuard('Would you consider switching from your current tool?')
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/gelecek niyet/i)
  })

  it('"Would you be willing to..." → blocked', () => {
    const result = applyInterviewGuard('Would you be willing to try a new approach?')
    expect(result.verdict).toBe('blocked')
  })

  it('"Would you recommend this to..." → blocked', () => {
    const result = applyInterviewGuard('Would you recommend this to your team?')
    expect(result.verdict).toBe('blocked')
  })
})

// ── applyInterviewGuard — RISKY kalıpları ────────────────────────────────────

describe('applyInterviewGuard — RISKY kalıpları', () => {
  it('"That\'s great!" aşırı onaylama → risky', () => {
    const result = applyInterviewGuard("That's great! Tell me more about your workflow.")
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/aşırı onaylama/i)]))
  })

  it('"That\'s amazing!" → risky', () => {
    const result = applyInterviewGuard("That's amazing! Walk me through what happened next.")
    expect(result.verdict).toBe('risky')
  })

  it('"Wow" → risky', () => {
    const result = applyInterviewGuard('Wow, that sounds like a significant problem.')
    expect(result.verdict).toBe('risky')
  })

  it('"I think" AI görüş enjeksiyonu → risky', () => {
    const result = applyInterviewGuard('I think this happens because of poor tooling. How do you handle it?')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/görüş enjeksiyonu/i)]))
  })

  it('"I believe" → risky', () => {
    const result = applyInterviewGuard('I believe this is a common pain point. Tell me more.')
    expect(result.verdict).toBe('risky')
  })

  it('"It sounds like you" framing bias → risky', () => {
    const result = applyInterviewGuard('It sounds like you spend a lot of time on this.')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/framing bias/i)]))
  })

  it('"So you\'re saying" framing bias → risky', () => {
    const result = applyInterviewGuard("So you're saying this happens every week?")
    expect(result.verdict).toBe('risky')
  })

  it('Türkçe "harika" → risky', () => {
    const result = applyInterviewGuard('Harika! Bana biraz daha anlatır mısınız?')
    expect(result.verdict).toBe('risky')
  })

  it('Türkçe "bence" → risky', () => {
    const result = applyInterviewGuard('Bence bu ciddi bir sorun. Nasıl çözüyorsunuz şu an?')
    expect(result.verdict).toBe('risky')
  })

  it('birden fazla soru işareti → risky', () => {
    const result = applyInterviewGuard('How often does this happen? And what tools do you use?')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/birden fazla soru/i)]))
  })

  it('50+ kelimelik soru → risky', () => {
    const longQuestion = Array(55).fill('word').join(' ') + '?'
    const result = applyInterviewGuard(longQuestion)
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/50 kelime/i)]))
  })

  it('risky verdict flags dizisi boş değil', () => {
    const result = applyInterviewGuard("That's great! Tell me more about this.")
    expect(result.verdict).toBe('risky')
    expect(result.flags).toBeDefined()
    expect((result.flags ?? []).length).toBeGreaterThan(0)
  })
})

// ── applyInterviewGuard — CLEAN geçişleri ────────────────────────────────────

describe('applyInterviewGuard — CLEAN geçişleri (Mom Test uyumlu sorular)', () => {
  it('son kez ne zaman oldu sorusu → clean', () => {
    expect(applyInterviewGuard('Tell me about the last time this happened.').verdict).toBe('clean')
  })

  it('iş akışı sorusu → clean', () => {
    expect(applyInterviewGuard('Walk me through how you handle this today.').verdict).toBe('clean')
  })

  it('geçici çözüm sorusu → clean', () => {
    expect(applyInterviewGuard('How are you dealing with this right now?').verdict).toBe('clean')
  })

  it('maliyet sorusu → clean', () => {
    expect(applyInterviewGuard('How long does this take each time it happens?').verdict).toBe('clean')
  })

  it('araç sorusu → clean', () => {
    expect(applyInterviewGuard('What tools are involved in this process?').verdict).toBe('clean')
  })

  it('kapanış sorusu → clean', () => {
    expect(applyInterviewGuard('Who else should I talk to about this?').verdict).toBe('clean')
  })

  it('Türkçe geçmiş davranış sorusu → clean', () => {
    expect(applyInterviewGuard('Bunu en son ne zaman yaşadınız?').verdict).toBe('clean')
  })

  it('Mom Test kapanış cümlesi → clean', () => {
    expect(applyInterviewGuard('This has been really helpful. Thank you for your time and honest answers. I have what I need. Have a great day!').verdict).toBe('clean')
  })

  it('boş string → clean (guard hata fırlatmaz)', () => {
    expect(() => applyInterviewGuard('')).not.toThrow()
    expect(applyInterviewGuard('').verdict).toBe('clean')
  })
})

// ── checkInterviewReplyIsolated — MSW mock ────────────────────────────────────

describe('checkInterviewReplyIsolated — isolated LLM checker', () => {
  it('LLM "pass" döndürünce pass kabul edilir', async () => {
    mockCheckerResponse('pass', 'No violations found')
    const result = await checkInterviewReplyIsolated(
      'Tell me about the last time this happened.',
      mockOpenAI,
      'test-model'
    )
    expect(result.verdict).toBe('pass')
  })

  it('LLM "fail" döndürünce fail kabul edilir', async () => {
    mockCheckerResponse('fail', 'Contains future intent question')
    const result = await checkInterviewReplyIsolated(
      'Would you use something like this?',
      mockOpenAI,
      'test-model'
    )
    expect(result.verdict).toBe('fail')
    expect(result.reason).toBe('Contains future intent question')
  })

  it('LLM boş yanıt dönünce pass kabul edilir (graceful degradation)', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )
    const result = await checkInterviewReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
    expect(result.reason).toMatch(/empty response/i)
  })

  it('LLM API hatası durumunda pass kabul edilir (graceful degradation)', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        new HttpResponse(null, { status: 500 })
      )
    )
    const result = await checkInterviewReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
    expect(result.reason).toMatch(/error/i)
  })

  it('LLM 429 rate limit durumunda pass kabul edilir', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        new HttpResponse(null, { status: 429 })
      )
    )
    const result = await checkInterviewReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
  })

  it('checker sıfır conversation history ile çalışır — gelen mesaj sadece reply\'ı içerir', async () => {
    const capturedBodies: unknown[] = []
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, async ({ request }) => {
        capturedBodies.push(await request.json())
        return HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ verdict: 'pass', reason: 'ok' }), role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      })
    )
    await checkInterviewReplyIsolated(
      'Tell me about the last time this happened.',
      mockOpenAI,
      'test-model'
    )
    const body = capturedBodies[0] as { messages: Array<{ role: string; content: string }> }
    // Sadece system + user mesajı olmalı — conversation history yok
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('Tell me about the last time this happened.')
  })

  it('checker temperature 0 ile çağrılır (deterministik)', async () => {
    const capturedBodies: unknown[] = []
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, async ({ request }) => {
        capturedBodies.push(await request.json())
        return HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ verdict: 'pass', reason: 'ok' }), role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      })
    )
    await checkInterviewReplyIsolated('Test message', mockOpenAI, 'test-model')
    const body = capturedBodies[0] as { temperature: number }
    expect(body.temperature).toBe(0)
  })
})

// ── INTERVIEW_FALLBACK_MESSAGE — Mom Test uyumu ───────────────────────────────

describe('INTERVIEW_FALLBACK_MESSAGE', () => {
  it('tanımlı ve boş değil', () => {
    expect(typeof INTERVIEW_FALLBACK_MESSAGE).toBe('string')
    expect(INTERVIEW_FALLBACK_MESSAGE.trim().length).toBeGreaterThan(0)
  })

  it('yasaklı kalıplar içermiyor', () => {
    const result = applyInterviewGuard(INTERVIEW_FALLBACK_MESSAGE)
    expect(result.verdict).not.toBe('blocked')
  })

  it('soru formatında', () => {
    expect(INTERVIEW_FALLBACK_MESSAGE).toContain('?')
  })

  it('geçmiş davranış odaklı ("last time" içeriyor)', () => {
    expect(INTERVIEW_FALLBACK_MESSAGE.toLowerCase()).toContain('last time')
  })
})
