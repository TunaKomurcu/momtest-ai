import OpenAI from 'openai'
import type { GuardResult, ReplyCheckResult } from '@/types/index'

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/**
 * Guard retry döngüsünün maksimum deneme sayısı.
 * Sonsuz döngü riskini engeller — intake deseniyle aynı.
 */
export const MAX_INTERVIEW_GUARD_RETRIES = 2

// ---------------------------------------------------------------------------
// Kural setleri
// ---------------------------------------------------------------------------

/**
 * BLOCKED kalıpları — Kesin ihlal, isolated check'e gerek yok.
 * SKILL.md Skill 5 + Skill 3 "Banned patterns".
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Ürünü/çözümü ifşa etmek veya satmak
  { pattern: /\bour\s+(product|app|tool|solution|platform)\b/i,                              reason: 'Ürün ifşası: "our product/app/tool"' },
  { pattern: /\bwhat\s+we'?re?\s+building\b/i,                                               reason: 'Ürün ifşası: "what we\'re building"' },
  { pattern: /\bthe\s+(app|tool|solution|product)\s+(would|can|will|helps?)\b/i,             reason: 'Ürün tanıtımı: çözümü anlatmak' },
  { pattern: /\bi\s+think\s+you\s+(would\s+)?benefit\s+from\b/i,                            reason: 'Ürün satışı: katılımcıya fayda önermek' },

  // Görüş / onay alma — SKILL.md Skill 3 yasaklı kalıplar
  { pattern: /\bwould\s+you\s+use\s+(this|it|something\s+like\s+this)\b/i,                  reason: 'Yasaklı: "Would you use this?"' },
  { pattern: /\bwould\s+you\s+(pay|buy)\s+(for\s+)?(this|it)\b/i,                           reason: 'Yasaklı: "Would you pay/buy?"' },
  { pattern: /\bhow\s+much\s+would\s+you\s+pay\b/i,                                         reason: 'Yasaklı: "How much would you pay?"' },
  { pattern: /\bdo\s+you\s+(like|enjoy)\s+this(\s+idea)?\b/i,                               reason: 'Yasaklı: "Do you like this?"' },
  { pattern: /\bis\s+this\s+(a\s+)?(good\s+|interesting\s+)?idea\b/i,                       reason: 'Yasaklı: "Is this a good idea?"' },
  { pattern: /\bis\s+this\s+interesting\s+to\s+you\b/i,                                     reason: 'Yasaklı: "Is this interesting to you?"' },
  { pattern: /\bshould\s+we\s+build\s+this\b/i,                                             reason: 'Yasaklı: "Should we build this?"' },
  { pattern: /\bcould\s+you\s+imagine\s+using\s+this\b/i,                                   reason: 'Yasaklı: "Could you imagine using this?"' },
  { pattern: /\bwould\s+this\s+be\s+useful\b/i,                                             reason: 'Yasaklı: "Would this be useful?"' },
  { pattern: /\bwhat\s+features?\s+do\s+you\s+want\b/i,                                     reason: 'Yasaklı: özellik listesi istemek' },
  { pattern: /\bdo\s+you\s+think\s+(this\s+is|it\s+is|it'?s?)\s+(a\s+)?(good\s+)?idea\b/i,reason: 'Yasaklı: "Do you think this is a good idea?"' },

  // Gelecek niyet — "Would you..." ile başlayan herhangi bir soru
  { pattern: /^would\s+you\b/im,                                                             reason: 'Gelecek niyet sorusu: "Would you..." başlangıcı' },

  // Yönlendirici/hipotetik soru kalıpları — Mom Test ihlali
  { pattern: /\bdo\s+you\s+think\s+you'?d?\b/i,                                             reason: 'Yönlendirici: "do you think you\'d"' },
  { pattern: /\bhypothetically\b/i,                                                          reason: 'Hipotetik: "hypothetically"' },
  { pattern: /\bif\s+(this\s+)?(existed|were\s+(available|built|free)|was\s+available)\b/i, reason: 'Hipotetik: "if this existed/were available"' },
  { pattern: /\beğer\s+(bu\s+)?(olsaydı|var\s+olsaydı|mevcut\s+olsaydı)\b/i,               reason: 'Hipotetik (TR): "eğer olsaydı"' },
  { pattern: /\bbunu\s+satın\s+alır\s+mıydınız\b/i,                                         reason: 'Yasaklı (TR): "bunu satın alır mıydınız"' },
  { pattern: /\bkullanır\s+mıydınız\b/i,                                                    reason: 'Yasaklı (TR): "kullanır mıydınız"' },
  { pattern: /\bödeme\s+yapar\s+mıydınız\b/i,                                               reason: 'Yasaklı (TR): "ödeme yapar mıydınız"' },
]

/**
 * RISKY kalıpları — Belirsiz, isolated LLM check gerekebilir.
 */
const RISKY_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  // Aşırı onaylama — katılımcıyı yönlendirme riski
  { pattern: /\b(that'?s?|how)\s+(great|amazing|wonderful|fantastic|interesting|excellent|perfect)\b/i, flag: 'Aşırı onaylama katılımcıyı yönlendirme riski' },
  { pattern: /\bwow\b/i,                                                                               flag: 'Aşırı onaylama wow' },

  // AI kendi yorumunu enjekte ediyor
  { pattern: /\bi\s+think\b/i,                                                                         flag: 'AI görüş enjeksiyonu I think' },
  { pattern: /\bi\s+believe\b/i,                                                                       flag: 'AI görüş enjeksiyonu I believe' },
  { pattern: /\bit\s+sounds?\s+(like\s+you|as\s+if\s+you)\b/i,                                       flag: 'Framing bias katılımcının ağzına söz koymak' },
  { pattern: /\bso\s+you'?re?\s+saying\b/i,                                                           flag: 'Framing bias so you are saying' },

  // Yarı-yönlendirici gelecek niyet soruları
  { pattern: /\bwould\s+you\s+(consider|be\s+interested\s+in|be\s+open\s+to)\b/i,                    flag: 'Yarı-yönlendirici gelecek niyet' },
  { pattern: /\bcan\s+you\s+imagine\b/i,                                                              flag: 'Hipotetik: "can you imagine"' },
  { pattern: /\bif\s+you\s+(had|could|were)\b/i,                                                      flag: 'Hipotetik koşul: "if you had/could/were"' },

  // Türkçe
  { pattern: /\bharika\b/i,                                                                            flag: 'Aşırı onaylama (TR): "harika"' },
  { pattern: /\bmüthiş\b/i,                                                                            flag: 'Aşırı onaylama (TR): "müthiş"' },
  { pattern: /\bbence\b/i,                                                                             flag: 'AI görüş enjeksiyonu (TR): "bence"' },
  { pattern: /\beğer\s+(sahip\s+olsaydınız|yapabilseydiniz)\b/i,                                     flag: 'Hipotetik (TR): koşul ifadesi' },
]

// ---------------------------------------------------------------------------
// Yardımcı kontroller
// ---------------------------------------------------------------------------

/** Aynı anda birden fazla gerçek soru içeriyor mu — risky */
function hasMultipleQuestions(reply: string): boolean {
  const rawQmarks = (reply.match(/\?/g) ?? []).length
  if (rawQmarks < 2) return false

  const EN_Q = /^\s*(?:and|but|or|so)?\s*(who|what|when|where|why|how|which|whose|whom|do|does|did|is|are|was|were|have|has|had|will|would|could|should|can|may|might|shall)\b/i
  const TR_Q = /\b(ne\b|neden|nasıl|nerede|nereden|nereye|kim(ler?|in)?|hangi|kaç|kaçıncı|ne\s+zaman)\b/i
  const TR_S = /\b\w+(mı|mi|mu|mü|misin|mısın|musun|müsün|miyim|mıyım|muyum|müyüm|lar\s+mı|ler\s+mi)\s*\?/i

  const segments = reply.split('?').slice(0, -1)
  let realCount = 0

  for (const seg of segments) {
    const last = (seg.split(/[.!;\n]/).pop() ?? seg).trim()
    if (EN_Q.test(last) || TR_Q.test(last) || TR_S.test(seg + '?')) realCount++
  }

  return realCount >= 2
}

/** Soru 50 kelimeyi aşıyor mu — risky */
function hasLongQuestion(reply: string): boolean {
  return reply.split('?').some(q => q.trim().split(/\s+/).length > 50)
}

// ---------------------------------------------------------------------------
// In-memory metrik sayacı — intake deseniyle aynı
// ---------------------------------------------------------------------------

const LOG_INTERVAL = 10

const _metrics = { totalCalls: 0, flaggedCalls: 0 }

export function resetInterviewGuardMetrics(): void {
  _metrics.totalCalls = 0
  _metrics.flaggedCalls = 0
}

export function getInterviewGuardMetrics(): { totalCalls: number; flaggedCalls: number } {
  return { ..._metrics }
}

function recordMetric(verdict: 'clean' | 'blocked' | 'risky'): void {
  _metrics.totalCalls++
  if (verdict !== 'clean') _metrics.flaggedCalls++

  if (_metrics.totalCalls % LOG_INTERVAL === 0) {
    const pct = ((_metrics.flaggedCalls / _metrics.totalCalls) * 100).toFixed(1)
    console.log(`[Interview/guard] Flag rate: ${_metrics.flaggedCalls}/${_metrics.totalCalls} (%${pct})`)
  }
}

// ---------------------------------------------------------------------------
// Katman 1 — applyInterviewGuard
// ---------------------------------------------------------------------------

export function applyInterviewGuard(reply: string): GuardResult {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(reply)) {
      recordMetric('blocked')
      return { verdict: 'blocked', reason }
    }
  }

  const flags: string[] = []

  for (const { pattern, flag } of RISKY_PATTERNS) {
    if (pattern.test(reply)) flags.push(flag)
  }

  if (hasMultipleQuestions(reply)) {
    flags.push('Birden fazla soru içeriyor Mom Test tek soru kuralı ihlali riski (birden fazla soru)')
  }

  if (hasLongQuestion(reply)) {
    flags.push('50 kelime üstü soru bileşik yönlendirici soru riski (50 kelime)')
  }

  if (flags.length > 0) {
    recordMetric('risky')
    return { verdict: 'risky', flags, reason: flags[0] }
  }

  recordMetric('clean')
  return { verdict: 'clean' }
}

// ---------------------------------------------------------------------------
// Katman 2 — checkInterviewReplyIsolated
// ---------------------------------------------------------------------------

const INTERVIEW_CHECKER_PROMPT = `You are a Mom Test interview quality auditor.
You are evaluating a single message produced by a customer interviewer AI.
You have NO conversation history — only this one message.

Evaluate against these rules:
1. Does it mention, pitch, or describe "our product", "our app", "what we're building", or any solution? (forbidden)
2. Does it contain any banned question patterns?
   - "Would you use/buy/pay for this?"
   - "Do you like this?" / "Is this a good idea?"
   - "Should we build this?" / "Could you imagine using this?"
   - Any question starting with "Would you..."
   - "do you think you'd", "hypothetically", "if this existed"
3. Does it ask about future intentions or hypotheticals instead of past behavior? (forbidden)
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
    console.error('[InterviewGuard/checker] LLM çağrısı başarısız, pass kabul edildi:', err)
    return { verdict: 'pass', reason: 'checker error — defaulting to pass' }
  }
}

// ---------------------------------------------------------------------------
// Fallback mesajı
// ---------------------------------------------------------------------------

export const INTERVIEW_FALLBACK_MESSAGE =
  'Can you tell me about the last time this happened?'
