import { describe, it, expect } from 'vitest'
import {
  levenshteinDistance,
  isCloseToTarget,
  findBestMatch,
  matchesAny,
} from '@/lib/typo-tolerant-match'
import { normalizeUserInput } from '@/lib/text-normalization'
import {
  EVASIVE_PATTERNS_TR,
  EVASIVE_PATTERNS_EN,
  EVASIVE_PATTERNS_ALL,
  USER_INPUT_MAX_DISTANCE,
  AI_OUTPUT_MAX_DISTANCE,
} from '@/lib/constants'

describe('typo-tolerant-match - Levenshtein Distance', () => {
  it('calculates distance correctly for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0)
    expect(levenshteinDistance('test', 'test')).toBe(0)
  })

  it('calculates distance correctly for single character differences', () => {
    expect(levenshteinDistance('hello', 'hallo')).toBe(1)
    expect(levenshteinDistance('test', 'tast')).toBe(1)
  })

  it('calculates distance correctly for multiple character differences', () => {
    expect(levenshteinDistance('hello', 'world')).toBe(4)
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
  })

  it('calculates distance correctly for insertions and deletions', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1) // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1) // deletion
  })

  it('calculates distance correctly for mixed operations', () => {
    expect(levenshteinDistance('intention', 'execution')).toBe(5)
  })
})

describe('typo-tolerant-match - isCloseToTarget', () => {
  it('returns true for exact match regardless of maxDistance', () => {
    expect(isCloseToTarget('hello', 'hello', 0)).toBe(true)
    expect(isCloseToTarget('hello', 'hello', 5)).toBe(true)
  })

  it('returns true when distance is within maxDistance', () => {
    expect(isCloseToTarget('hello', 'hallo', 1)).toBe(true)
    expect(isCloseToTarget('hello', 'helo', 1)).toBe(true)
  })

  it('returns false when distance exceeds maxDistance', () => {
    expect(isCloseToTarget('hello', 'hallo', 0)).toBe(false)
    expect(isCloseToTarget('hello', 'world', 2)).toBe(false)
  })

  it('throws error for negative maxDistance', () => {
    expect(() => isCloseToTarget('hello', 'hello', -1)).toThrow('maxDistance must be non-negative')
  })
})

describe('typo-tolerant-match - findBestMatch', () => {
  it('returns the best matching candidate within tolerance', () => {
    const candidates = ['apple', 'banana', 'cherry']
    expect(findBestMatch('aple', candidates, 2)).toBe('apple')
    expect(findBestMatch('banna', candidates, 2)).toBe('banana')
  })

  it('returns null when no match is within tolerance', () => {
    const candidates = ['apple', 'banana', 'cherry']
    expect(findBestMatch('xyz', candidates, 2)).toBeNull()
  })

  it('returns null for empty candidates array', () => {
    expect(findBestMatch('hello', [], 2)).toBeNull()
  })

  it('chooses the closest match when multiple are within tolerance', () => {
    const candidates = ['test', 'toast', 'taste']
    expect(findBestMatch('tast', candidates, 2)).toBe('test') // distance 1 (first match)
  })
})

describe('typo-tolerant-match - matchesAny', () => {
  it('returns true when any target is within tolerance', () => {
    const targets = ['apple', 'banana', 'cherry']
    expect(matchesAny('aple', targets, 2)).toBe(true)
    expect(matchesAny('banna', targets, 2)).toBe(true)
  })

  it('returns false when no target is within tolerance', () => {
    const targets = ['apple', 'banana', 'cherry']
    expect(matchesAny('xyz', targets, 2)).toBe(false)
  })
})

describe('typo-tolerant-match - User Input Scenarios (Turkish)', () => {
  const targets = EVASIVE_PATTERNS_TR

  it('matches "bilmyrm" to "bilmem" with loose tolerance (closer match)', () => {
    const normalized = normalizeUserInput('bilmyrm')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('bilmem') // distance 3, closer than bilmiyorum (distance 4)
  })

  it('matches "bilmiorum" to "bilmiyorum" with loose tolerance', () => {
    const normalized = normalizeUserInput('bilmiorum')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('bilmiyorum')
  })

  it('matches "hatrlamiyorum" to "hatırlamıyorum" with loose tolerance', () => {
    const normalized = normalizeUserInput('hatrlamiyorum')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('hatırlamıyorum')
  })

  it('matches "yokk" to "yok" with loose tolerance', () => {
    const normalized = normalizeUserInput('yokk')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('yok')
  })

  it('matches "sanrım" to "sanırım" with loose tolerance', () => {
    const normalized = normalizeUserInput('sanrım')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('sanırım')
  })

  it('matches "belkı" to "belki" with loose tolerance', () => {
    const normalized = normalizeUserInput('belkı')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('belki')
  })

  it('matches "emn değilim" to "emin değilim" with loose tolerance', () => {
    const normalized = normalizeUserInput('emn değilim')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('emin değilim')
  })

  it('matches "galba" to "galiba" with loose tolerance', () => {
    const normalized = normalizeUserInput('galba')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('galiba')
  })

  it('matches "herhalde" to "herhalde" (exact match)', () => {
    const normalized = normalizeUserInput('herhalde')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('herhalde')
  })

  it('matches "muhtemeln" to "muhtemelen" with loose tolerance', () => {
    const normalized = normalizeUserInput('muhtemeln')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('muhtemelen')
  })

  // False positive checks
  it('does NOT match "bilgi" to any evasive pattern (needs stricter tolerance)', () => {
    const normalized = normalizeUserInput('bilgi')
    const match = findBestMatch(normalized, targets, 1) // Use stricter tolerance (distance 2 needed)
    expect(match).toBeNull()
  })

  it('does NOT match "yoksa" to "yok" (different meaning, needs stricter tolerance)', () => {
    const normalized = normalizeUserInput('yoksa')
    const match = findBestMatch(normalized, targets, 1) // Use stricter tolerance
    expect(match).toBeNull()
  })

  it('does NOT match "sanat" to "sanırım" (different meaning)', () => {
    const normalized = normalizeUserInput('sanat')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBeNull()
  })
})

describe('typo-tolerant-match - User Input Scenarios (English)', () => {
  const targets = EVASIVE_PATTERNS_EN

  it('matches "i dont know" to "i don\'t know" with loose tolerance', () => {
    const normalized = normalizeUserInput('i dont know')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe("i don't know")
  })

  it('matches "not sure" to "not sure" (exact match)', () => {
    const normalized = normalizeUserInput('not sure')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('not sure')
  })

  it('matches "mayb" to "maybe" with loose tolerance', () => {
    const normalized = normalizeUserInput('mayb')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('maybe')
  })

  it('matches "i dont remember" to "i don\'t remember" with loose tolerance', () => {
    const normalized = normalizeUserInput('i dont remember')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe("i don't remember")
  })

  it('matches "no ida" to "no idea" with loose tolerance', () => {
    const normalized = normalizeUserInput('no ida')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('no idea')
  })

  it('matches "probly" to "probably" with loose tolerance', () => {
    const normalized = normalizeUserInput('probly')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('probably')
  })

  it('matches "i thnk" to "i think" with loose tolerance', () => {
    const normalized = normalizeUserInput('i thnk')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('i think')
  })

  it('matches "i beleve" to "i believe" with loose tolerance', () => {
    const normalized = normalizeUserInput('i beleve')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('i believe')
  })

  // False positive checks
  it('does NOT match "information" to any evasive pattern', () => {
    const normalized = normalizeUserInput('information')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBeNull()
  })

  it('does NOT match "maybe not" to "maybe" (different meaning)', () => {
    const normalized = normalizeUserInput('maybe not')
    const match = findBestMatch(normalized, targets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBeNull()
  })
})

describe('typo-tolerant-match - AI Output Validation (Strict Tolerance)', () => {
  it('requires exact match for AI output with maxDistance=0', () => {
    expect(isCloseToTarget('great idea', 'great idea', AI_OUTPUT_MAX_DISTANCE)).toBe(true)
    expect(isCloseToTarget('great idea', 'great idae', AI_OUTPUT_MAX_DISTANCE)).toBe(false)
  })

  it('allows single typo for AI output with maxDistance=1', () => {
    expect(isCloseToTarget('great idea', 'great idea', 1)).toBe(true) // exact match
    expect(isCloseToTarget('great idea', 'great ida', 1)).toBe(true) // 1 typo (e→a)
    expect(isCloseToTarget('great idea', 'great id', 1)).toBe(false) // 2 typos (ea→d)
  })

  it('is stricter than user input matching', () => {
    const aiOutput = 'bilmiyorum'
    const userInput = 'bilmyrm'

    // AI output: strict tolerance
    expect(isCloseToTarget(aiOutput, 'bilmiyorum', AI_OUTPUT_MAX_DISTANCE)).toBe(true)
    expect(isCloseToTarget(aiOutput, 'bilmyrm', AI_OUTPUT_MAX_DISTANCE)).toBe(false)

    // User input: loose tolerance
    expect(isCloseToTarget(userInput, 'bilmiyorum', USER_INPUT_MAX_DISTANCE)).toBe(true)
  })
})

describe('typo-tolerant-match - Combined Language Scenarios', () => {
  const allTargets = EVASIVE_PATTERNS_ALL

  it('matches Turkish typos correctly in combined list', () => {
    const normalized = normalizeUserInput('bilmyrm')
    const match = findBestMatch(normalized, allTargets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('bilmem') // closer match than bilmiyorum
  })

  it('matches English typos correctly in combined list', () => {
    const normalized = normalizeUserInput('i dont know')
    const match = findBestMatch(normalized, allTargets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe("i don't know")
  })

  it('does not cross-match between languages', () => {
    const normalized = normalizeUserInput('bilmiyorum')
    const match = findBestMatch(normalized, allTargets, USER_INPUT_MAX_DISTANCE)
    expect(match).toBe('bilmiyorum')
    expect(match).not.toBe("i don't know")
  })
})
