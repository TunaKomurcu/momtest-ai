/**
 * Unit tests — lib/ai-guards/intake-reply-guard.ts
 *
 * Kapsam:
 * - applyIntakeGuard: BLOCKED kalıpları, RISKY kalıpları, CLEAN geçişleri
 * - Erken <research_brief> teslimi (agentMessageCount < 3)
 * - Çok uzun cevap (> 200 kelime)
 * - Birden fazla soru (> 1 soru işareti)
 * - checkIntakeReplyIsolated: MSW mock ile LLM yanıtı simüle
 * - INTAKE_FALLBACK_MESSAGE: Mom Test uyumlu olmalı
 *
 * Pure fonksiyonlar için LLM/DB bağımlılığı yoktur.
 * Checker testi MSW ile izole edilir.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  applyIntakeGuard,
  checkIntakeReplyIsolated,
  INTAKE_FALLBACK_MESSAGE,
} from '@/lib/ai-guards/intake-reply-guard'
import OpenAI from 'openai'

// ── MSW server ────────────────────────────────────────────────────────────────

const MOCK_BASE_URL = 'https://mock-intake-checker.test/v1'
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

// ── applyIntakeGuard — BLOCKED kalıpları ─────────────────────────────────────

describe('applyIntakeGuard — BLOCKED kalıpları', () => {
  it('sahte doğrulama: "That\'s a great idea" → blocked', () => {
    const result = applyIntakeGuard("That's a great idea! Now let me ask you...")
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/sahte doğrulama/i)
  })

  it('sahte doğrulama: "this sounds like a great product" → blocked', () => {
    const result = applyIntakeGuard('This sounds like a great product. Who is your target user?')
    expect(result.verdict).toBe('blocked')
  })

  it('sahte doğrulama: "users will love this" → blocked', () => {
    const result = applyIntakeGuard('Users will love this. Tell me more about the problem.')
    expect(result.verdict).toBe('blocked')
  })

  it('sahte doğrulama: "this validates your assumption" → blocked', () => {
    const result = applyIntakeGuard('This validates your assumption. What segment are you targeting?')
    expect(result.verdict).toBe('blocked')
  })

  it('sahte doğrulama: "you should build this" → blocked', () => {
    const result = applyIntakeGuard('You should build this. What is the riskiest assumption?')
    expect(result.verdict).toBe('blocked')
  })

  it('sahte doğrulama: "the market wants this" → blocked', () => {
    const result = applyIntakeGuard('The market wants this. Who exactly are your users?')
    expect(result.verdict).toBe('blocked')
  })

  it('rol kayması: "Would you use this?" → blocked', () => {
    const result = applyIntakeGuard('Would you use this yourself as a PM?')
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/rol kayması/i)
  })

  it('rol kayması: "Do you like this idea?" → blocked', () => {
    const result = applyIntakeGuard('Do you like this idea so far?')
    expect(result.verdict).toBe('blocked')
  })

  it('Türkçe sahte doğrulama: "Bu harika bir fikir" → blocked', () => {
    const result = applyIntakeGuard('Bu harika bir fikir! Peki hedef kitleniz kim?')
    expect(result.verdict).toBe('blocked')
  })

  it('Türkçe sahte doğrulama: "kullanıcılar bunu sever" → blocked', () => {
    const result = applyIntakeGuard('Kullanıcılar bunu sever. Şimdi bana söyleyin...')
    expect(result.verdict).toBe('blocked')
  })
})

// ── applyIntakeGuard — Erken brief teslimi ────────────────────────────────────

describe('applyIntakeGuard — Erken <research_brief> teslimi', () => {
  const EARLY_BRIEF = `Great! <research_brief>{"researchGoal":"test"}</research_brief> Brief hazır.`

  it('0 agent mesajında brief → blocked', () => {
    const result = applyIntakeGuard(EARLY_BRIEF, 0)
    expect(result.verdict).toBe('blocked')
    expect(result.reason).toMatch(/erken.*brief/i)
  })

  it('2 agent mesajında brief → blocked', () => {
    const result = applyIntakeGuard(EARLY_BRIEF, 2)
    expect(result.verdict).toBe('blocked')
  })

  it('3 agent mesajında brief → clean (minimum karşılandı)', () => {
    const result = applyIntakeGuard(EARLY_BRIEF, 3)
    // research_brief içeren cevap guard'dan geçebilir (route'ta zaten ayrı kontrol var)
    expect(result.verdict).toBe('clean')
  })

  it('brief TAG içermeyen normal cevap agentMessageCount 0 ile → clean', () => {
    const result = applyIntakeGuard('Who exactly has this problem today?', 0)
    expect(result.verdict).toBe('clean')
  })
})

// ── applyIntakeGuard — RISKY kalıpları ───────────────────────────────────────

describe('applyIntakeGuard — RISKY kalıpları', () => {
  it('"I think..." ile başlayan cümle → risky', () => {
    const result = applyIntakeGuard('I think your target segment might be freelancers.')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/görüş/i)]))
  })

  it('"I believe..." → risky', () => {
    const result = applyIntakeGuard('I believe this assumption is the riskiest one.')
    expect(result.verdict).toBe('risky')
  })

  it('"most startups fail" → risky', () => {
    const result = applyIntakeGuard('Most startups fail because they skip discovery. What is your timeline?')
    expect(result.verdict).toBe('risky')
  })

  it('Türkçe "bence" → risky', () => {
    const result = applyIntakeGuard('Bence en riskli varsayım şu...')
    expect(result.verdict).toBe('risky')
  })

  it('Türkçe "sanırım" → risky', () => {
    const result = applyIntakeGuard('Sanırım hedef kitleniz işletme sahipleridir.')
    expect(result.verdict).toBe('risky')
  })

  it('birden fazla soru işareti → risky', () => {
    const result = applyIntakeGuard('Who is your target user? And when does this problem occur?')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/birden fazla soru/i)]))
  })

  it('200+ kelime cevap → risky', () => {
    const longReply = Array(201).fill('word').join(' ')
    const result = applyIntakeGuard(longReply)
    expect(result.verdict).toBe('risky')
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringMatching(/200 kelime/i)]))
  })

  it('risky verdict flags dizisi boş değil', () => {
    const result = applyIntakeGuard('I think this is a complex problem. What segment are you targeting?')
    expect(result.verdict).toBe('risky')
    expect(result.flags).toBeDefined()
    expect((result.flags ?? []).length).toBeGreaterThan(0)
  })
})

// ── applyIntakeGuard — CLEAN geçişleri ───────────────────────────────────────

describe('applyIntakeGuard — CLEAN geçişleri', () => {
  it('tek odaklı soru → clean', () => {
    expect(applyIntakeGuard('Who exactly has this problem today?').verdict).toBe('clean')
  })

  it('varsayım sorusu → clean', () => {
    expect(applyIntakeGuard('What assumption would kill this idea if it were false?').verdict).toBe('clean')
  })

  it('segment sorusu → clean', () => {
    expect(applyIntakeGuard('Which customer segment can you actually reach this week?').verdict).toBe('clean')
  })

  it('karar sorusu → clean', () => {
    expect(applyIntakeGuard('What decision are you trying to make after these interviews?').verdict).toBe('clean')
  })

  it('Türkçe soru → clean', () => {
    expect(applyIntakeGuard('Bu problemi tam olarak kimler yaşıyor?').verdict).toBe('clean')
  })

  it('boş string → clean (guard hata fırlatmaz)', () => {
    expect(() => applyIntakeGuard('')).not.toThrow()
    expect(applyIntakeGuard('').verdict).toBe('clean')
  })
})

// ── checkIntakeReplyIsolated — MSW mock ───────────────────────────────────────

describe('checkIntakeReplyIsolated — isolated LLM checker', () => {
  it('LLM "pass" döndürünce pass kabul edilir', async () => {
    mockCheckerResponse('pass', 'No violations found')
    const result = await checkIntakeReplyIsolated(
      'Who exactly has this problem today?',
      mockOpenAI,
      'test-model'
    )
    expect(result.verdict).toBe('pass')
  })

  it('LLM "fail" döndürünce fail kabul edilir', async () => {
    mockCheckerResponse('fail', 'Contains unsolicited validation')
    const result = await checkIntakeReplyIsolated(
      "I think this is a great direction. Who is your target?",
      mockOpenAI,
      'test-model'
    )
    expect(result.verdict).toBe('fail')
    expect(result.reason).toBe('Contains unsolicited validation')
  })

  it('LLM boş yanıt dönünce pass kabul edilir (graceful degradation)', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )
    const result = await checkIntakeReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
    expect(result.reason).toMatch(/empty response/i)
  })

  it('LLM API hatası durumunda pass kabul edilir (graceful degradation)', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        new HttpResponse(null, { status: 500 })
      )
    )
    const result = await checkIntakeReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
    expect(result.reason).toMatch(/error/i)
  })

  it('LLM 429 rate limit durumunda pass kabul edilir', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        new HttpResponse(null, { status: 429 })
      )
    )
    const result = await checkIntakeReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
  })

  it('beklenmedik verdict değeri gelince pass kabul edilir', async () => {
    server.use(
      http.post(`${MOCK_BASE_URL}/chat/completions`, () =>
        HttpResponse.json({
          choices: [{ message: { content: JSON.stringify({ verdict: 'unknown', reason: 'test' }), role: 'assistant' }, finish_reason: 'stop', index: 0 }],
        })
      )
    )
    const result = await checkIntakeReplyIsolated('Test message', mockOpenAI, 'test-model')
    expect(result.verdict).toBe('pass')
    expect(result.reason).toMatch(/unexpected verdict/i)
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
    await checkIntakeReplyIsolated('Who is your target user?', mockOpenAI, 'test-model')
    const body = capturedBodies[0] as { messages: Array<{ role: string; content: string }> }
    // Sadece system + user mesajı olmalı — conversation history yok
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('Who is your target user?')
  })
})

// ── INTAKE_FALLBACK_MESSAGE — Mom Test uyumu ─────────────────────────────────

describe('INTAKE_FALLBACK_MESSAGE', () => {
  it('tanımlı ve boş değil', () => {
    expect(typeof INTAKE_FALLBACK_MESSAGE).toBe('string')
    expect(INTAKE_FALLBACK_MESSAGE.trim().length).toBeGreaterThan(0)
  })

  it('yasaklı kalıplar içermiyor', () => {
    const result = applyIntakeGuard(INTAKE_FALLBACK_MESSAGE)
    expect(result.verdict).not.toBe('blocked')
  })

  it('soru formatında', () => {
    expect(INTAKE_FALLBACK_MESSAGE).toContain('?')
  })
})
