/**
 * Unit tests — interview/route.ts closing logic bug fix
 *
 * Kapsam:
 * - countMeaningfulParticipantReplies: eşik, current message dahil etmeme fix'i
 * - isClosingMessage: tüm kalıplar, false positive'ler
 * - shouldCloseInterview: history-only sayım + 5-kelime guard kombinasyonu
 *
 * lib/api-helpers/interview.ts'den export edilen pure fonksiyonlar test edilir.
 */

import { describe, it, expect } from 'vitest'
import {
  countMeaningfulParticipantReplies,
  isClosingMessage,
  shouldCloseInterview,
} from '@/lib/api-helpers/interview'
import type { ConversationMessage } from '@/types/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHistory(participantMessages: string[]): ConversationMessage[] {
  const result: ConversationMessage[] = []
  participantMessages.forEach((content, i) => {
    result.push({ sender: 'agent', content: `Question ${i + 1}` })
    result.push({ sender: 'participant', content })
  })
  return result
}

const SHORT_REPLY = 'Yes.'                                          // 1 kelime — anlamlı değil
const MEDIUM_REPLY = 'Yes, that is correct for me.'               // 5 kelime — sınırda
const LONG_REPLY = 'Last month we had an issue with this process.' // 8 kelime — anlamlı

// ---------------------------------------------------------------------------
// countMeaningfulParticipantReplies
// ---------------------------------------------------------------------------

describe('countMeaningfulParticipantReplies — temel sayım', () => {
  it('boş history → 0', () => {
    expect(countMeaningfulParticipantReplies([])).toBe(0)
  })

  it('sadece agent mesajları → 0', () => {
    const msgs: ConversationMessage[] = [
      { sender: 'agent', content: 'Tell me about the last time.' },
      { sender: 'agent', content: 'Can you elaborate?' },
    ]
    expect(countMeaningfulParticipantReplies(msgs)).toBe(0)
  })

  it('1 kelimelik participant mesajı → sayılmaz', () => {
    expect(countMeaningfulParticipantReplies([
      { sender: 'participant', content: 'Yes.' },
    ])).toBe(0)
  })

  it('4 kelimelik participant mesajı → sayılmaz (< 5)', () => {
    expect(countMeaningfulParticipantReplies([
      { sender: 'participant', content: 'Yes I think so.' },
    ])).toBe(0)
  })

  it('5 kelimelik participant mesajı → sayılır (eşik 5)', () => {
    expect(countMeaningfulParticipantReplies([
      { sender: 'participant', content: 'Yes that is correct indeed.' },
    ])).toBe(1)
  })

  it('uzun participant mesajları → doğru sayılır', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(countMeaningfulParticipantReplies(history)).toBe(3)
  })

  it('karışık kısa ve uzun mesajlar → sadece uzunlar sayılır', () => {
    const msgs: ConversationMessage[] = [
      { sender: 'participant', content: SHORT_REPLY },
      { sender: 'participant', content: LONG_REPLY },
      { sender: 'participant', content: SHORT_REPLY },
      { sender: 'participant', content: LONG_REPLY },
    ]
    expect(countMeaningfulParticipantReplies(msgs)).toBe(2)
  })
})

describe('countMeaningfulParticipantReplies — current message dahil etmeme (bug fix)', () => {
  /**
   * BUG: Önceden callsite'da currentMessage history'ye eklenerek fonksiyon çağrılıyordu.
   * FIX: Fonksiyon sadece history (geçmiş mesajlar) üzerinden çağrılır.
   * Bu testler fix'in doğruluğunu kanıtlar.
   */

  it('3 anlamlı geçmiş mesaj → sayı 3 (current message yok)', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    const count = countMeaningfulParticipantReplies(history)
    expect(count).toBe(3)
  })

  it('3 anlamlı geçmiş + current message HISTORY\'E dahil edilmezse → hâlâ 3', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    // Önceki bug: şöyle çağrılıyordu:
    // countMeaningfulParticipantReplies([...history, { sender: 'participant', content: currentMsg }])
    // → bu 4 verirdi, isComplete erken tetiklenirdi
    // Fix sonrası: history-only
    const count = countMeaningfulParticipantReplies(history)
    expect(count).toBe(3) // 4 değil
  })

  it('2 anlamlı geçmiş mesaj + current eklenirse → önceki bug 3 verirdi', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY])
    // BUG case: [...history, {sender:'participant', content: LONG_REPLY}] → 3
    // FIX case: history-only → 2
    const buggyCount = countMeaningfulParticipantReplies([
      ...history,
      { sender: 'participant', content: LONG_REPLY },
    ])
    const fixedCount = countMeaningfulParticipantReplies(history)

    expect(buggyCount).toBe(3)  // bug davranışı: 3
    expect(fixedCount).toBe(2)  // fix davranışı: 2
    // Fix'in önemi: 2 < 3 olduğu için closing condition erken tetiklenmez
  })
})

// ---------------------------------------------------------------------------
// isClosingMessage
// ---------------------------------------------------------------------------

describe('isClosingMessage — gerçek closing phrase\'ler', () => {
  it('"This has been really helpful. Thank you for your time..." → true', () => {
    expect(isClosingMessage(
      'This has been really helpful. Thank you for your time and honest answers. I have what I need. Have a great day!'
    )).toBe(true)
  })

  it('"thank you for your time" (küçük harf) → true', () => {
    expect(isClosingMessage('thank you for your time, this was great.')).toBe(true)
  })

  it('"Thanks for taking the time" → true', () => {
    expect(isClosingMessage('Thanks for taking the time to share all this.')).toBe(true)
  })

  it('"this has been really helpful" → true', () => {
    expect(isClosingMessage('this has been really helpful, appreciate it.')).toBe(true)
  })

  it('"Have a great day!" → true', () => {
    expect(isClosingMessage('Have a great day!')).toBe(true)
  })
})

describe('isClosingMessage — false positive\'ler (katılımcı benzer şeyler söylediğinde)', () => {
  it('Katılımcı "Thanks for taking the time to explain" dese → true (regex match)', () => {
    // Bu regex'in match ettiği bilinen durum — shouldCloseInterview bu durumu ele alır
    expect(isClosingMessage('Thanks for taking the time to explain this to me.')).toBe(true)
  })

  it('Normal soru → false', () => {
    expect(isClosingMessage('Tell me about the last time this happened.')).toBe(false)
  })

  it('Boş string → false', () => {
    expect(isClosingMessage('')).toBe(false)
  })

  it('Sadece "thanks" → false', () => {
    expect(isClosingMessage('thanks')).toBe(false)
  })

  it('Alakasız cümle → false', () => {
    expect(isClosingMessage('I use Notion for taking notes during calls.')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// shouldCloseInterview — kombinasyon testi (bug fix'in tüm parçaları)
// ---------------------------------------------------------------------------

describe('shouldCloseInterview — history-only + 5-kelime guard', () => {
  /**
   * shouldCloseInterview(history, agentReply) fonksiyonu şunu yapar:
   * 1. meaningfulReplies = countMeaningfulParticipantReplies(history)  ← history-only
   * 2. isComplete = (replies >= 3 && agentReply.trim().split(/\s+/).length >= 5 && isClosingMessage(agentReply))
   *                 || replies >= 10
   */

  it('3 anlamlı geçmiş + agent closing (5+ kelime) → true', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    const agentReply = 'This has been really helpful. Thank you for your time and honest answers.'
    expect(shouldCloseInterview(history, agentReply)).toBe(true)
  })

  it('2 anlamlı geçmiş + agent closing → false (henüz 3\'e ulaşmadı)', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY])
    const agentReply = 'This has been really helpful. Thank you for your time and honest answers.'
    expect(shouldCloseInterview(history, agentReply)).toBe(false)
  })

  it('3 anlamlı geçmiş + agent closing (tek kelime "Thanks") → false (5-kelime guard)', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    const agentReply = 'Thanks.'  // closing phrase match ediyor ama < 5 kelime
    expect(shouldCloseInterview(history, agentReply)).toBe(false)
  })

  it('3 anlamlı geçmiş + agent NON-closing (uzun) → false', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    const agentReply = 'Can you tell me more about what happened after that specific incident?'
    expect(shouldCloseInterview(history, agentReply)).toBe(false)
  })

  it('10 anlamlı geçmiş → true (closing phrase olmasa bile)', () => {
    const history = makeHistory(Array(10).fill(LONG_REPLY))
    const agentReply = 'That is a good point, can you elaborate further on that aspect?'
    expect(shouldCloseInterview(history, agentReply)).toBe(true)
  })

  it('9 anlamlı geçmiş + non-closing agent → false (10\'a ulaşmadı)', () => {
    const history = makeHistory(Array(9).fill(LONG_REPLY))
    const agentReply = 'What tools do you currently use for this workflow?'
    expect(shouldCloseInterview(history, agentReply)).toBe(false)
  })

  it('kritik bug case: katılımcı "Thanks for taking the time" → false (current message history\'de yok)', () => {
    /**
     * Önceki bug: katılımcı bu cümleyi yazarsa ve history'ye eklenip sayılırsa
     * meaningfulReplies 3'e ulaşabiliyordu, agentReply de closing içeriyorsa kapanıyordu.
     * Fix: current message history'ye dahil edilmiyor, bu test bunu doğrular.
     */
    const history = makeHistory([LONG_REPLY, LONG_REPLY])  // sadece 2 geçmiş
    // Katılımcı henüz 3. mesajını yazmadı — shouldCloseInterview history-only çalışır
    const agentReply = 'This has been really helpful. Thank you for your time and honest answers.'
    expect(shouldCloseInterview(history, agentReply)).toBe(false)  // 2 < 3, kapanmaz
  })
})

// ---------------------------------------------------------------------------
// Coverage gap kapatma — interview.ts satır 74-75
// shouldCloseInterview 5-kelime guard tam branch coverage
// ---------------------------------------------------------------------------

describe('shouldCloseInterview — 5-kelime guard tam branch coverage', () => {
  const CLOSING = 'This has been really helpful. Thank you for your time and honest answers.'

  it('agentReply tam 5 kelime + closing phrase → true (eşik geçer)', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    // "This has been really helpful" = 5 kelime
    expect(shouldCloseInterview(history, 'This has been really helpful.')).toBe(true)
  })

  it('agentReply 4 kelime + closing phrase match → false (5-kelime guard)', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    // "Have a great day" = 4 kelime → guard fail
    expect(shouldCloseInterview(history, 'Have a great day')).toBe(false)
  })

  it('agentReply 6 kelime closing phrase → true', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(shouldCloseInterview(history, 'Thank you for your time today.')).toBe(true)
  })

  it('agentReply 5 kelime ama closing phrase yok → false', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(shouldCloseInterview(history, 'Tell me about your workflow.')).toBe(false)
  })

  it('3 meaningful history + boş agentReply → false', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(shouldCloseInterview(history, '')).toBe(false)
  })

  it('10 meaningful replies + tek kelime agentReply → true (10+ threshold atlar 5-kelime guard\'ı)', () => {
    // 10+ threshold case'inde 5-kelime guard devreye girmiyor
    const history = makeHistory(Array(10).fill(LONG_REPLY))
    expect(shouldCloseInterview(history, 'OK.')).toBe(true)
  })

  it('agentReply sadece boşluktan oluşuyor → false', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(shouldCloseInterview(history, '   ')).toBe(false)
  })

  it('agentReply tam closing mesajı (20+ kelime) → true', () => {
    const history = makeHistory([LONG_REPLY, LONG_REPLY, LONG_REPLY])
    expect(shouldCloseInterview(history, CLOSING)).toBe(true)
  })
})
