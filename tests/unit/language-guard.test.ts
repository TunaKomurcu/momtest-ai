/**
 * Unit tests — lib/ai-guards/language-guard.ts
 *
 * Kapsam:
 * - detectLanguage: TR/EN heuristic, kısa/belirsiz metinlerde null
 * - resolveSessionLanguage: ilk katılımcı mesajından dil kilitleme, drift önleme
 * - matchesExpectedLanguage: uyum/uyumsuzluk, belirsizlikte "geçti" davranışı
 */

import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  resolveSessionLanguage,
  matchesExpectedLanguage,
} from '@/lib/ai-guards/language-guard'
import type { ConversationMessage } from '@/types/index'

// ── detectLanguage ───────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('Türkçe cümle → tr', () => {
    expect(detectLanguage('Bunu en son ne zaman yaşadınız?')).toBe('tr')
  })

  it('İngilizce cümle → en', () => {
    expect(detectLanguage('Can you tell me about the last time this happened?')).toBe('en')
  })

  it('Türkçe özel karakter içeren kısa cümle → tr', () => {
    expect(detectLanguage('Bu süreci nasıl yönetiyorsunuz?')).toBe('tr')
  })

  it('çok kısa metin ("ok") → null (belirsiz)', () => {
    expect(detectLanguage('ok')).toBeNull()
  })

  it('sadece sayı → null (belirsiz)', () => {
    expect(detectLanguage('42')).toBeNull()
  })

  it('boş string → null', () => {
    expect(detectLanguage('')).toBeNull()
  })

  it('TR ve EN işareti olmayan nötr metin → null', () => {
    expect(detectLanguage('Excel spreadsheet')).toBeNull()
  })

  // ── Regresyon: eşit skor / Türkçe karakter önceliği ────────────────────────
  // Production'da bir PM'in Türkçe mesajı, TR ve EN marker skorları eşit
  // çıktığında yanlışlıkla 'en' olarak kilitleniyordu — bu da guard fallback'inin
  // (aktif oturum Türkçe olsa bile) İngilizce dönmesine yol açan kök nedendi.

  it('eşit TR/EN marker skorunda TR tercih edilir (regresyon)', () => {
    // "bir" → 1 TR puanı, "you" → 1 EN puanı — tam eşitlik, Türkçe karakter yok.
    expect(detectLanguage('bir you')).toBe('tr')
  })

  it('Türkçe karakter varsa EN skor daha yüksek olsa bile → tr (regresyon)', () => {
    // "you", "are", "how" → 3 EN marker eşleşmesi; "çalışıyor" sadece özel
    // karakteri (ç) taşıyor, kelime listesinde yok. Fix öncesi enScore(3) >
    // trScore(1) olduğu için yanlışlıkla 'en' dönerdi.
    expect(detectLanguage('you are how çalışıyor')).toBe('tr')
  })
})

// ── resolveSessionLanguage ───────────────────────────────────────────────────

describe('resolveSessionLanguage', () => {
  it('boş history → mevcut mesajdan tespit eder (tr)', () => {
    expect(resolveSessionLanguage([], 'Bu konuda yardımcı olabilir misiniz?')).toBe('tr')
  })

  it('boş history → mevcut mesajdan tespit eder (en)', () => {
    expect(resolveSessionLanguage([], 'Can you help me with this?')).toBe('en')
  })

  it('ilk katılımcı mesajı TR ise, sonraki kısa/belirsiz mesaj dili değiştirmez', () => {
    const history: ConversationMessage[] = [
      { sender: 'agent', content: 'Thanks for taking the time...' },
      { sender: 'participant', content: 'Genelde haftada bir kere oluyor.' },
      { sender: 'agent', content: 'Bu süreci nasıl takip ediyorsunuz?' },
    ]
    // Katılımcının şu anki mesajı kısa ve İngilizce görünse bile (örn. "ok"),
    // ilk mesajdan kilitlenen dil (tr) korunur.
    expect(resolveSessionLanguage(history, 'ok')).toBe('tr')
  })

  it('ilk katılımcı mesajı EN ise, dil oturum boyunca kilitli kalır', () => {
    const history: ConversationMessage[] = [
      { sender: 'agent', content: 'Opening frame...' },
      { sender: 'participant', content: 'We usually track this in a spreadsheet.' },
    ]
    expect(resolveSessionLanguage(history, 'tamam')).toBe('en')
  })

  it('history\'de katılımcı mesajı yok → mevcut mesaj kullanılır', () => {
    const history: ConversationMessage[] = [
      { sender: 'agent', content: 'Opening frame...' },
    ]
    expect(resolveSessionLanguage(history, 'Bunu her hafta yaşıyoruz.')).toBe('tr')
  })

  it('tespit tamamen belirsizse → varsayılan olarak en', () => {
    expect(resolveSessionLanguage([], 'ok')).toBe('en')
  })
})

// ── matchesExpectedLanguage ──────────────────────────────────────────────────

describe('matchesExpectedLanguage', () => {
  it('TR beklenirken TR cevap → true', () => {
    expect(matchesExpectedLanguage('Bunu en son ne zaman yaşadınız?', 'tr')).toBe(true)
  })

  it('TR beklenirken EN cevap → false (drift tespit edildi)', () => {
    expect(matchesExpectedLanguage('Can you tell me about the last time this happened?', 'tr')).toBe(false)
  })

  it('EN beklenirken TR cevap → false (drift tespit edildi)', () => {
    expect(matchesExpectedLanguage('Bunu en son ne zaman yaşadınız?', 'en')).toBe(false)
  })

  it('EN beklenirken EN cevap → true', () => {
    expect(matchesExpectedLanguage('Walk me through how you handle this today.', 'en')).toBe(true)
  })

  it('belirsiz kısa cevap → true (false-positive önlenir)', () => {
    expect(matchesExpectedLanguage('Tamam.', 'en')).toBe(true)
  })
})
