import OpenAI from 'openai'
import type { GuardResult, ReplyCheckResult } from '@/types/index'

// ---------------------------------------------------------------------------
// Sabitler — Kural setleri
// ---------------------------------------------------------------------------

/**
 * BLOCKED kalıpları — Kesin ihlal.
 * SKILL.md Skill 5 + Skill 3 "Banned patterns" bölümünden türetildi.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Ürünü/çözümü ifşa etmek veya satmak
  { pattern: /\bour\s+(product|app|tool|solution|platform)\b/i,         reason: 'Ürün ifşası: "our product/app/tool"' },
  { pattern: /\bwhat\s+we'?re?\s+building\b/i,                          reason: 'Ürün ifşası: "what we\'re building"' },
  { pattern: /\bthe\s+(app|tool|solution|product)\s+(would|can|will|helps?)\b/i, reason: 'Ürün tanıtımı: çözümü anlatmak' },
  { pattern: /\bi\s+think\s+you\s+(would\s+)?benefit\s+from\b/i,        reason: 'Ürün satışı: katılımcıya fayda önermek' },

  // Görüş / onay alma — SKILL.md Skill 3 yasaklı kalıplar
  { pattern: /\bwould\s+you\s+use\s+(this|it|something\s+like\s+this)\b/i, reason: 'Yasaklı soru: "Would you use this?"' },
  { pattern: /\bwould\s+you\s+(pay|buy)\s+(for\s+)?(this|it)\b/i,       reason: 'Yasaklı soru: "Would you pay/buy?"' },
  { pattern: /\bhow\s+much\s+would\s+you\s+pay\b/i,                     reason: 'Yasaklı soru: "How much would you pay?"' },
  { pattern: /\bdo\s+you\s+(like|enjoy)\s+this(\s+idea)?\b/i,           reason: 'Yasaklı soru: "Do you like this?"' },
  { pattern: /\bis\s+this\s+(a\s+)?(good\s+|interesting\s+)?idea\b/i,   reason: 'Yasaklı soru: "Is this a good idea?"' },
  { pattern: /\bis\s+this\s+interesting\s+to\s+you\b/i,                 reason: 'Yasaklı soru: "Is this interesting to you?"' },
  { pattern: /\bshould\s+we\s+build\s+this\b/i,                         reason: 'Yasaklı soru: "Should we build this?"' },
  { pattern: /\bcould\s+you\s+imagine\s+using\s+this\b/i,               reason: 'Yasaklı soru: "Could you imagine using this?"' },
  { pattern: /\bwould\s+this\s+be\s+useful\b/i,                         reason: 'Yasaklı soru: "Would this be useful?"' },
  { pattern: /\bwhat\s+features?\s+do\s+you\s+want\b/i,                 reason: 'Yasaklı soru: özellik listesi istemek' },
  { pattern: /\bdo\s+you\s+think\s+(this\s+is|it\s+is|it'?s?)\s+(a\s+)?(good\s+)?idea\b/i, reason: 'Yasaklı soru: "Do you think this is a good idea?"' },

  // Gelecek niyet — "Would you..." ile başlayan herhangi bir soru
  { pattern: /^would\s+you\b/im,                                         reason: 'Gelecek niyet sorusu: "Would you..." ile başlayan soru' },
]

/**
 * RISKY kalıpları — Belirsiz, isolated LLM check gerekebilir.
 */
const RISKY_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  // Aşırı onaylama — katılımcıyı yönlendirme riski
  { pattern: /\b(that'?s?|how)\s+(great|amazing|wonderful|fantastic|interesting|excellent|perfect)\b/i, flag: 'Aşırı onaylama katılımcıyı yönlendirme riski' },
  { pattern: /\bwow\b/i,                                                flag: 'Aşırı onaylama wow' },

  // AI kendi yorumunu enjekte ediyor
  { pattern: /\bi\s+think\b/i,                                          flag: 'AI görüş enjeksiyonu I think' },
  { pattern: /\bi\s+believe\b/i,                                        flag: 'AI görüş enjeksiyonu I believe' },
  { pattern: /\bit\s+sounds?\s+(like\s+you|as\s+if\s+you)\b/i,        flag: 'Framing bias katılımcının ağzına söz koymak' },
  { pattern: /\bso\s+you'?re?\s+saying\b/i,                            flag: 'Framing bias so you are saying' },

  // Türkçe karşılıklar
  { pattern: /\bharika\b/i,                                             flag: 'Aşırı onaylama (TR): "harika"' },
  { pattern: /\bmüthiş\b/i,                                             flag: 'Aşırı onaylama (TR): "müthiş"' },
  { pattern: /\bbence\b/i,                                              flag: 'AI görüş enjeksiyonu (TR): "bence"' },
]

// ---------------------------------------------------------------------------
// Yardımcı kontroller
// ---------------------------------------------------------------------------

/** Aynı anda birden fazla soru içeriyor mu — risky */
function hasMultipleQuestions(reply: string): boolean {
  return (reply.match(/\?/g) ?? []).length > 1
}

/** Soru 50 kelimeyi aşıyor mu — risky (çok bileşik soru) */
function hasLongQuestion(reply: string): boolean {
  const questions = reply.split('?')
  return questions.some(q => q.trim().split(/\s+/).length > 50)
}

// ---------------------------------------------------------------------------
// Katman 1 — applyInterviewGuard
// ---------------------------------------------------------------------------

/**
 * Katılımcı interview sohbetinde AI'ın ürettiği cevabı kural tabanlı filtreden geçirir.
 * ~0ms — hiç LLM çağrısı yapmaz.
 * Kural seti: SKILL.md Skill 5 + Skill 3 "Banned patterns"
 */
export function applyInterviewGuard(reply: string): GuardResult {
  // BLOCKED kontrolü
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(reply)) {
      return { verdict: 'blocked', reason }
    }
  }

  // RISKY kontrolleri
  const flags: string[] = []

  for (const { pattern, flag } of RISKY_PATTERNS) {
    if (pattern.test(reply)) flags.push(flag)
  }

  if (hasMultipleQuestions(reply)) {
    flags.push('Birden fazla soru içeriyor Mom Test tek soru kuralı ihlali riski')
  }

  if (hasLongQuestion(reply)) {
    flags.push('50 kelime üstü soru bileşik yönlendirici soru riski')
  }

  if (flags.length > 0) {
    return { verdict: 'risky', flags, reason: flags[0] }
  }

  return { verdict: 'clean' }
}

// ---------------------------------------------------------------------------
// Katman 2 — checkInterviewReplyIsolated
// ---------------------------------------------------------------------------

/**
 * Riskli bulunan interview cevabını, sıfır conversation history ile bağımsız
 * bir LLM context'inde değerlendirir. Objektifliği korumak için ana
 * konuşma geçmişi, participant adı veya proje bağlamı gönderilmez.
 */
const INTERVIEW_CHECKER_PROMPT = `You are a Mom Test interview quality auditor.
You are evaluating a single message produced by a customer interviewer AI.
You have NO conversation history — only this one message.

Evaluate against these rules:
1. Does it mention, pitch, or describe "our product", "our app", "what we're building", or any solution? (forbidden)
2. Does it contain any of these banned question patterns?
   - "Would you use this/it?"
   - "Would you pay/buy?"
   - "Do you like this?"
   - "Is this a good idea?"
   - "Should we build this?"
   - "What features do you want?"
   - "Could you imagine using this?"
   - Any question starting with "Would you..." (forbidden)
3. Does it ask about future intentions instead of past behavior? (forbidden)
4. Does it ask more than one question at a time? (forbidden)
5. Does it excessively validate or praise the participant ("That's amazing!", "Wow!")? (forbidden)

Respond ONLY with valid JSON, no prose, no markdown:
{ "verdict": "pass" | "fail", "reason": "brief explanation" }`

export async function checkInterviewReplyIsolated(
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
        { role: 'system', content: INTERVIEW_CHECKER_PROMPT },
        { role: 'user',   content: reply },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!raw) {
      console.warn('[InterviewGuard/checker] LLM boş yanıt döndürdü — pass kabul edildi')
      return { verdict: 'pass', reason: 'checker empty response — defaulting to pass' }
    }

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { verdict?: string; reason?: string }

    if (parsed.verdict !== 'pass' && parsed.verdict !== 'fail') {
      console.warn('[InterviewGuard/checker] Beklenmedik verdict değeri:', parsed.verdict)
      return { verdict: 'pass', reason: 'unexpected verdict — defaulting to pass' }
    }

    return {
      verdict: parsed.verdict,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch (err) {
    // Checker hatası ana akışı durdurmamalı — pass kabul et, logla
    console.error('[InterviewGuard/checker] LLM çağrısı başarısız, pass kabul edildi:', err)
    return { verdict: 'pass', reason: 'checker error — defaulting to pass' }
  }
}

// ---------------------------------------------------------------------------
// Fallback mesajı
// ---------------------------------------------------------------------------

/**
 * Guard retry'ları da başarısız olursa kullanılacak güvenli soru.
 * SKILL.md Skill 3 question bank'ten seçildi — geçmişe yönelik, Mom Test uyumlu.
 */
export const INTERVIEW_FALLBACK_MESSAGE =
  'Can you tell me about the last time this happened?'
