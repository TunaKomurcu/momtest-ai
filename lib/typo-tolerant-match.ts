/**
 * Typo-tolerant text matching utilities.
 * Uses Levenshtein distance to measure similarity between strings.
 * Designed for both AI output validation (strict tolerance) and user input matching (loose tolerance).
 */

/**
 * Calculates the Levenshtein distance between two strings.
 * The minimum number of single-character edits (insertions, deletions, or substitutions)
 * required to change one string into the other.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The Levenshtein distance between the strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Checks if a string is close enough to a target string based on Levenshtein distance.
 * The tolerance is configurable by the caller - use stricter values for AI output validation,
 * and looser values for user input matching.
 *
 * @param input - The input string to check
 * @param target - The target string to match against
 * @param maxDistance - Maximum allowed Levenshtein distance (required, no default)
 * @returns true if the distance is within the allowed tolerance, false otherwise
 *
 * @example
 * // AI output validation (strict)
 * isCloseToTarget("great idea", "great idea", 0) // true - exact match required
 * isCloseToTarget("great idea", "great idae", 1) // true - one typo allowed
 *
 * @example
 * // User input matching (loose)
 * isCloseToTarget("bilmyrm", "bilmiyorum", 3) // true - up to 3 typos allowed
 * isCloseToTarget("sanrm", "sanırım", 2) // true - up to 2 typos allowed
 */
export function isCloseToTarget(input: string, target: string, maxDistance: number): boolean {
  if (maxDistance < 0) {
    throw new Error('maxDistance must be non-negative')
  }

  const distance = levenshteinDistance(input, target)
  return distance <= maxDistance
}

/**
 * Finds the best matching target from a list of candidates.
 * Returns the target with the smallest Levenshtein distance if within tolerance.
 *
 * @param input - The input string to match
 * @param candidates - Array of candidate strings to match against
 * @param maxDistance - Maximum allowed Levenshtein distance (required, no default)
 * @returns The best matching target, or null if no match is within tolerance
 *
 * @example
 * const targets = ["bilmiyorum", "sanırım", "belki"]
 * findBestMatch("bilmyrm", targets, 3) // "bilmiyorum"
 * findBestMatch("xyz", targets, 3) // null
 */
export function findBestMatch(input: string, candidates: string[], maxDistance: number): string | null {
  if (candidates.length === 0) {
    return null
  }

  let bestMatch: string | null = null
  let bestDistance = Infinity

  for (const candidate of candidates) {
    const distance = levenshteinDistance(input, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = candidate
    }
  }

  if (bestDistance <= maxDistance) {
    return bestMatch
  }

  return null
}

/**
 * Checks if input matches any of the target patterns within tolerance.
 *
 * @param input - The input string to check
 * @param targets - Array of target strings to match against
 * @param maxDistance - Maximum allowed Levenshtein distance (required, no default)
 * @returns true if any target is within tolerance, false otherwise
 *
 * @example
 * const targets = ["bilmiyorum", "bilmem", "hatırlamıyorum"]
 * matchesAny("bilmyrm", targets, 3) // true
 * matchesAny("xyz", targets, 3) // false
 */
export function matchesAny(input: string, targets: string[], maxDistance: number): boolean {
  return findBestMatch(input, targets, maxDistance) !== null
}
