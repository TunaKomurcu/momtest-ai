/**
 * Project-wide constants and pattern definitions.
 * Centralized location for all string patterns, keyword lists, and configuration values.
 */

// ---------------------------------------------------------------------------
// Evasive answer patterns for user input matching (PM intake & participant interview)
// These are used with typo-tolerant matching to detect vague/evasive responses
// ---------------------------------------------------------------------------

/**
 * Turkish evasive answer patterns.
 * Used for detecting vague or evasive user responses in intake and interview flows.
 */
export const EVASIVE_PATTERNS_TR: string[] = [
  'bilmiyorum',
  'bilmem',
  'hatırlamıyorum',
  'yok',
  'sanırım',
  'belki',
  'emin değilim',
  'galiba',
  'herhalde',
  'muhtemelen',
  'genelde',
  'genellikle',
]

/**
 * English evasive answer patterns.
 * Used for detecting vague or evasive user responses in intake and interview flows.
 */
export const EVASIVE_PATTERNS_EN: string[] = [
  "i don't know",
  'not sure',
  'maybe',
  "i don't remember",
  'no idea',
  'probably',
  'possibly',
  'usually',
  'typically',
  'generally',
  'i think',
  'i believe',
]

/**
 * Combined evasive patterns for both languages.
 */
export const EVASIVE_PATTERNS_ALL: string[] = [
  ...EVASIVE_PATTERNS_TR,
  ...EVASIVE_PATTERNS_EN,
]

// ---------------------------------------------------------------------------
// Typo tolerance settings
// ---------------------------------------------------------------------------

/**
 * Maximum Levenshtein distance for user input matching.
 * User input can have more typos, so we use a looser tolerance.
 */
export const USER_INPUT_MAX_DISTANCE = 3

/**
 * Maximum Levenshtein distance for AI output validation.
 * AI output should be more precise, so we use a stricter tolerance.
 */
export const AI_OUTPUT_MAX_DISTANCE = 1

/**
 * Maximum Levenshtein distance for exact matching (zero tolerance).
 */
export const EXACT_MATCH_MAX_DISTANCE = 0
