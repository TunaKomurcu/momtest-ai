/**
 * Text normalization utilities for user input processing.
 * Normalizes common typing issues: case, whitespace, and repeated characters.
 * Does NOT normalize Turkish diacritics (ş/Ş, ı/I, etc.) as this can change meaning.
 */

/**
 * Normalizes user input text for typo-tolerant matching.
 * Performs the following normalizations:
 * 1. Converts to lowercase
 * 2. Removes excess whitespace (multiple spaces, leading/trailing spaces)
 * 3. Reduces repeated characters (3+ consecutive same characters → 1 character)
 *
 * Does NOT normalize:
 * - Turkish diacritics (ş/Ş, ı/I, ğ/Ğ, etc.) - these can change meaning
 * - Punctuation - preserved for context
 *
 * @param text - The input text to normalize
 * @returns The normalized text
 *
 * @example
 * normalizeUserInput("  Yoookk  ") // "yok"
 * normalizeUserInput("BILMIYORUM") // "bilmiyorum"
 * normalizeUserInput("  sanırım  ") // "sanırım"
 * normalizeUserInput("haaattırlamıyorum") // "hatırlamıyorum"
 */
export function normalizeUserInput(text: string): string {
  if (!text || text.length === 0) {
    return ''
  }

  // Step 1: Convert to lowercase
  let normalized = text.toLowerCase()

  // Step 2: Remove excess whitespace
  normalized = normalized
    .trim() // Remove leading/trailing spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space

  // Step 3: Reduce repeated characters (3+ consecutive same characters → 1)
  // This handles cases like "yoookk" → "yok", "haaattı" → "hatı"
  normalized = normalized.replace(/(.)\1{2,}/g, '$1')

  return normalized
}

/**
 * Normalizes text for AI output validation (stricter normalization).
 * Only performs case and whitespace normalization, no character reduction.
 * Used when we want to preserve exact character counts for strict matching.
 *
 * @param text - The input text to normalize
 * @returns The normalized text
 *
 * @example
 * normalizeAIOutput("  Great Idea  ") // "great idea"
 * normalizeAIOutput("I THINK") // "i think"
 */
export function normalizeAIOutput(text: string): string {
  if (!text || text.length === 0) {
    return ''
  }

  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Removes all whitespace from text (for compact comparison).
 *
 * @param text - The input text
 * @returns Text with all whitespace removed
 *
 * @example
 * removeWhitespace("  hello world  ") // "helloworld"
 */
export function removeWhitespace(text: string): string {
  if (!text || text.length === 0) {
    return ''
  }

  return text.replace(/\s/g, '')
}

/**
 * Truncates text to a maximum length, preserving word boundaries.
 *
 * @param text - The input text
 * @param maxLength - Maximum length to truncate to
 * @returns Truncated text with ellipsis if truncated
 *
 * @example
 * truncateWithEllipsis("This is a very long text", 10) // "This is a..."
 */
export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text
  }

  const truncated = text.substring(0, maxLength - 3)
  const lastSpaceIndex = truncated.lastIndexOf(' ')

  if (lastSpaceIndex > 0) {
    return truncated.substring(0, lastSpaceIndex) + '...'
  }

  return truncated + '...'
}
