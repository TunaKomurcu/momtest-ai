import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isLikelyVague, isLikelyVagueWithConfidence, checkAnswerIsVague } from '@/lib/answer-vagueness-checker'
import { resetVaguenessGuardMetrics } from '@/lib/answer-vagueness-checker'
import type { ConversationMessage } from '@/types/index'
import OpenAI from 'openai'

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
      expect(isLikelyVague('15-01-2024')).toBe(false)
      expect(isLikelyVague('5 times')).toBe(false) // Has concreteness signals
    })

    it('should flag very short answers without concreteness signals', () => {
      expect(isLikelyVague('tamam')).toBe(true)
      expect(isLikelyVague('güzel')).toBe(true)
      expect(isLikelyVague('iyi')).toBe(true)
    })

    it('should NOT flag longer answers', () => {
      // With new logic, these go to ambiguous category (LLM check) because they lack concreteness signals
      expect(isLikelyVague('Bu konuda gerçekten çok düşündüm')).toBe(true) // Changed: now ambiguous
      expect(isLikelyVague('Genelde sorun yok ama bazen oluyor')).toBe(true) // Changed: now ambiguous
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
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('Last Tuesday I had this problem')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('5 times last month')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('%50 artış oldu')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('2 hafta önce başladım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('$50 harcadım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })

    it('should route evasive answers with typos to LLM check (ambiguous category)', () => {
      // Evasive patterns with typos - longer phrases go to LLM check (ambiguous category)
      expect(isLikelyVagueWithConfidence('bilmiyorum sanırım')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('sanırım emin değilim')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('galiba belki öyledir')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('i dont know maybe')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('probably not sure')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
    })

    it('should flag short vague answers with high confidence (confidently vague)', () => {
      // Very short answers without concreteness signals AND evasive pattern → confidently vague
      expect(isLikelyVagueWithConfidence('evet')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Confidently vague: very short with evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('hayır')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Confidently vague: very short with evasive pattern')
      })
      expect(isLikelyVagueWithConfidence('sanırım')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Confidently vague: very short with evasive pattern')
      })
      // "bilmiyorum" is 9 chars, should be confidently vague
      expect(isLikelyVagueWithConfidence('bilmiyorum')).toEqual({
        vague: true,
        confidence: 'high',
        reason: expect.stringContaining('Confidently vague: very short with evasive pattern')
      })
    })

    it('should route short answers without evasive patterns to LLM check (ambiguous)', () => {
      // Very short answers without evasive patterns → ambiguous category (LLM check)
      expect(isLikelyVagueWithConfidence('merhaba')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('nasılsın')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('görüşürüz')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('hoşça kal')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
    })

    it('should route normal answers without concreteness to LLM check (ambiguous)', () => {
      // Normal answers without concreteness signals → ambiguous category
      expect(isLikelyVagueWithConfidence('Bu konuda gerçekten çok düşündüm')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('Genelde sorun yok ama bazen oluyor')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('I usually handle it this way')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
    })

    it('should prioritize concreteness over evasive patterns (confidently concrete)', () => {
      // Even with evasive words, if there are concrete signals and not very short → confidently concrete
      expect(isLikelyVagueWithConfidence('sanırım 3 kere oldu geçen ay')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('maybe 5 times last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })

    it('should route counter-questions to LLM check (ambiguous category)', () => {
      // Counter-questions → ambiguous category (send to LLM check)
      expect(isLikelyVagueWithConfidence('Neden soruyorsun?')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('How would you solve it?')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
      expect(isLikelyVagueWithConfidence('What do you mean?')).toEqual({
        vague: true,
        confidence: 'low',
        reason: expect.stringContaining('Ambiguous')
      })
    })

    it('should handle mixed language concreteness signals (confidently concrete)', () => {
      expect(isLikelyVagueWithConfidence('3 people last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('5 kişi geçen ay')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })

    it('should handle currency and frequency expressions (confidently concrete)', () => {
      expect(isLikelyVagueWithConfidence('100 tl harcadım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('3 kez denedim')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })

    it('should handle date formats (confidently concrete)', () => {
      expect(isLikelyVagueWithConfidence('15-01-2024')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('01/15/2024')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })

    it('should handle month and day names (confidently concrete)', () => {
      expect(isLikelyVagueWithConfidence('ocak ayında başladım')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('pazartesi oldu')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('January this year')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
      expect(isLikelyVagueWithConfidence('Monday last week')).toEqual({
        vague: false,
        confidence: 'high',
        reason: 'Confidently concrete: has concreteness signals'
      })
    })
  })

  describe('isLikelyVagueWithConfidence - Meaning-Based Evasive Phrases', () => {
    it('should route meaning-based evasive phrases to LLM check (ambiguous category)', () => {
      // These phrases are evasive by meaning but not in EVASIVE_PATTERNS
      // They should fall into "ambiguous" category and go to LLM check
      const meaningBasedEvasive = [
        'açıkçası pek takip etmedim o konuyu',
        'aslında çok da emin değilim',
        'bu konuda pek bilgim yok',
        'genel olarak pek bir şey söyleyemem',
        'tam olarak hatırlamıyorum ama sanırım',
      ]

      meaningBasedEvasive.forEach(phrase => {
        const result = isLikelyVagueWithConfidence(phrase)
        expect(result.vague).toBe(true)
        expect(result.confidence).toBe('low')
        expect(result.reason).toContain('Ambiguous')
      })
    })

    it('should route meaning-based concrete phrases to LLM check (ambiguous category)', () => {
      // These phrases are concrete by meaning but not obviously so (no numbers/dates)
      // They should fall into "ambiguous" category and go to LLM check
      const meaningBasedConcrete = [
        'bir toplantıda konuştuk', // no time expression
        'ofiste bir sorun yaşadık', // no time expression
        'bir müşteriyle görüştüm', // no time expression
      ]

      meaningBasedConcrete.forEach(phrase => {
        const result = isLikelyVagueWithConfidence(phrase)
        expect(result.vague).toBe(true)
        expect(result.confidence).toBe('low')
        expect(result.reason).toContain('Ambiguous')
      })
    })

    it('should mock LLM check for meaning-based phrases', async () => {
      // Mock OpenAI client
      const mockOpenAI = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: '{"isVague": true, "reason": "Lacks specific details"}'
                }
              }]
            })
          }
        }
      } as unknown as OpenAI

      const result = await checkAnswerIsVague(
        'What is your experience?',
        'açıkçası pek takip etmedim o konuyu',
        mockOpenAI,
        undefined,
        '[Test/vagueness]'
      )

      expect(result.isVague).toBe(true)
      expect(result.reason).toBe('Lacks specific details')
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
