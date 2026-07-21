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

/** Birden fazla soru içeriyor mu — risky */
function hasMultipleQuestions(reply: string): boolean {
  return (reply.match(/\?/g) ?? []).length > 1
}

// ---------------------------------------------------------------------------
// Katman 1 — applyIntakeGuard
// ---------------------------------------------------------------------------

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
      return { verdict: 'blocked', reason }
    }
  }

  // Erken brief teslimi — blocked
  if (hasEarlyBriefDelivery(reply, agentMessageCount)) {
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
    return { verdict: 'risky', flags, reason: flags[0] }
  }

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
