import OpenAI from 'openai'
import type { OpenAIAgentConfig } from '@/types/index'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHORT_ANSWER_THRESHOLD = 15
const VAGUE_KEYWORDS = new Set([
  'evet',
  'hayır',
  'bilmiyorum',
  'sanırım',
  'galiba',
  'herhalde',
  'muhtemelen',
  'belki',
  'yes',
  'no',
  "i don't know",
  "i think",
  'maybe',
  'probably',
  'possibly',
])

// Concreteness signals - if present, answer is likely concrete even if short
const CONCRETENESS_PATTERNS = [
  /\d+/, // Numbers
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/, // Dates (e.g., 01/15/2024, 15-01-24)
  /\b(yesterday|today|tomorrow|last week|last month|last year|geçen hafta|geçen ay|geçen yıl|dün|bugün|yarın)\b/i, // Time expressions
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b/i, // Month names
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\b/i, // Day names
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
 * Fast heuristic check for likely vague answers.
 * Returns true if answer is suspiciously vague, false if likely concrete.
 */
export function isLikelyVague(answer: string): boolean {
  const trimmed = answer.trim()

  // Very short answers
  if (trimmed.length < SHORT_ANSWER_THRESHOLD) {
    // Check if it's a vague keyword
    const lower = trimmed.toLowerCase()
    if (VAGUE_KEYWORDS.has(lower)) {
      console.log('[Interview/vagueness] Heuristic flagged — reason: very short vague keyword')
      return true
    }

    // Even if short, check for concreteness signals
    if (hasConcretenessSignals(trimmed)) {
      console.log('[Interview/vagueness] Heuristic cleared — reason: short but has concreteness signals')
      return false
    }

    // Very short without concreteness signals is likely vague
    console.log('[Interview/vagueness] Heuristic flagged — reason: very short without concreteness signals')
    return true
  }

  // Counter-question (user asking instead of answering)
  if (isCounterQuestion(trimmed)) {
    console.log('[Interview/vagueness] Heuristic flagged — reason: counter-question detected')
    return true
  }

  // Not suspicious
  return false
}

// ---------------------------------------------------------------------------
// Isolated LLM check
// ---------------------------------------------------------------------------

/**
 * Isolated LLM check to determine if an answer is vague.
 * Uses a separate call with a clear auditor role.
 */
export async function checkAnswerIsVague(
  question: string,
  answer: string,
  openai?: OpenAI,
  agentConfig?: Partial<OpenAIAgentConfig>
): Promise<VaguenessCheckResult> {
  const config = agentConfig ?? loadAgentConfig()
  const client = openai ?? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: config.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const systemPrompt = `You are a strict auditor evaluating interview answers for concreteness.

Your job: Determine if the participant's answer provides a concrete, specific example or behavior, or if it is vague, general, or evasive.

Answer is CONCRETE if it includes:
- A specific recent example ("Last Tuesday I had this problem")
- Numbers, dates, or time expressions ("3 times last month")
- Specific names, tools, or people involved
- A clear description of actual behavior

Answer is VAGUE if it:
- Gives opinions without examples ("I think it's important")
- Uses hypothetical language ("I would probably...")
- Gives generic claims ("usually", "always", "never")
- Is evasive or redirects the question
- Is a counter-question instead of an answer

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
      console.warn('[Interview/vagueness] Isolated check failed to parse JSON, defaulting to not vague')
      return { isVague: false, reason: 'Parse error - defaulting to not vague' }
    }

    const result = JSON.parse(jsonMatch[0]) as VaguenessCheckResult
    
    console.log(`[Interview/vagueness] Isolated check: vague=${result.isVague}, reason=${result.reason}`)
    
    return result
  } catch (err) {
    console.error('[Interview/vagueness] Isolated check LLM call failed:', err)
    // Graceful degradation: if check fails, assume not vague to avoid blocking
    return { isVague: false, reason: 'LLM check failed - defaulting to not vague' }
  }
}
