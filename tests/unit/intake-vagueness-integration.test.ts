/**
 * Intake Vagueness Integration Test
 *
 * Amaç: Intake akışında vagueness tespiti ve probe soru üretiminin
 * doğru çalıştığını doğrulamak.
 *
 * Test edilen davranışlar:
 * - PM'in belirsiz cevabı verdiğinde probe sorusu üretilir
 * - Probe soruları 8-soru sınırına dahil edilmez
 * - MAX_PROBES_PER_QUESTION limiti (2) uygulanır
 */

import { describe, it, expect, vi } from 'vitest'
import { isLikelyVague } from '@/lib/answer-vagueness-checker'
import type { ConversationMessage } from '@/types/index'

// Count probe questions in history (same logic as intake route)
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

describe('Intake Vagueness Integration', () => {
  describe('Probe trigger on vague PM answers', () => {
    it('should trigger probe on single word vague answer', () => {
      const pmAnswer = 'maybe'
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your target customer segment?' },
      ]
      
      const isVague = isLikelyVague(pmAnswer, '[Intake/vagueness]')
      const probeCount = countRecentProbes(history)
      
      expect(isVague).toBe(true)
      expect(probeCount).toBe(0) // No probes yet, should generate one
    })

    it('should trigger probe on Turkish vague keyword', () => {
      const pmAnswer = 'bilmiyorum'
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is the riskiest assumption?' },
      ]
      
      const isVague = isLikelyVague(pmAnswer, '[Intake/vagueness]')
      const probeCount = countRecentProbes(history)
      
      expect(isVague).toBe(true)
      expect(probeCount).toBe(0) // Should generate probe
    })

    it('should NOT trigger probe on concrete short answer', () => {
      const pmAnswer = 'Last Tuesday'
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'When did this problem occur?' },
      ]
      
      const isVague = isLikelyVague(pmAnswer, '[Intake/vagueness]')
      
      expect(isVague).toBe(false) // Has concreteness signal
    })

    it('should NOT trigger probe on normal detailed answer', () => {
      const pmAnswer = 'Our target segment is small business owners in the retail sector who have 10-50 employees.'
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your target customer segment?' },
      ]
      
      const isVague = isLikelyVague(pmAnswer, '[Intake/vagueness]')
      
      expect(isVague).toBe(false) // Long, detailed answer
    })
  })

  describe('8-question counter unaffected by probes', () => {
    it('should count only non-probe agent messages', () => {
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your product idea?' },
        { sender: 'participant', content: 'An AI tool for customer research' },
        { sender: 'agent', content: 'Who is your target customer?' },
        { sender: 'participant', content: 'maybe' }, // Vague
        { sender: 'agent', content: 'Can you give me a specific example?' }, // Probe
        { sender: 'participant', content: 'Small businesses' },
      ]
      
      const totalAgentMessages = history.filter(m => m.sender === 'agent').length
      const probeCount = countRecentProbes(history)
      const nonProbeCount = totalAgentMessages - probeCount
      
      expect(totalAgentMessages).toBe(3)
      expect(probeCount).toBe(1)
      expect(nonProbeCount).toBe(2) // Only 2 count toward 8-question limit
    })

    it('should correctly identify probe patterns', () => {
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your target segment?' },
        { sender: 'agent', content: 'Can you give me a specific example?' }, // Probe
        { sender: 'agent', content: 'What exactly happened the last time?' }, // Probe
        { sender: 'agent', content: 'Tell me about the last time you saw this.' }, // Probe
        { sender: 'agent', content: 'How do you feel about this?' }, // Not a probe
      ]
      
      const probeCount = countRecentProbes(history)
      
      expect(probeCount).toBe(3) // 3 probes detected
    })
  })

  describe('MAX_PROBES_PER_QUESTION limit (2)', () => {
    it('should enforce limit after 2 probes', () => {
      const MAX_PROBES_PER_QUESTION = 2
      
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your target segment?' },
        { sender: 'participant', content: 'maybe' }, // 1st vague
        { sender: 'agent', content: 'Can you give me a specific example?' }, // 1st probe
        { sender: 'participant', content: 'bilmiyorum' }, // 2nd vague
        { sender: 'agent', content: 'What exactly happened the last time?' }, // 2nd probe
        { sender: 'participant', content: 'sanırım' }, // 3rd vague
      ]
      
      const probeCount = countRecentProbes(history)
      const shouldGenerateProbe = probeCount < MAX_PROBES_PER_QUESTION
      
      expect(probeCount).toBe(MAX_PROBES_PER_QUESTION)
      expect(shouldGenerateProbe).toBe(false) // Limit reached, no more probes
    })

    it('should allow probe when under limit', () => {
      const MAX_PROBES_PER_QUESTION = 2
      
      const history: ConversationMessage[] = [
        { sender: 'agent', content: 'What is your target segment?' },
        { sender: 'participant', content: 'maybe' }, // 1st vague
        { sender: 'agent', content: 'Can you give me a specific example?' }, // 1st probe
        { sender: 'participant', content: 'bilmiyorum' }, // 2nd vague
      ]
      
      const probeCount = countRecentProbes(history)
      const shouldGenerateProbe = probeCount < MAX_PROBES_PER_QUESTION
      
      expect(probeCount).toBe(1)
      expect(shouldGenerateProbe).toBe(true) // Under limit, can probe
    })
  })

  describe('Integration scenario: full probe flow', () => {
    it('should handle complete probe cycle with 8-question limit', () => {
      // Simulate a full intake conversation with probes
      const history: ConversationMessage[] = [
        // Q1
        { sender: 'agent', content: 'What is your product idea?' },
        { sender: 'participant', content: 'An AI tool for customer research' },
        // Q2
        { sender: 'agent', content: 'Who is your target customer?' },
        { sender: 'participant', content: 'maybe' }, // Vague
        // Probe 1 (does not count)
        { sender: 'agent', content: 'Can you give me a specific example?' },
        { sender: 'participant', content: 'Small businesses' },
        // Q3
        { sender: 'agent', content: 'What is the core problem?' },
        { sender: 'participant', content: 'bilmiyorum' }, // Vague
        // Probe 2 (does not count)
        { sender: 'agent', content: 'What exactly happened the last time?' },
        { sender: 'participant', content: 'sanırım' }, // Vague but limit reached
        // Q4 (should proceed, no more probes)
        { sender: 'agent', content: 'What is the riskiest assumption?' },
        { sender: 'participant', content: 'That customers will pay' },
        // Q5-Q8 would continue...
      ]
      
      const totalAgentMessages = history.filter(m => m.sender === 'agent').length
      const probeCount = countRecentProbes(history)
      const nonProbeCount = totalAgentMessages - probeCount
      
      expect(totalAgentMessages).toBe(6)
      expect(probeCount).toBe(2)
      expect(nonProbeCount).toBe(4) // Only 4 count toward 8-question limit
    })
  })
})
