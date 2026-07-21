import OpenAI from 'openai'
import type { GuardResult, ReplyCheckResult } from '@/types/index'

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/**
 * Guard retry döngüsünün maksimum deneme sayısı.
 * İlk LLM çağrısı bu limite dahil değil — sadece retry sayısını sınırlar.
 * Sonsuz döngü riskini engeller.
 */
export const MAX_GUARD_RETRIES = 2

// ---------------------------------------------------------------------------
// Kural setleri
// ---------------------------------------------------------------------------

/**
 * BLOCKED kalıpları — Kesin ihlal, LLM check'e gerek yok.
 * AI'ın PM'i sahte biçimde doğrulaması veya PM'den onay istemesi.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Sahte doğrulama — PM'e "harika fikir" demek
  { pattern: /that'?s?\s+a?\s*great\s+idea/i,        reason: 'Sahte doğrulama: "great idea"' },
  { pattern: /this\s+sounds?\s+(like\s+a?\s*)?(great|amazing|wonderful|excellent|fantastic)\s+product/i, reason: 'Sahte doğrulama: ürünü övmek' },
  { pattern: /i\s+think\s+this\s+will\s+work/i,      reason: 'Sahte doğrulama: "this will work"' },
  { pattern: /users?\s+will\s+(love|enjoy|like)\s+this/i, reason: 'Sahte doğrulama: kullanıcı tahmini' },
  { pattern: /this\s+validates?\s+(your\s+)?assumption/i, reason: 'Sahte doğrulama: assumption doğrulama' },
  { pattern: /you\s+should\s+build\s+this/i,         reason: 'Sahte doğrulama: "you should build this"' },
  { pattern: /this\s+is\s+a?\s*(strong|great|solid|good)\s+idea/i, reason: 'Sahte doğrulama: fikri onaylamak' },
  { pattern: /the\s+market\s+(wants|needs)\s+this/i, reason: 'Sahte doğrulama: pazar tahmini' },
  { pattern: /kullanıcılar\s+bunu\s+(sever|beğenir)/i, reason: 'Sahte doğrulama (TR): kullanıcı tahmini' },
  { pattern: /bu\s+(harika|muhteşem|mükemmel)\s+(bir\s+)?(fikir|ürün)/i, reason: 'Sahte doğrulama (TR): fikri övmek' },

  // Rol kayması — PM'e katılımcı gibi davranmak
  { pattern: /would\s+you\s+use\s+this/i,            reason: 'Rol kayması: PM\'e "would you use this" sorusu' },
  { pattern: /do\s+you\s+like\s+this\s+idea/i,       reason: 'Rol kayması: PM\'den onay istemek' },
  { pattern: /is\s+this\s+(a\s+)?good\s+idea/i,      reason: 'Rol kayması: PM\'den görüş istemek' },
]

/**
 * RISKY kalıpları — Belirsiz, isolated LLM check gerekebilir.
 */
const RISKY_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /^i\s+think\s+/im,                      flag: 'AI görüş enjeksiyonu: I think' },
  { pattern: /^i\s+believe\s+/im,                    flag: 'AI görüş enjeksiyonu: I believe' },
  { pattern: /this\s+is\s+a?\s*(risky|strong)\s+assumption/i, flag: 'PM yönlendirme: assumption değerlendirmesi' },
  { pattern: /most\s+startups?\s+fail/i,              flag: 'Odaktan sapma: unsolicited advice' },
  { pattern: /bence\s+/i,                             flag: 'AI görüş enjeksiyonu TR: bence' },
  { pattern: /sanırım\s+/i,                           flag: 'AI görüş enjeksiyonu TR: sanırım' },
]

// ---------------------------------------------------------------------------
// Yardımcı kontroller
// ---------------------------------------------------------------------------

/** Erken <research_brief> teslimi — agent mesaj sayısı 3'ten azsa blocked */
function hasEarlyBriefDelivery(reply: string, agentMessageCount: number): boolean {
  return /<research_brief>/i.test(reply) && agentMessageCount < 3
}

/** Aşırı uzun cevap — 200 kelime üstü risky */
function isTooLong(reply: string): boolean {
  return reply.trim().split(/\s+/).length > 200
}

/** Birden fazla GERÇEK soru içeriyor mu — risky
 *
 * Basit `?` sayımı yerine semantik tespit:
 * 1. Metni `?` işaretine göre parçalara böl.
 * 2. Her parçada gerçek bir soru kalıbı olup olmadığını kontrol et:
 *    - İngilizce: 5W1H kelimeleri (who/what/when/where/why/how/which/whose/whom)
 *    - İngilizce yardımcı fiil başlangıcı (do/does/did/is/are/was/were/have/has/had/
 *                                           will/would/could/should/can/may/might/shall)
 *    - Türkçe: soru ekleri (-mı/-mi/-mu/-mü, -mıyı/-miyi, ne/neden/nasıl/kim/hangi/kaç)
 * 3. 2+ parçada gerçek soru kalıbı varsa → çok sorulu kabul et.
 *
 * Bu yaklaşım şunları yanlış pozitif saymaz:
 *   - "... değil mi?" — tek parça, tek soru
 *   - "X mi, Y mi?" — iki parça ama her ikisi de aynı sorunun devamı
 *     (sadece ikinci parça kısa ve soru kalıbı taşımıyorsa)
 *   - Retorik ifadeler: "Neden olmasın?" gibi tek cümle
 */
export function hasMultipleQuestions(reply: string): boolean {
  // ? işareti yoksa ya da sadece bir tane varsa kesinlikle tek soru
  const rawQuestionMarks = (reply.match(/\?/g) ?? []).length
  if (rawQuestionMarks < 2) return false

  // İngilizce 5W1H + yardımcı fiil başlangıcı kalıpları
  // Önceki bağlaçları (And/But/Or) atla
  const EN_QUESTION_START = /^\s*(?:and|but|or|so)?\s*(who|what|when|where|why|how|which|whose|whom|do|does|did|is|are|was|were|have|has|had|will|would|could|should|can|may|might|shall)\b/i

  // Türkçe soru kelimeleri — satır/segment içinde geçen
  const TR_QUESTION_WORD = /\b(ne\b|neden|nasıl|nerede|nereden|nereye|kim(ler?|in)?|hangi|kaç|kaçıncı|ne\s+zaman|ne\s+sıklıkla|ne\s+kadar)\b/i

  // Türkçe soru eki — segment + ? ile birlikte test et
  const TR_QUESTION_SUFFIX = /\b\w+(mı|mi|mu|mü|misin|mısın|musun|müsün|miyim|mıyım|muyum|müyüm|lar\s+mı|ler\s+mi)\s*\?/i

  // Parçalara böl — her ? işaretine kadar olan metin bir segment
  const segments = reply.split('?')
  // Son eleman ? ile bitmiyorsa içerik taşımıyor
  const questionSegments = segments.slice(0, -1)

  let realQuestionCount = 0

  for (const seg of questionSegments) {
    // Segmenti son cümleye indir — nokta/ünlem/noktalı virgül/yeni satırdan sonrasını al
    const lastSentence = (seg.split(/[.!;\n]/).pop() ?? seg).trim()

    const isReal =
      EN_QUESTION_START.test(lastSentence) ||
      TR_QUESTION_WORD.test(lastSentence) ||
      TR_QUESTION_SUFFIX.test(seg + '?')

    if (isReal) realQuestionCount++
  }

  return realQuestionCount >= 2
}

// ---------------------------------------------------------------------------
// Katman 1 — applyIntakeGuard
// ---------------------------------------------------------------------------

// ── In-memory metrik sayacı ──────────────────────────────────────────────────
// Geliştirme sürecinde flag oranını gözlemlemek için kullanılır.
// Kalıcı depolama gerektirmez — process yeniden başladığında sıfırlanır.

const LOG_INTERVAL = 10  // kaç çağrıda bir oranı logla

const _metrics = {
  totalCalls: 0,
  flaggedCalls: 0,  // blocked + risky
}

/**
 * Metrik sayacını sıfırlar.
 * Test ortamında test izolasyonu için kullanılır — production'da çağrılmamalı.
 */
export function resetIntakeGuardMetrics(): void {
  _metrics.totalCalls = 0
  _metrics.flaggedCalls = 0
}

/**
 * Mevcut metrik anlık görüntüsünü döndürür.
 * Test assertion'larında kullanılır.
 */
export function getIntakeGuardMetrics(): { totalCalls: number; flaggedCalls: number } {
  return { ..._metrics }
}

function recordMetric(verdict: 'clean' | 'blocked' | 'risky'): void {
  _metrics.totalCalls++
  if (verdict !== 'clean') _metrics.flaggedCalls++

  if (_metrics.totalCalls % LOG_INTERVAL === 0) {
    const pct = ((_metrics.flaggedCalls / _metrics.totalCalls) * 100).toFixed(1)
    console.log(
      `[Intake/guard] Flag rate: ${_metrics.flaggedCalls}/${_metrics.totalCalls} (%${pct})`
    )
  }
}

/**
 * PM intake sohbetinde AI'ın ürettiği cevabı kural tabanlı filtreden geçirir.
 * ~0ms — hiç LLM çağrısı yapmaz.
 *
 * @param reply             Kontrol edilecek agent cevabı
 * @param agentMessageCount Bu konuşmada şimdiye kadar gönderilmiş agent mesaj sayısı
 */
export function applyIntakeGuard(
  reply: string,
  agentMessageCount = 999
): GuardResult {
  // BLOCKED kontrolü
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(reply)) {
      recordMetric('blocked')
      return { verdict: 'blocked', reason }
    }
  }

  // Erken brief teslimi — blocked
  if (hasEarlyBriefDelivery(reply, agentMessageCount)) {
    recordMetric('blocked')
    return {
      verdict: 'blocked',
      reason: `Erken <research_brief> teslimi — sadece ${agentMessageCount} agent mesajı gönderilmiş, minimum 3 gerekli`,
    }
  }

  // RISKY kontrolleri
  const flags: string[] = []

  for (const { pattern, flag } of RISKY_PATTERNS) {
    if (pattern.test(reply)) flags.push(flag)
  }

  if (isTooLong(reply)) {
    flags.push('Cevap 200 kelime sınırını aşıyor — intake kısa ve odaklı olmalı (200 kelime)')
  }

  if (hasMultipleQuestions(reply)) {
    flags.push('Birden fazla soru içeriyor — tek soru kuralı ihlali riski (birden fazla soru)')
  }

  if (flags.length > 0) {
    recordMetric('risky')
    return { verdict: 'risky', flags, reason: flags[0] }
  }

  recordMetric('clean')
  return { verdict: 'clean' }
}

// ---------------------------------------------------------------------------
// Katman 2 — checkIntakeReplyIsolated
// ---------------------------------------------------------------------------

/**
 * Riskli bulunan intake cevabını, sıfır conversation history ile bağımsız
 * bir LLM context'inde değerlendirir. Objektifliği korumak için ana
 * konuşma geçmişi, interview script veya proje bağlamı gönderilmez.
 */
const INTAKE_CHECKER_PROMPT = `You are a Mom Test intake quality auditor.
You are evaluating a single message produced by a PM discovery architect AI.
You have NO conversation history — only this one message.

Evaluate against these rules:
1. Does it endorse, validate, or praise the PM's idea? (forbidden)
2. Does it ask the PM for their opinion or approval? (forbidden — PM is not a customer)
3. Does it contain more than one question? (forbidden — one question at a time)
4. Is it longer than 200 words? (risky — intake answers must be short and focused)
5. Does it inject the AI's personal opinion using "I think", "I believe"? (forbidden)

Respond ONLY with valid JSON, no prose, no markdown:
{ "verdict": "pass" | "fail", "reason": "brief explanation" }`

export async function checkIntakeReplyIsolated(
  reply: string,
  openai: OpenAI,
  modelName: string
): Promise<ReplyCheckResult> {
  try {
    const completion = await openai.chat.completions.create({
      model: modelName,
      temperature: 0.0,
      max_tokens: 120,
      messages: [
        { role: 'system', content: INTAKE_CHECKER_PROMPT },
        { role: 'user',   content: reply },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!raw) {
      console.warn('[IntakeGuard/checker] LLM boş yanıt döndürdü — pass kabul edildi')
      return { verdict: 'pass', reason: 'checker empty response — defaulting to pass' }
    }

    // JSON parse
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { verdict?: string; reason?: string }

    if (parsed.verdict !== 'pass' && parsed.verdict !== 'fail') {
      console.warn('[IntakeGuard/checker] Beklenmedik verdict değeri:', parsed.verdict)
      return { verdict: 'pass', reason: 'unexpected verdict — defaulting to pass' }
    }

    return {
      verdict: parsed.verdict,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch (err) {
    // Checker hatası ana akışı durdurmamalı — pass kabul et, logla
    console.error('[IntakeGuard/checker] LLM çağrısı başarısız, pass kabul edildi:', err)
    return { verdict: 'pass', reason: 'checker error — defaulting to pass' }
  }
}

// ---------------------------------------------------------------------------
// Fallback mesajı — guard engel olduğunda kullanılacak güvenli soru
// ---------------------------------------------------------------------------

/**
 * Guard retry'ları da başarısız olursa kullanılacak güvenli soru.
 * SKILL.md Skill 1 question bank'ten seçildi — her koşulda Mom Test uyumlu.
 */
export const INTAKE_FALLBACK_MESSAGE =
  'Who exactly experiences this problem, and when does it typically come up?'
