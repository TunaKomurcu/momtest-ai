import { describe, it, expect, beforeEach } from 'vitest'
import { isLikelyVague, isLikelyVagueWithConfidence } from '@/lib/answer-vagueness-checker'
import { resetVaguenessGuardMetrics } from '@/lib/answer-vagueness-checker'
import type { ConversationMessage } from '@/types/index'

// Import the countRecentProbes function from the route for testing
// Since it's not exported, we'll test the logic inline here
function countRecentProbes(history: ConversationMessage[]): number {
  const probeIndicators = [
    /last time (that|this|it)/i,
    /specific example of/i,
    /be more specific/i,
    /can you give (me )?a (specific )?example/i,
    /what (exactly )?happened/i,
    /when (exactly )?did (that|this|it)/i,
    /tell me (more )?about (the )?last/i,
  ]
  
  let probeCount = 0
  const recentAgentMessages = history
    .filter(m => m.sender === 'agent')
    .slice(-5)
  
  for (const msg of recentAgentMessages) {
    const isProbe = probeIndicators.some(pattern => pattern.test(msg.content))
    if (isProbe) probeCount++
  }
  
  return probeCount
}

describe('answer-vagueness-checker', () => {
  beforeEach(() => {
    resetVaguenessGuardMetrics()
  })
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

  describe('isLikelyVagueWithConfidence - Enhanced Logic', () => {
    it('should NOT flag concrete answers with typos (high confidence)', () => {
      // Concrete signals: numbers, dates, time expressions
      expect(isLikelyVagueWithConfidence('3 kere oldu geçen ay')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('Last Tuesday I had this problem')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('5 times last month')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('%50 artış oldu')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('2 hafta önce başladım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('$50 harcadım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })

    it('should flag evasive answers with typos (high confidence)', () => {
      // Evasive patterns with typos
      expect(isLikelyVagueWithConfidence('bilmyrm')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('sanrm')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('galba')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('i dont know')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('mayb')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Evasive pattern')
      })
    })

    it('should flag short vague answers with low confidence (needs LLM check)', () => {
      // Very short answers without concreteness or evasion
      // Using words that don't match any evasive patterns
      expect(isLikelyVagueWithConfidence('merhaba')).toEqual({
        vague: true,
        confidence: 'low',
        reason: 'Very short answer without concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('nasılsın')).toEqual({
        vague: true,
        confidence: 'low',
        reason: 'Very short answer without concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('görüşürüz')).toEqual({
        vague: true,
        confidence: 'low',
        reason: 'Very short answer without concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('hoşça kal')).toEqual({
        vague: true,
        confidence: 'low',
        reason: 'Very short answer without concreteness signals'
      })
    })

    it('should NOT flag normal concrete answers (high confidence)', () => {
      // Normal answers with sufficient length and no vagueness indicators
      expect(isLikelyVagueWithConfidence('Bu konuda gerçekten çok düşündüm')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'No vagueness indicators'
      })
      expect(isLikelyVagueWithConfidence('Genelde sorun yok ama bazen oluyor')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'No vagueness indicators'
      })
      expect(isLikelyVagueWithConfidence('I usually handle it this way')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'No vagueness indicators'
      })
    })

    it('should prioritize concreteness over evasive patterns', () => {
      // Even with evasive words, if there are concrete signals, it's not vague
      expect(isLikelyVagueWithConfidence('sanırım 3 kere oldu geçen ay')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('maybe 5 times last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })

    it('should flag counter-questions with high confidence', () => {
      expect(isLikelyVagueWithConfidence('Neden soruyorsun?')).toEqual({
        vague: true,
        confidence: 'high',
        reason: 'Counter-question detected'
      })
      expect(isLikelyVagueWithConfidence('How would you solve it?')).toEqual({
        vague: true,
        confidence: 'high',
        reason: 'Counter-question detected'
      })
      expect(isLikelyVagueWithConfidence('What do you mean?')).toEqual({
        vague: true,
        confidence: 'high',
        reason: 'Counter-question detected'
      })
    })

    it('should handle mixed language concreteness signals', () => {
      expect(isLikelyVagueWithConfidence('3 people last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('5 kişi geçen ay')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })

    it('should handle currency and frequency expressions', () => {
      expect(isLikelyVagueWithConfidence('100 tl harcadım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('3 kez denedim')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })

    it('should handle date formats', () => {
      expect(isLikelyVagueWithConfidence('15-01-2024')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('01/15/2024')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })

    it('should handle month and day names', () => {
      expect(isLikelyVagueWithConfidence('ocak ayında başladım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('pazartesi oldu')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('January this year')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
      expect(isLikelyVagueWithConfidence('Monday last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Concreteness signals present'
      })
    })
  })

  describe('probe limit behavior', () => {
    it('should count probe questions in history', () => {
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'Tell me about your experience' },
        { sender: 'participant', content: 'It was okay' },
        { sender: 'agent', content: 'Can you give me a specific example?' },
        { sender: 'participant', content: 'I dont know' },
        { sender: 'agent', content: 'What exactly happened the last time?' },
      ]
      
      expect(countRecentProbes(history)).toBe(2)
    })

    it('should not count non-probe questions', () => {
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'Tell me about your experience' },
        { sender: 'participant', content: 'It was okay' },
        { sender: 'agent', content: 'How do you feel about this?' },
        { sender: 'participant', content: 'Good' },
      ]
      
      expect(countRecentProbes(history)).toBe(0)
    })

    it('should enforce MAX_PROBES_PER_QUESTION limit (2)', () => {
      const MAX_PROBES_PER_QUESTION = 2
      
      // Simulate 3 vague answers in a row
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'Tell me about your experience' },
        { sender: 'participant', content: 'bilmiyorum' }, // 1st vague answer
        { sender: 'agent', content: 'Can you give me a specific example?' }, // 1st probe
        { sender: 'participant', content: 'sanırım' }, // 2nd vague answer
        { sender: 'agent', content: 'What exactly happened the last time?' }, // 2nd probe
        { sender: 'participant', content: 'galiba' }, // 3rd vague answer
      ]
      
      const currentProbeCount = countRecentProbes(history)
      
      // After 2 probes, limit is reached
      expect(currentProbeCount).toBe(MAX_PROBES_PER_QUESTION)
      
      // Should NOT generate another probe
      const shouldGenerateProbe = currentProbeCount < MAX_PROBES_PER_QUESTION
      expect(shouldGenerateProbe).toBe(false)
    })

    it('should allow probe when under limit', () => {
      const MAX_PROBES_PER_QUESTION = 2
      
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'Tell me about your experience' },
        { sender: 'participant', content: 'bilmiyorum' }, // 1st vague answer
        { sender: 'agent', content: 'Can you give me a specific example?' }, // 1st probe
        { sender: 'participant', content: 'sanırım' }, // 2nd vague answer
      ]
      
      const currentProbeCount = countRecentProbes(history)
      
      // Only 1 probe so far, under limit
      expect(currentProbeCount).toBe(1)
      
      // Should generate another probe
      const shouldGenerateProbe = currentProbeCount < MAX_PROBES_PER_QUESTION
      expect(shouldGenerateProbe).toBe(true)
    })
  })
})
