/**
 * Interview Guard Kalibrasyon Doğrulaması
 *
 * Amaç: Adım 3 değişikliklerinden sonra guard'ın gerçek interview cevabı
 * kalıplarında doğru çalıştığını doğrulamak.
 *
 * intake-guard-calibration.test.ts ile AYNI format.
 *
 * 12 örnek: yönlendirici/hipotetik soru ihlalleri + normal Mom Test sorular.
 * Başarı kriteri: flag oranı %5–%30 (2-3 gerçek ihlal / 12 toplam).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  applyInterviewGuard,
  resetInterviewGuardMetrics,
  getInterviewGuardMetrics,
} from '@/lib/ai-guards/interview-reply-guard'

// ── Kalibrasyon örnekleri ─────────────────────────────────────────────────────

interface CalibrationCase {
  id: string
  description: string
  reply: string
  expectedVerdict: 'clean' | 'risky' | 'blocked'
  note?: string
}

const CALIBRATION_CASES: CalibrationCase[] = [
  // ── Normal Mom Test soruları (clean bekleniyor) ───────────────────────────

  {
    id: 'req-01',
    description: 'Geçmiş davranış: son kez ne oldu',
    reply: 'Can you tell me about the last time this happened?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-02',
    description: 'İş akışı walkthrough',
    reply: 'Walk me through how you handle this today.',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-03',
    description: 'Mevcut araç sorusu',
    reply: 'What tools are you currently using to manage this?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-04',
    description: 'Geçici çözüm sorusu',
    reply: 'How are you dealing with this right now, before any new solution?',
    expectedVerdict: 'clean',
    note: 'Tek soru + açıklama cümlesi — yanlış pozitif olmamalı',
  },
  {
    id: 'req-05',
    description: 'Maliyet/zaman sorusu',
    reply: 'How long does it typically take you each time this comes up?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-06',
    description: 'Frekans sorusu',
    reply: 'How often does this situation come up in your workflow?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-07',
    description: 'TR: geçmiş davranış',
    reply: 'Bunu en son ne zaman yaşadınız?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-08',
    description: 'TR: mevcut çözüm',
    reply: 'Şu an bunu nasıl çözüyorsunuz?',
    expectedVerdict: 'clean',
  },
  {
    id: 'req-09',
    description: 'Kapanış sorusu Mom Test',
    reply: 'Who else should I talk to who might have this problem?',
    expectedVerdict: 'clean',
  },

  // ── Gerçek ihlaller ───────────────────────────────────────────────────────

  {
    id: 'req-10',
    description: 'İHLAL: "Would you use this?" yasaklı soru',
    reply: 'Would you use something like this in your daily workflow?',
    expectedVerdict: 'blocked',
    note: 'Açık ihlal — blocked olmalı',
  },
  {
    id: 'req-11',
    description: 'İHLAL: Hipotetik soru "if this existed"',
    reply: 'If this existed, would it solve the problem for you?',
    expectedVerdict: 'blocked',
    note: '"if this existed" + "would" kombinasyonu — blocked',
  },
  {
    id: 'req-12',
    description: 'İHLAL: "do you think you\'d" yarı-yönlendirici',
    reply: 'Do you think you\'d pay for something that solved this automatically?',
    expectedVerdict: 'blocked',
    note: '"do you think you\'d" kalıbı — blocked',
  },
]

// ── Testler ───────────────────────────────────────────────────────────────────

describe('Interview Guard Kalibrasyon Doğrulaması', () => {
  beforeEach(() => resetInterviewGuardMetrics())

  CALIBRATION_CASES.forEach(({ id, description, reply, expectedVerdict }) => {
    it(`${id} — ${description}`, () => {
      const result = applyInterviewGuard(reply)
      expect(result.verdict).toBe(expectedVerdict)
    })
  })

  // ── Özet metrik raporu ────────────────────────────────────────────────────
  it('ÖZET: 12 örnek üzerinde flag oranı %5–%35 aralığında', () => {
    CALIBRATION_CASES.forEach(({ reply }) => applyInterviewGuard(reply))

    const { totalCalls, flaggedCalls } = getInterviewGuardMetrics()
    const pct = (flaggedCalls / totalCalls) * 100

    const expectedFlagged = CALIBRATION_CASES.filter(
      c => c.expectedVerdict !== 'clean'
    ).length

    console.log('\n' + '─'.repeat(60))
    console.log('INTERVIEW GUARD KALİBRASYON RAPORU')
    console.log('─'.repeat(60))
    console.log(`Toplam istek        : ${totalCalls}`)
    console.log(`Flag alan (toplam)  : ${flaggedCalls}`)
    console.log(`Flag oranı          : %${pct.toFixed(1)}`)
    console.log(`Beklenen flag sayısı: ${expectedFlagged}`)
    console.log('─'.repeat(60))
    CALIBRATION_CASES.forEach(({ id, description, expectedVerdict }) => {
      const icon = expectedVerdict === 'clean' ? '✓' : expectedVerdict === 'risky' ? '⚠' : '✕'
      console.log(`${icon} ${id}: ${description} → ${expectedVerdict}`)
    })
    console.log('─'.repeat(60))

    expect(pct).toBeGreaterThanOrEqual(5)
    expect(pct).toBeLessThanOrEqual(35)
    expect(flaggedCalls).toBe(expectedFlagged)
  })
})
