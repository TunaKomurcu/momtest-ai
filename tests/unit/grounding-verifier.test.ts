/**
 * Unit tests — lib/ai-guards/grounding-verifier.ts
 *
 * Kapsam:
 * - normalizeText: büyük/küçük harf, noktalama, fancy tırnak, fazladan boşluk
 * - quoteFoundInContent: tam eşleşme, hafif parafraze, uydurma alıntı, kısa alıntı
 * - verifyGrounding: tam eşleşen alıntı, hafif parafraze, eksik message_id,
 *   transkriptte olmayan alıntı, boş evidence, karışık senaryo
 * - issuesToWarnings: string format
 *
 * Sıfır LLM / DB bağımlılığı — tamamen pure fonksiyon testleri.
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  quoteFoundInContent,
  verifyGrounding,
  issuesToWarnings,
} from '@/lib/ai-guards/grounding-verifier'
import type { StructuredAnalysis } from '@/types/index'
import type { GroundingMessage } from '@/lib/ai-guards/grounding-verifier'

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeMessages(overrides: Partial<GroundingMessage>[] = []): GroundingMessage[] {
  const defaults: GroundingMessage[] = [
    { id: 'msg-001', content: 'Last month two clients paid me late and I had to chase them.' },
    { id: 'msg-002', content: 'I check my spreadsheet every Friday to track outstanding invoices.' },
    { id: 'msg-003', content: 'It happens maybe once a month, sometimes less.' },
    { id: 'msg-004', content: 'I would probably try it if it existed.' },
  ]
  return [...defaults, ...overrides.map((o, i) => ({ id: `msg-extra-${i}`, content: 'extra', ...o }))]
}

function makeAnalysis(overrides: Partial<StructuredAnalysis> = {}): StructuredAnalysis {
  return {
    decision: 'continue discovery',
    summary: 'Test summary.',
    signalScore: {
      problemEvidence: 'strong',
      urgency: 'medium',
      workaroundEvidence: 'strong',
      budgetOrCommitment: 'weak',
    },
    strongEvidence:   [],
    mediumEvidence:   [],
    weakEvidence:     [],
    negativeEvidence: [],
    openQuestions:    ['Next unknown?'],
    recommendedNextStep: 'Run 3 more interviews.',
    ...overrides,
  }
}

// ── normalizeText ─────────────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('büyük harfleri küçük harfe çevirir', () => {
    expect(normalizeText('Hello World')).toBe('hello world')
  })

  it('fazladan boşlukları tek boşluğa indirir', () => {
    expect(normalizeText('hello   world')).toBe('hello world')
  })

  it('başta ve sonda boşlukları kaldırır', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  it('fancy tırnakları düz tırnağa çevirir', () => {
    expect(normalizeText('\u201cHello\u201d')).toContain('hello')
  })

  it('em dash / en dash\'i kısa çizgiye çevirir', () => {
    const result = normalizeText('word\u2014another')
    expect(result).toContain('-')
  })

  it('noktalama işaretlerini kaldırır (tire ve tırnak hariç)', () => {
    const result = normalizeText('hello, world! how are you?')
    expect(result).not.toContain(',')
    expect(result).not.toContain('!')
    expect(result).not.toContain('?')
  })

  it('boş string → boş string döner', () => {
    expect(normalizeText('')).toBe('')
  })
})

// ── quoteFoundInContent ───────────────────────────────────────────────────────

describe('quoteFoundInContent', () => {
  it('tam eşleşen alıntı → true', () => {
    const content = 'Last month two clients paid me late and I had to chase them.'
    const quote   = 'Last month two clients paid me late and I had to chase them.'
    expect(quoteFoundInContent(quote, content)).toBe(true)
  })

  it('büyük/küçük harf farkı tolere edilir → true', () => {
    const content = 'Last month two clients paid me late.'
    const quote   = 'last month two clients paid me late'
    expect(quoteFoundInContent(quote, content)).toBe(true)
  })

  it('hafif parafraze — kelime örtüşmesi %70+ → true', () => {
    // LLM "two clients" yerine "a couple of clients" diyebilir ama ana kelimeler aynı
    const content = 'Last month two clients paid me late and I had to chase them for payment.'
    const quote   = 'last month clients paid late had to chase them'
    expect(quoteFoundInContent(quote, content)).toBe(true)
  })

  it('noktalama farkı tolere edilir → true', () => {
    const content = 'I check my spreadsheet every Friday.'
    const quote   = 'I check my spreadsheet every Friday'
    expect(quoteFoundInContent(quote, content)).toBe(true)
  })

  it('transkriptte hiç geçmeyen uydurma alıntı → false', () => {
    const content = 'I check my spreadsheet every Friday.'
    const quote   = 'I use an AI tool to send automated reminders every day.'
    expect(quoteFoundInContent(quote, content)).toBe(false)
  })

  it('çok kısa alıntı (< 3 anlamlı kelime) — partial match skip → false', () => {
    // 2 kelimeden oluşuyor, tam match da yok
    const content = 'I check my spreadsheet every Friday.'
    const quote   = 'pay later'
    expect(quoteFoundInContent(quote, content)).toBe(false)
  })

  it('alıntı content\'in bir alt kümesi — includes → true', () => {
    const content = 'It happens maybe once a month, sometimes less frequently than that.'
    const quote   = 'once a month'
    expect(quoteFoundInContent(quote, content)).toBe(true)
  })

  it('tek kelime örtüşmesi yüksek sayıda olsa da %70 altı → false', () => {
    const content = 'completely different topic about cooking recipes and food preparation methods'
    const quote   = 'invoice payment tracking spreadsheet reminder system'
    expect(quoteFoundInContent(quote, content)).toBe(false)
  })
})

// ── verifyGrounding — tam eşleşen alıntılar ──────────────────────────────────

describe('verifyGrounding — tam eşleşen alıntılar', () => {
  it('tüm alıntılar transkriptte var → boş issue listesi döner', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'Last month two clients paid me late and I had to chase them.', message_id: 'msg-001', whyItMatters: 'Specific past event.' },
        { quote: 'I check my spreadsheet every Friday to track outstanding invoices.', message_id: 'msg-002', whyItMatters: 'Recurring behavior.' },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(0)
  })

  it('boş evidence dizileri → boş issue listesi', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis()
    expect(verifyGrounding(analysis, messages)).toHaveLength(0)
  })
})

// ── verifyGrounding — hafif parafraze ────────────────────────────────────────

describe('verifyGrounding — hafif parafraze (fuzzy match)', () => {
  it('hafif parafraze edilmiş alıntı → sorun yok', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      mediumEvidence: [
        // LLM "maybe once a month" yerine "once a month sometimes" dedi
        { quote: 'once a month sometimes less', message_id: 'msg-003', context: 'Self-reported frequency.' },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(0)
  })

  it('büyük harf farkı olan alıntı → sorun yok', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'LAST MONTH TWO CLIENTS PAID ME LATE', message_id: 'msg-001', whyItMatters: 'Past event.' },
      ],
    })
    expect(verifyGrounding(analysis, messages)).toHaveLength(0)
  })
})

// ── verifyGrounding — eksik message_id ───────────────────────────────────────

describe('verifyGrounding — eksik message_id', () => {
  it('var olmayan message_id → missing_message_id issue döner', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'Some real quote.', message_id: 'msg-NONEXISTENT', whyItMatters: 'Test.' },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toBe('missing_message_id')
    expect(issues[0].message_id).toBe('msg-NONEXISTENT')
    expect(issues[0].category).toBe('strong')
  })

  it('boş message_id string → atlanır, issue üretilmez', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      negativeEvidence: [
        { quote: 'No recent example.', message_id: '', whyItIsNegative: 'Test.' },
      ],
    })
    // Boş message_id atlanmalı
    expect(verifyGrounding(analysis, messages)).toHaveLength(0)
  })
})

// ── verifyGrounding — uydurma alıntı ─────────────────────────────────────────

describe('verifyGrounding — transkriptte olmayan alıntı', () => {
  it('uydurma alıntı → quote_not_found issue döner', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        {
          quote: 'I already signed a contract with a vendor for this solution last week.',
          message_id: 'msg-001',  // message_id var ama quote o mesajda yok
          whyItMatters: 'Hallucinated commitment.',
        },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toBe('quote_not_found')
    expect(issues[0].category).toBe('strong')
    expect(issues[0].index).toBe(0)
  })

  it('birden fazla kategoride uydurma alıntı → tümü issue olarak döner', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        { quote: 'I paid $500 for this exact solution already.', message_id: 'msg-001', whyItMatters: 'Hallucinated spend.' },
      ],
      weakEvidence: [
        { quote: 'This product sounds absolutely perfect for my needs.', message_id: 'msg-004', whyItIsWeak: 'Hallucinated praise.' },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(2)
    const categories = issues.map(i => i.category)
    expect(categories).toContain('strong')
    expect(categories).toContain('weak')
  })
})

// ── verifyGrounding — karışık senaryo ────────────────────────────────────────

describe('verifyGrounding — karışık senaryo', () => {
  it('bazı alıntılar geçerli, bazıları değil → sadece sorunlular döner', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      strongEvidence: [
        // Geçerli
        { quote: 'I check my spreadsheet every Friday', message_id: 'msg-002', whyItMatters: 'Recurring.' },
        // Uydurma
        { quote: 'I hired a full-time assistant just for this task.', message_id: 'msg-003', whyItMatters: 'Hallucinated.' },
      ],
      mediumEvidence: [
        // Geçerli
        { quote: 'once a month', message_id: 'msg-003', context: 'Frequency.' },
        // Eksik ID
        { quote: 'Some quote.', message_id: 'msg-GHOST', context: 'Ghost ID.' },
      ],
    })

    const issues = verifyGrounding(analysis, messages)
    expect(issues).toHaveLength(2)

    const reasons = issues.map(i => i.reason)
    expect(reasons).toContain('quote_not_found')
    expect(reasons).toContain('missing_message_id')
  })

  it('issue objesi doğru alanları taşıyor', () => {
    const messages = makeMessages()
    const analysis = makeAnalysis({
      weakEvidence: [
        { quote: 'completely fabricated quote that does not exist anywhere', message_id: 'msg-004', whyItIsWeak: 'Test.' },
      ],
    })
    const issues = verifyGrounding(analysis, messages)
    expect(issues[0]).toMatchObject({
      category:   'weak',
      index:      0,
      reason:     'quote_not_found',
      message_id: 'msg-004',
    })
    expect(typeof issues[0].quote).toBe('string')
  })
})

// ── issuesToWarnings ──────────────────────────────────────────────────────────

describe('issuesToWarnings', () => {
  it('boş issue listesi → boş string dizisi', () => {
    expect(issuesToWarnings([])).toHaveLength(0)
  })

  it('missing_message_id issue → insan okunabilir string', () => {
    const warnings = issuesToWarnings([{
      category:   'strong',
      index:      0,
      quote:      'Some quote.',
      message_id: 'msg-GHOST',
      reason:     'missing_message_id',
    }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('[strong][0]')
    expect(warnings[0]).toContain('msg-GHOST')
    expect(warnings[0]).toContain('message_id bulunamadı')
  })

  it('quote_not_found issue → insan okunabilir string', () => {
    const warnings = issuesToWarnings([{
      category:   'medium',
      index:      2,
      quote:      'A fabricated quote that is very long and should be truncated.',
      message_id: 'msg-001',
      reason:     'quote_not_found',
    }])
    expect(warnings[0]).toContain('[medium][2]')
    expect(warnings[0]).toContain('doğrulanamadı')
    expect(warnings[0]).toContain('A fabricated quote')
  })

  it('uzun alıntı 80 karakterde kesilir', () => {
    const longQuote = 'a'.repeat(120)
    const warnings = issuesToWarnings([{
      category: 'negative', index: 0, quote: longQuote, message_id: 'msg-001', reason: 'quote_not_found',
    }])
    // quote slice(0, 80) → max 80 char + tırnak içinde
    const quoteInWarning = warnings[0].split('"')[1] ?? ''
    expect(quoteInWarning.length).toBeLessThanOrEqual(80)
  })

  it('birden fazla issue → her biri ayrı string', () => {
    const warnings = issuesToWarnings([
      { category: 'strong',   index: 0, quote: 'q1', message_id: 'id-1', reason: 'missing_message_id' },
      { category: 'negative', index: 1, quote: 'q2', message_id: 'id-2', reason: 'quote_not_found'    },
    ])
    expect(warnings).toHaveLength(2)
  })
})
