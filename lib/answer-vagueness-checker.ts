import OpenAI from 'openai'
import type { OpenAIAgentConfig } from '@/types/index'
import { normalizeUserInput } from '@/lib/text-normalization'
import { findBestMatch, matchesAny } from '@/lib/typo-tolerant-match'
import { EVASIVE_PATTERNS_ALL, USER_INPUT_MAX_DISTANCE } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHORT_ANSWER_THRESHOLD = 15
const LOG_INTERVAL = 10  // kaç çağrıda bir oranı logla

const _metrics = {
  totalCalls: 0,
  flaggedCalls: 0,  // heuristic flagged
  probesGenerated: 0,  // probe questions generated
  maxProbeLimitHits: 0,  // times MAX_PROBES limit was reached
}

/**
 * Metrik sayacını sıfırlar.
 * Test ortamında test izolasyonu için kullanılır — production'da çağrılmamalı.
 */
export function resetVaguenessGuardMetrics(): void {
  _metrics.totalCalls = 0
  _metrics.flaggedCalls = 0
  _metrics.probesGenerated = 0
  _metrics.maxProbeLimitHits = 0
}

/**
 * Mevcut metrik anlık görüntüsünü döndürür.
 * Test assertion'larında kullanılır.
 */
export function getVaguenessGuardMetrics(): { 
  totalCalls: number; 
  flaggedCalls: number; 
  probesGenerated: number; 
  maxProbeLimitHits: number; 
} {
  return { ..._metrics }
}

function recordMetric(flagged: boolean, probeGenerated: boolean, maxProbeHit: boolean): void {
  _metrics.totalCalls++
  if (flagged) _metrics.flaggedCalls++
  if (probeGenerated) _metrics.probesGenerated++
  if (maxProbeHit) _metrics.maxProbeLimitHits++

  if (_metrics.totalCalls % LOG_INTERVAL === 0) {
    const pct = ((_metrics.flaggedCalls / _metrics.totalCalls) * 100).toFixed(1)
    console.log(
      `[Vagueness] Flag rate: ${_metrics.flaggedCalls}/${_metrics.totalCalls} (%${pct}), Probes generated: ${_metrics.probesGenerated}, Max-probe-limit hits: ${_metrics.maxProbeLimitHits}`
    )
  }
}
const VAGUE_KEYWORDS = new Set([
  'evet',
  'hayır',
  'bilmiyorum',
  'sanırım',
  'galiba',
  'herhalde',
  'muhtemelen',
  'belki',
  'genelde',
  'genellikle',
  'yes',
  'no',
  "i don't know",
  "i think",
  'maybe',
  'probably',
  'possibly',
  'usually',
  'typically',
  'generally',
])

// Concreteness signals - if present, answer is likely concrete even if short
// These patterns are typo-resistant because they use character classes (regex)
const CONCRETENESS_PATTERNS = [
  /\d+/, // Numbers (e.g., "3 kere", "2 saat", "%50", "5 people")
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/, // Dates (e.g., 01/15/2024, 15-01-24)
  /\b\d+\s*(yıl|ay|hafta|gün|saat|dakika|saniye|year|month|week|day|hour|minute|second|years|months|weeks|days|hours|minutes|seconds)\b/i, // Relative time with numbers (e.g., "3 ay önce", "2 weeks ago")
  /\b(yesterday|today|tomorrow|last week|last month|last year|geçen hafta|geçen ay|geçen yıl|dün|bugün|yarın|geçen|önce|sonra|recent|lately|recently)\b/i, // Time expressions
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b/i, // Month names
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\b/i, // Day names
  /\$\d+|\d+\s*(tl|dolar|euro|pound|sterling|usd|eur|gbp)\b/i, // Currency amounts (e.g., "$50", "100 tl", "200 usd")
  /\d+\s*(kere|kez|defa|times|occurrences)\b/i, // Frequency expressions (e.g., "3 kere", "5 times")
  /\b\d+\s*(kişi|person|people|user|users|client|clients)\b/i, // People counts (e.g., "3 kişi", "5 people")
]

// Counter-question patterns - user asking instead of answering
const COUNTER_QUESTION_PATTERNS = [
  /^(why|how|what|when|where|who|which|neden|nasıl|ne|ne zaman|nerede|kim|hangisi)\b/i, // Starts with question word
]

// Short counter-question pattern - very short AND ends with question mark
const SHORT_COUNTER_QUESTION_PATTERN = /^.{1,20}\?$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaguenessCheckResult {
  isVague: boolean
  reason: string
  confidence?: 'high' | 'low'
}

export interface VaguenessCheckWithConfidence {
  vague: boolean
  confidence: 'high' | 'low'
  reason: string
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function loadAgentConfig(): Partial<OpenAIAgentConfig> {
  try {
    const yaml = require('js-yaml')
    const fs = require('fs')
    const path = require('path')
    const yamlPath = path.join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml')
    const raw = fs.readFileSync(yamlPath, 'utf-8')
    return yaml.load(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[VaguenessChecker] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

function hasConcretenessSignals(answer: string): boolean {
  const lowerAnswer = answer.toLowerCase()
  return CONCRETENESS_PATTERNS.some(pattern => pattern.test(lowerAnswer))
}

/**
 * Checks if the answer contains evasive patterns using typo-tolerant matching.
 * This is more robust than exact keyword matching for user input.
 * For very short words (< 5 chars), uses stricter tolerance to avoid false positives.
 */
function hasEvasivePattern(answer: string): boolean {
  const normalized = normalizeUserInput(answer)
  const trimmed = normalized.trim()
  
  // For very short words, use stricter tolerance to avoid false positives
  // e.g., "iyi" (good) should not match "yok" (no)
  const maxDistance = trimmed.length < 5 ? 1 : USER_INPUT_MAX_DISTANCE
  
  return matchesAny(normalized, EVASIVE_PATTERNS_ALL, maxDistance)
}

/**
 * Gets the specific evasive pattern matched, if any.
 * For very short words (< 5 chars), uses stricter tolerance to avoid false positives.
 */
function getEvasivePatternMatch(answer: string): string | null {
  const normalized = normalizeUserInput(answer)
  const trimmed = normalized.trim()
  
  // For very short words, use stricter tolerance to avoid false positives
  const maxDistance = trimmed.length < 5 ? 1 : USER_INPUT_MAX_DISTANCE
  
  return findBestMatch(normalized, EVASIVE_PATTERNS_ALL, maxDistance)
}

function isCounterQuestion(answer: string): boolean {
  const trimmed = answer.trim()
  // Check if it starts with a question word (clear counter-question)
  if (COUNTER_QUESTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return true
  }
  // Check if it's very short AND ends with question mark (likely counter-question)
  if (SHORT_COUNTER_QUESTION_PATTERN.test(trimmed)) {
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Heuristic check
// ---------------------------------------------------------------------------

/**
 * Enhanced heuristic check with three-category logic.
 * Word list matching is used only as a suspicion score, not as final decision maker.
 * 
 * Logic:
 * 1. "confidently concrete" → concreteness signal present AND not very short → vague:false, HIGH confidence (no LLM needed)
 * 2. "confidently vague" → very short (<10 chars) AND no concreteness signals → vague:true, HIGH confidence (no LLM needed)
 * 3. "ambiguous" → everything else (word list match or not) → send to isolated LLM check for final decision
 * 
 * @param answer - The user's answer to check
 * @param logPrefix - Optional logging prefix (default: '[Interview/vagueness]')
 * @returns Vagueness check result with confidence level
 */
export function isLikelyVagueWithConfidence(
  answer: string,
  logPrefix: string = '[Interview/vagueness]'
): VaguenessCheckWithConfidence {
  const trimmed = answer.trim()
  const hasConcrete = hasConcretenessSignals(trimmed)
  const isVeryShort = trimmed.length < 12 // Increased to catch "bilmiyorum" (9 chars) and similar
  const hasEvasive = hasEvasivePattern(trimmed)
  const isCounterQ = isCounterQuestion(trimmed)

  // Category 1: Confidently concrete
  // Concreteness signal present → definitely concrete (regardless of length)
  if (hasConcrete) {
    console.log(`${logPrefix} Heuristic: confidently concrete — concreteness signals present`)
    recordMetric(false, false, false)
    return { vague: false, confidence: 'high', reason: 'Confidently concrete: has concreteness signals' }
  }

  // Category 2: Confidently vague
  // Very short AND has evasive pattern → definitely vague
  // (word list used as additional confirmation signal for very short answers only)
  if (isVeryShort && hasEvasive) {
    const matchedPattern = getEvasivePatternMatch(trimmed)
    console.log(`${logPrefix} Heuristic: confidently vague — very short, evasive pattern: ${matchedPattern}`)
    recordMetric(true, false, false)
    return { vague: true, confidence: 'high', reason: `Confidently vague: very short with evasive pattern: ${matchedPattern}` }
  }

  // Category 3: Ambiguous
  // Everything else → send to isolated LLM check for final decision
  // Word list match is just a hint here, not a decision
  const ambiguousReason = []
  if (hasEvasive) {
    const matchedPattern = getEvasivePatternMatch(trimmed)
    ambiguousReason.push(`evasive pattern hint: ${matchedPattern}`)
  }
  if (isCounterQ) {
    ambiguousReason.push('counter-question hint')
  }
  if (!hasConcrete && !isVeryShort) {
    ambiguousReason.push('no concreteness signals')
  }
  
  console.log(`${logPrefix} Heuristic: ambiguous — ${ambiguousReason.join(', ')} → sending to LLM check`)
  recordMetric(false, false, false)
  return { 
    vague: true, // Default to vague for safety, but low confidence means LLM check
    confidence: 'low', 
    reason: `Ambiguous: ${ambiguousReason.join(', ')}` 
  }
}

/**
 * Legacy heuristic check for backward compatibility.
 * Returns true if answer is suspiciously vague, false if likely concrete.
 * @param logPrefix - Optional logging prefix (default: '[Interview/vagueness]')
 */
export function isLikelyVague(answer: string, logPrefix: string = '[Interview/vagueness]'): boolean {
  const result = isLikelyVagueWithConfidence(answer, logPrefix)
  // For backward compatibility, return true if vague regardless of confidence
  // Low confidence cases should be handled by calling code with LLM check if needed
  return result.vague
}

// ---------------------------------------------------------------------------
// Isolated LLM check
// ---------------------------------------------------------------------------

/**
 * Isolated LLM check to determine if an answer is vague.
 * Uses a separate call with a clear auditor role.
 * @param logPrefix - Optional logging prefix (default: '[Interview/vagueness]')
 */
export async function checkAnswerIsVague(
  question: string,
  answer: string,
  openai?: OpenAI,
  agentConfig?: Partial<OpenAIAgentConfig>,
  logPrefix: string = '[Interview/vagueness]'
): Promise<VaguenessCheckResult> {
  const config = agentConfig ?? loadAgentConfig()
  const client = openai ?? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: config.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const systemPrompt = `You are a strict auditor evaluating interview answers for concreteness.

Your job: Determine if the participant's answer provides a concrete, specific example or behavior, or if it is vague, general, or evasive.

CRITICAL: Evaluate based on MEANING ONLY. Do NOT look for specific keywords or predefined word lists. Assess whether the answer actually provides concrete information or is evasive based on its semantic content.

Answer is CONCRETE if it includes:
- A specific recent example ("Last Tuesday I had this problem")
- Numbers, dates, or time expressions ("3 times last month")
- Specific names, tools, or people involved
- A clear description of actual behavior
- Any specific details that ground the answer in reality

Answer is VAGUE if it:
- Gives opinions without examples ("I think it's important")
- Uses hypothetical language ("I would probably...")
- Gives generic claims ("usually", "always", "never")
- Is evasive or redirects the question ("I don't really follow that topic")
- Is a counter-question instead of an answer
- Lacks any specific details or concrete information
- Uses vague language that could apply to many situations

Respond ONLY with JSON in this exact format:
{
  "isVague": true/false,
  "reason": "brief explanation (max 50 words)"
}`

  const userPrompt = `Question: "${question}"

Answer: "${answer}"

Is this answer concrete or vague? Respond with JSON only.`

  try {
    const completion = await client.chat.completions.create({
      model: config.model?.name ?? 'gemini-flash-latest',
      temperature: 0.1, // Low temperature for consistent classification
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    const content = completion.choices[0]?.message?.content?.trim() ?? ''
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`${logPrefix} Isolated check failed to parse JSON, defaulting to not vague`)
      recordMetric(false, false, false) // Record metric for LLM call
      return { isVague: false, reason: 'Parse error - defaulting to not vague' }
    }

    const result = JSON.parse(jsonMatch[0]) as VaguenessCheckResult
    
    console.log(`${logPrefix} Isolated check: vague=${result.isVague}, reason=${result.reason}`)
    
    // Record metric for LLM check (probe will be generated if isVague is true)
    recordMetric(false, result.isVague, false)
    
    return result
  } catch (err) {
    console.error(`${logPrefix} Isolated check LLM call failed:`, err)
    // Graceful degradation: if check fails, assume not vague to avoid blocking
    recordMetric(false, false, false)
    return { isVague: false, reason: 'LLM check failed - defaulting to not vague' }
  }
}

/**
 * Record when MAX_PROBES limit is reached (called from routes)
 */
export function recordMaxProbeLimitHit(): void {
  recordMetric(false, false, true)
}
