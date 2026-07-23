import { describe, it, expect } from 'vitest'
import { isLikelyVague } from '@/lib/answer-vagueness-checker'

describe('answer-vagueness-checker', () => {
  describe('isLikelyVague', () => {
    it('should flag very short vague keywords', () => {
      expect(isLikelyVague('evet')).toBe(true)
      expect(isLikelyVague('hayır')).toBe(true)
      expect(isLikelyVague('bilmiyorum')).toBe(true)
      expect(isLikelyVague('sanırım')).toBe(true)
      expect(isLikelyVague('yes')).toBe(true)
      expect(isLikelyVague('no')).toBe(true)
      expect(isLikelyVague("i don't know")).toBe(true)
    })

    it('should NOT flag short but concrete answers', () => {
      expect(isLikelyVague('Evet, geçen ay 3 kez oldu')).toBe(false)
      expect(isLikelyVague('Last Tuesday')).toBe(false)
      expect(isLikelyVague('5 times')).toBe(false)
      expect(isLikelyVague('15-01-2024')).toBe(false)
    })

    it('should flag very short answers without concreteness signals', () => {
      expect(isLikelyVague('tamam')).toBe(true)
      expect(isLikelyVague('güzel')).toBe(true)
      expect(isLikelyVague('iyi')).toBe(true)
    })

    it('should NOT flag longer answers', () => {
      expect(isLikelyVague('Bu konuda gerçekten çok düşündüm')).toBe(false)
      expect(isLikelyVague('Genelde sorun yok ama bazen oluyor')).toBe(false)
    })

    it('should flag counter-questions', () => {
      expect(isLikelyVague('Neden soruyorsun?')).toBe(true)
      expect(isLikelyVague('How would you solve it?')).toBe(true)
      expect(isLikelyVague('What do you mean?')).toBe(true)
      expect(isLikelyVague('Ne demek istiyorsun?')).toBe(true)
    })

    it('should NOT flag answers ending with question mark that are not counter-questions', () => {
      expect(isLikelyVague('Geçen hafta oldu, sanırım?')).toBe(false)
    })

    it('should handle empty or whitespace-only input', () => {
      expect(isLikelyVague('')).toBe(true)
      expect(isLikelyVague('   ')).toBe(true)
    })
  })
})
