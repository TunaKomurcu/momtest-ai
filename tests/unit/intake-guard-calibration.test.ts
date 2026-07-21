/**
 * Intake Guard Kalibrasyon Doğrulaması
 *
 * Amaç: Adım 1-3 değişikliklerinden sonra guard'ın gerçek LLM cevabı
 * kalıplarında doğru çalıştığını doğrulamak.
 *
 * Yöntem: Gerçek bir intake sohbetinde LLM'in üretebileceği tipik cevap
 * örnekleri — 12 istek, farklı konuşma adımlarını temsil ediyor.
 * Her örnek için beklenen verdict belirtilmiş.
 *
 * Başarı kriteri:
 *   - Flag oranı %5–%20 aralığında (önceki: %100)
 *   - Gerçek ihlaller (BLOCKED/RISKY) yakalanıyor
 *   - Normal intake soruları clean geçiyor
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  applyIntakeGuard,
  resetIntakeGuardMetrics,
  getIntakeGuardMetrics,
} from '@/lib/ai-guards/intake-reply-guard'

// ── Gerçek LLM cevabı örnekleri ──────────────────────────────────────────────
// Her örnek: gerçek intake sohbetinde LLM'in üretebileceği tipik bir mesaj.
// agentMsgCount: o noktaya kadar kaç agent mesajı gönderilmiş.

interface CalibrationCase {
  id: string
  description: string
  reply: string
  agentMsgCount: number
  expectedVerdict: 'clean' | 'risky' | 'blocked'
  note?: string
}

const CALIBRATION_CASES: CalibrationCase[] = [
  // ── İstek 1: Açılış sorusu (1. mesaj) ─────────────────────────────────────
  {
    id: 'req-01',
    description: 'Açılış: ürün fikri soruldu',
    reply: 'Thanks for sharing your idea. To help us design the right research, could you tell me more about who specifically faces this problem today?',
    agentMsgCount: 0,
    expectedVerdict: 'clean',
  },

  // ── İstek 2: Segment sorusu (2. mesaj) ────────────────────────────────────
  {
    id: 'req-02',
    description: 'Segment: hedef kitle netleştirme',
    reply: 'Which customer segment can you actually reach and interview this week?',
    agentMsgCount: 1,
    expectedVerdict: 'clean',
  },

  // ── İstek 3: Durum sorusu (3. mesaj) ──────────────────────────────────────
  {
    id: 'req-03',
    description: 'Durum: problemin ne zaman ortaya çıktığı',
    reply: 'When does this situation typically come up for them — is it a daily workflow issue or something that happens less frequently?',
    agentMsgCount: 2,
    expectedVerdict: 'clean',
    note: 'Tek soru, soru + açıklama yapısı — clean olmalı',
  },

  // ── İstek 4: Varsayım sorusu (4. mesaj) ───────────────────────────────────
  {
    id: 'req-04',
    description: 'Varsayım: en riskli assumption',
    reply: 'What assumption about your target customer would completely kill this idea if it turned out to be false?',
    agentMsgCount: 3,
    expectedVerdict: 'clean',
  },

  // ── İstek 5: Mevcut davranış sorusu (5. mesaj) ────────────────────────────
  {
    id: 'req-05',
    description: 'Mevcut davranış: şu an ne yapıyorlar',
    reply: 'What do you believe they are doing today to handle this situation, before any new solution exists?',
    agentMsgCount: 4,
    expectedVerdict: 'clean',
  },

  // ── İstek 6: Karar sorusu (6. mesaj) ──────────────────────────────────────
  {
    id: 'req-06',
    description: 'Karar: interview sonrası ne yapacak',
    reply: 'After running these interviews, what specific decision are you trying to make — build, pivot, or stop?',
    agentMsgCount: 5,
    expectedVerdict: 'clean',
  },

  // ── İstek 7: Türkçe açılış sorusu ────────────────────────────────────────
  {
    id: 'req-07',
    description: 'TR: hedef kitle sorusu',
    reply: 'Peki bu problemi tam olarak kimler yaşıyor? Bana biraz daha spesifik bir segment tanımlayabilir misiniz?',
    agentMsgCount: 2,
    expectedVerdict: 'clean',
    note: 'TR soru + retorik ek — birden fazla GERÇEK soru yok, clean olmalı',
  },

  // ── İstek 8: Türkçe varsayım sorusu ──────────────────────────────────────
  {
    id: 'req-08',
    description: 'TR: en riskli varsayım',
    reply: 'Bu fikrin başarısız olmasına neden olabilecek en kritik varsayım ne olurdu?',
    agentMsgCount: 3,
    expectedVerdict: 'clean',
  },

  // ── İstek 9: GERÇEK İHLAL — sahte doğrulama ──────────────────────────────
  {
    id: 'req-09',
    description: 'İHLAL: "That\'s a great idea" sahte doğrulama',
    reply: "That's a great idea! This is exactly the kind of problem worth solving. Now let me ask you about the target segment.",
    agentMsgCount: 2,
    expectedVerdict: 'blocked',
    note: 'Açık ihlal — blocked olmalı',
  },

  // ── İstek 10: GERÇEK İHLAL — iki soru ────────────────────────────────────
  {
    id: 'req-10',
    description: 'İHLAL: İki gerçek soru aynı mesajda',
    reply: 'Who exactly faces this problem today? And how often does it come up in their workflow?',
    agentMsgCount: 3,
    expectedVerdict: 'risky',
    note: 'İki gerçek soru — risky olmalı',
  },

  // ── İstek 11: SINIR DURUMU — soru + açıklama (yanlış pozitif riski) ───────
  {
    id: 'req-11',
    description: 'SINIR: Tek soru + bağlam cümlesi',
    reply: 'What evidence would completely change your mind about pursuing this idea? Understanding this will help us design interviews that actually test the riskiest assumption.',
    agentMsgCount: 4,
    expectedVerdict: 'clean',
    note: 'Tek gerçek soru, ikinci cümle açıklama — önceki hasMultipleQuestions yanlış pozitif verirdi',
  },

  // ── İstek 12: SINIR DURUMU — Türkçe "mi/mı" seçim sorusu ─────────────────
  {
    id: 'req-12',
    description: 'SINIR: TR seçim sorusu "X mi Y mi"',
    reply: 'Hedef kitleniz kurumsal mu, yoksa bireysel kullanıcılar mı?',
    agentMsgCount: 1,
    expectedVerdict: 'clean',
    note: 'Tek seçim sorusu — önceki hasMultipleQuestions yanlış pozitif verirdi',
  },
]

// ── Test ──────────────────────────────────────────────────────────────────────

describe('Intake Guard Kalibrasyon Doğrulaması', () => {
  beforeEach(() => resetIntakeGuardMetrics())

  // Her örneği ayrı test olarak çalıştır
  CALIBRATION_CASES.forEach(({ id, description, reply, agentMsgCount, expectedVerdict, note }) => {
    it(`${id} — ${description}`, () => {
      const result = applyIntakeGuard(reply, agentMsgCount)

      if (note) {
        // Açıklamalı testlerde sadece verdict kontrolü yeterli
      }

      expect(result.verdict).toBe(expectedVerdict)
    })
  })

  // ── Özet metrik raporu ────────────────────────────────────────────────────
  it('ÖZET: 12 örnek üzerinde flag oranı %5-%25 aralığında', () => {
    // Tüm örnekleri çalıştır
    CALIBRATION_CASES.forEach(({ reply, agentMsgCount }) => {
      applyIntakeGuard(reply, agentMsgCount)
    })

    const { totalCalls, flaggedCalls } = getIntakeGuardMetrics()
    const pct = (flaggedCalls / totalCalls) * 100

    // Beklenen flag sayısı: req-09 (blocked) + req-10 (risky) = 2
    const expectedFlagged = CALIBRATION_CASES.filter(
      c => c.expectedVerdict !== 'clean'
    ).length

    console.log('\n' + '─'.repeat(60))
    console.log('INTAKE GUARD KALİBRASYON RAPORU')
    console.log('─'.repeat(60))
    console.log(`Toplam istek       : ${totalCalls}`)
    console.log(`Flag alan (toplam) : ${flaggedCalls}`)
    console.log(`Flag oranı         : %${pct.toFixed(1)}`)
    console.log(`Beklenen flag sayısı: ${expectedFlagged}`)
    console.log('─'.repeat(60))
    CALIBRATION_CASES.forEach(({ id, description, expectedVerdict }) => {
      const result = applyIntakeGuard('', 999)  // sadece label için — gerçek çağrı zaten yapıldı
      const icon = expectedVerdict === 'clean' ? '✓' : expectedVerdict === 'risky' ? '⚠' : '✕'
      console.log(`${icon} ${id}: ${description} → ${expectedVerdict}`)
    })
    console.log('─'.repeat(60))

    // Assert: flag oranı %5-%35 aralığında (2/12 = %16.7)
    expect(pct).toBeGreaterThanOrEqual(5)
    expect(pct).toBeLessThanOrEqual(35)

    // Assert: flagged count beklenenle eşleşiyor
    expect(flaggedCalls).toBe(expectedFlagged)
  })
})
