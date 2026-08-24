import type { ConversationMessage, InterviewLanguage } from '@/types/index'

// ---------------------------------------------------------------------------
// Heuristic dil tespiti — deterministik, ~0ms, LLM çağrısı yok.
// Amaç: LLM'in kendi dil algısına güvenmek yerine, katılımcının gerçek
// mesajından dili kod tarafında sabitlemek ve LLM'e talimat olarak vermek.
// ---------------------------------------------------------------------------

const TR_MARKERS: RegExp[] = [
  /\bve\b/i, /\bbu\b/i, /\bşu\b/i, /\bbir\b/i, /\biçin\b/i, /\bile\b/i,
  /\bnasıl\b/i, /\bneden\b/i, /\bne\s+zaman\b/i, /\bnerede\b/i, /\bkim\b/i,
  /\bçok\b/i, /\bgibi\b/i, /\bolarak\b/i, /\bsiz(in)?\b/i, /\bmisiniz\b/i,
  /\bmısınız\b/i, /\bdeğil\b/i, /\byapıyorsunuz\b/i, /\bevet\b/i, /\bhayır\b/i,
  /[çğıöşüÇĞİÖŞÜ]/,
]

const EN_MARKERS: RegExp[] = [
  /\bthe\b/i, /\bis\b/i, /\bare\b/i, /\byou\b/i, /\bthis\b/i, /\bwhat\b/i,
  /\bhow\b/i, /\bwhy\b/i, /\bwhen\b/i, /\bwhere\b/i, /\bwho\b/i, /\bwith\b/i,
  /\bfor\b/i, /\bthat\b/i, /\bdo\b/i, /\bdid\b/i, /\bcan\b/i, /\bcould\b/i,
]

function score(text: string, markers: RegExp[]): number {
  return markers.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)
}

/**
 * Metnin TR mi EN mi olduğunu heuristic olarak tahmin eder.
 * Çok kısa veya belirsiz metinlerde (örn. "ok", "42") null döner —
 * false-positive dil değişimini önlemek için çağıran taraf bunu "geçti" saymalı.
 */
export function detectLanguage(text: string): InterviewLanguage | null {
  const trimmed = text.trim()
  if (trimmed.length < 3) return null

  const trScore = score(trimmed, TR_MARKERS)
  const enScore = score(trimmed, EN_MARKERS)

  if (trScore === 0 && enScore === 0) return null
  if (trScore > enScore) return 'tr'
  if (enScore > trScore) return 'en'
  return null
}

/**
 * Mülakatın dilini katılımcının İLK mesajından kilitler.
 * Sonraki kısa/belirsiz cevaplar ("ok", "tamam", "evet") dil değişimine yol açmaz —
 * bu, "strictly avoid language drift" gereksinimini karşılayan ana mekanizmadır.
 */
export function resolveSessionLanguage(
  history: ConversationMessage[],
  currentUserMessage: string
): InterviewLanguage {
  const firstParticipantMessage = history.find((m) => m.sender === 'participant')?.content
  const anchorText = firstParticipantMessage ?? currentUserMessage
  return detectLanguage(anchorText) ?? 'en'
}

/**
 * Üretilen cevabın beklenen dilde olup olmadığını kontrol eder.
 * Tespit belirsizse (kısa mesaj, karışık içerik) false-positive'i önlemek için
 * true (geçti) döner — guard bu durumda retry tetiklemez.
 */
export function matchesExpectedLanguage(reply: string, expected: InterviewLanguage): boolean {
  const detected = detectLanguage(reply)
  if (detected === null) return true
  return detected === expected
}
