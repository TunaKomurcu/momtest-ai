/**
 * Unit tests — lib/ai-guards/json-retry.ts
 *
 * Kapsam:
 * - parseAndClean: fence stripping, leading prose, boş/geçersiz input
 * - callWithJsonRetry: ilk denemede başarı, parse hatası → retry, validation hatası → retry,
 *   maxRetries exhausted → null, boş yanıt → retry, API hatası → retry then null
 *
 * LLM bağımlılığı yoktur — OpenAI client mock'lanır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseAndClean, callWithJsonRetry } from '@/lib/ai-guards/json-retry'
import type { ValidationResult } from '@/types/index'
import type OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface SimpleObj {
  name: string
  value: number
}

function alwaysValid(parsed: SimpleObj): ValidationResult<SimpleObj> {
  return { ok: true, value: parsed }
}

function alwaysInvalid(parsed: SimpleObj): ValidationResult<SimpleObj> {
  return { ok: false, issues: ['name must be longer', 'value must be positive'] }
}

function validIfNameLong(parsed: SimpleObj): ValidationResult<SimpleObj> {
  if (!parsed.name || parsed.name.length < 5) {
    return { ok: false, issues: ['name must be at least 5 characters'] }
  }
  return { ok: true, value: parsed }
}

/** OpenAI client'ının chat.completions.create metodunu mock'layan yardımcı */
function makeMockOpenAI(
  responses: Array<string | null | Error>
): OpenAI {
  let callIndex = 0
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const response = responses[Math.min(callIndex++, responses.length - 1)]
          if (response instanceof Error) throw response
          return {
            choices: [{
              message: { content: response, role: 'assistant' },
              finish_reason: 'stop',
              index: 0,
            }],
          }
        }),
      },
    },
  } as unknown as OpenAI
}

const BASE_PARAMS: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
  model: 'test-model',
  stream: false,
  messages: [{ role: 'user', content: 'test' }],
}

// ---------------------------------------------------------------------------
// parseAndClean
// ---------------------------------------------------------------------------

describe('parseAndClean — temel JSON parse', () => {
  it('temiz JSON string\'i parse eder', () => {
    const result = parseAndClean<SimpleObj>('{"name":"test","value":42}')
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('```json fence\'li çıktıyı temizler', () => {
    const result = parseAndClean<SimpleObj>('```json\n{"name":"fenced","value":1}\n```')
    expect(result).toEqual({ name: 'fenced', value: 1 })
  })

  it('``` (lang olmadan) fence\'li çıktıyı temizler', () => {
    const result = parseAndClean<SimpleObj>('```\n{"name":"plain","value":2}\n```')
    expect(result).toEqual({ name: 'plain', value: 2 })
  })

  it('JSON\'dan önce gelen prose\'u atlar', () => {
    const result = parseAndClean<SimpleObj>(
      'Sure! Here is the JSON object:\n{"name":"after-prose","value":99}'
    )
    expect(result).toEqual({ name: 'after-prose', value: 99 })
  })

  it('JSON\'dan önce gelen prose + fence kombinasyonunu temizler', () => {
    const raw = 'Here is your result:\n```json\n{"name":"combo","value":7}\n```'
    const result = parseAndClean<SimpleObj>(raw)
    expect(result?.name).toBe('combo')
  })

  it('array JSON\'ı parse eder', () => {
    const result = parseAndClean<number[]>('[1, 2, 3]')
    expect(result).toEqual([1, 2, 3])
  })

  it('bozuk JSON için null döner', () => {
    expect(parseAndClean('{"name":"broken"')).toBeNull()
  })

  it('boş string için null döner', () => {
    expect(parseAndClean('')).toBeNull()
  })

  it('JSON içermeyen prose için null döner', () => {
    expect(parseAndClean('Sorry, I cannot do that.')).toBeNull()
  })

  it('sadece boşluk içeren string için null döner', () => {
    expect(parseAndClean('   \n\t  ')).toBeNull()
  })

  it('başındaki ve sonundaki whitespace\'i trim eder', () => {
    const result = parseAndClean<SimpleObj>('  {"name":"trimmed","value":0}  ')
    expect(result).toEqual({ name: 'trimmed', value: 0 })
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — ilk denemede başarı
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — ilk denemede başarı', () => {
  it('geçerli JSON + geçer validation → değeri döner', async () => {
    const openai = makeMockOpenAI(['{"name":"hello","value":5}'])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result).toEqual({ name: 'hello', value: 5 })
  })

  it('LLM tam olarak 1 kez çağrılır', async () => {
    const openai = makeMockOpenAI(['{"name":"once","value":1}'])
    await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1)
  })

  it('fence\'li JSON ilk denemede parse edilir', async () => {
    const openai = makeMockOpenAI(['```json\n{"name":"fenced","value":3}\n```'])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result?.name).toBe('fenced')
  })

  it('prose + JSON ilk denemede parse edilir', async () => {
    const openai = makeMockOpenAI(['Here you go: {"name":"prose","value":8}'])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result?.name).toBe('prose')
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — parse hatası → retry
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — parse hatası → retry', () => {
  it('1. deneme bozuk JSON, 2. deneme geçerli → değeri döner', async () => {
    const openai = makeMockOpenAI([
      'Sure! Here is your result: { broken json',         // attempt 0: parse fail
      '{"name":"repaired","value":10}',                   // attempt 1 (retry): success
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result).toEqual({ name: 'repaired', value: 10 })
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('2 parse hatası ardından maxRetries(2) → null döner', async () => {
    const openai = makeMockOpenAI([
      'broken 1',
      'broken 2',
      'broken 3',
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]', 2)
    expect(result).toBeNull()
    // maxRetries=2 → toplam 3 deneme (0, 1, 2)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('maxRetries=1 → sadece 2 deneme yapılır', async () => {
    const openai = makeMockOpenAI(['broken', 'still broken'])
    await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]', 1)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('maxRetries=0 → tek deneme, bozuksa null', async () => {
    const openai = makeMockOpenAI(['broken json'])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]', 0)
    expect(result).toBeNull()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — validation hatası → retry
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — validation hatası → retry', () => {
  it('1. deneme validation fail, 2. deneme geçer → değeri döner', async () => {
    const openai = makeMockOpenAI([
      '{"name":"ab","value":1}',            // attempt 0: parse OK, validation FAIL (name < 5)
      '{"name":"longname","value":1}',       // attempt 1: parse OK, validation OK
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, validIfNameLong, '[Test]')
    expect(result?.name).toBe('longname')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2)
  })

  it('tüm denemeler validation fail → null döner', async () => {
    const openai = makeMockOpenAI([
      '{"name":"hello","value":1}',
      '{"name":"world","value":2}',
      '{"name":"again","value":3}',
    ])
    // alwaysInvalid her zaman fail eder
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysInvalid, '[Test]', 2)
    expect(result).toBeNull()
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })

  it('validation issues retry prompt\'a dahil edilir — 2. çağrıda mesaj geçmişi büyümüş olmalı', async () => {
    const openai = makeMockOpenAI([
      '{"name":"ab","value":1}',
      '{"name":"longname","value":2}',
    ])
    await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, validIfNameLong, '[Test]')
    // İkinci çağrıda messages array daha uzun olmalı (retry prompt eklendi)
    const secondCallArgs = (openai.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[1][0] as { messages: unknown[] }
    expect(secondCallArgs.messages.length).toBeGreaterThan(BASE_PARAMS.messages.length)
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — boş yanıt → retry
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — boş yanıt → retry', () => {
  it('boş string yanıt → retry → başarılı', async () => {
    const openai = makeMockOpenAI([
      null,                              // attempt 0: content null → '' → boş
      '{"name":"afterempty","value":5}', // attempt 1: başarılı
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result?.name).toBe('afterempty')
  })

  it('sürekli boş yanıt → null döner', async () => {
    const openai = makeMockOpenAI([null, null, null])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]', 2)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — API hatası → retry
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — API hatası → retry', () => {
  it('API hatası ardından başarılı yanıt → değeri döner', async () => {
    const openai = makeMockOpenAI([
      new Error('Network error'),          // attempt 0: API throw
      '{"name":"recovered","value":9}',    // attempt 1: başarılı
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]')
    expect(result?.name).toBe('recovered')
  })

  it('tüm denemeler API hatası → null döner', async () => {
    const openai = makeMockOpenAI([
      new Error('timeout'),
      new Error('timeout'),
      new Error('timeout'),
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, alwaysValid, '[Test]', 2)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// callWithJsonRetry — karışık senaryo (parse fail → validation fail → başarı)
// ---------------------------------------------------------------------------

describe('callWithJsonRetry — karışık senaryo', () => {
  it('parse fail → validation fail → başarı (3 deneme)', async () => {
    const openai = makeMockOpenAI([
      '{ broken',                          // attempt 0: parse fail
      '{"name":"ab","value":1}',           // attempt 1: parse OK, validation FAIL
      '{"name":"longname","value":2}',      // attempt 2: parse OK, validation OK
    ])
    const result = await callWithJsonRetry<SimpleObj>(openai, BASE_PARAMS, validIfNameLong, '[Test]', 2)
    expect(result?.name).toBe('longname')
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3)
  })
})
