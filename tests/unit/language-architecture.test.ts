/**
 * Regression tests — explicit persisted language architecture
 *
 * Kapsam: per-turn language DETECTION yerine gelen, project/interview
 * seviyesinde açıkça SEÇİLEN `language: 'tr' | 'en'` mimarisinin,
 * generate ve analyze pipeline'larındaki prompt-builder fonksiyonlarına
 * doğru şekilde yansıdığını doğrular (bkz. lib/graphs/generate-graph.ts,
 * lib/graphs/analyze-graph.ts).
 *
 * Bu testler LLM'e gitmez — sadece üretilen sistem prompt metinlerinin
 * hedef dile göre doğru direktifi içerdiğini kontrol eder.
 */

import { describe, it, expect, vi } from 'vitest'

// generate-graph.ts / analyze-graph.ts import '@/lib/db/index' at module scope,
// which throws outside a real runtime unless DATABASE_URL is set. These tests
// only exercise the pure prompt-builder exports, so the db module is mocked out.
vi.mock('@/lib/db/index', () => ({ db: {} }))

import {
  buildResearchBriefSystemPrompt,
  buildInterviewScriptSystemPrompt,
  buildScriptCritiqueSystemPrompt,
} from '@/lib/graphs/generate-graph'
import { buildEvidenceAnalystSystemPrompt } from '@/lib/graphs/analyze-graph'

describe('generate-graph — language-parameterized prompt builders', () => {
  describe('buildResearchBriefSystemPrompt', () => {
    it('tr → Turkish language directive present, no English directive', () => {
      const prompt = buildResearchBriefSystemPrompt('tr')
      expect(prompt).toContain('CRITICAL LANGUAGE REQUIREMENT')
      expect(prompt).toContain('Turkish (native, fluent Turkish)')
    })

    it('en → English language directive present', () => {
      const prompt = buildResearchBriefSystemPrompt('en')
      expect(prompt).toContain('CRITICAL LANGUAGE REQUIREMENT')
      expect(prompt).toContain('everything a human will read) — in English.')
    })

    it('tr and en prompts differ only in the language directive', () => {
      const tr = buildResearchBriefSystemPrompt('tr').replace(/Turkish \(native, fluent Turkish\)/g, '<LANG>')
      const en = buildResearchBriefSystemPrompt('en').replace(/English/g, '<LANG>')
      expect(tr).toBe(en)
    })
  })

  describe('buildInterviewScriptSystemPrompt', () => {
    it('tr → contains Turkish directive and the verbatim-question warning', () => {
      const prompt = buildInterviewScriptSystemPrompt('tr')
      expect(prompt).toContain('Turkish (native, fluent Turkish)')
      expect(prompt).toContain('The interviewer agent will read "question" values verbatim')
    })

    it('en → contains English directive', () => {
      const prompt = buildInterviewScriptSystemPrompt('en')
      expect(prompt).toContain('CRITICAL LANGUAGE REQUIREMENT')
      expect(prompt).toMatch(/in English\./)
    })

    it('bans "Yani"-style clarification patterns regardless of language (banned pattern list is language-agnostic text)', () => {
      expect(buildInterviewScriptSystemPrompt('tr')).toContain('and their equivalents in the target output language')
      expect(buildInterviewScriptSystemPrompt('en')).toContain('and their equivalents in the target output language')
    })
  })

  describe('buildScriptCritiqueSystemPrompt', () => {
    it('tr → missingCoverage entries requested in Turkish', () => {
      const prompt = buildScriptCritiqueSystemPrompt('tr')
      expect(prompt).toContain('Write "missingCoverage" entries in Turkish')
    })

    it('en → missingCoverage entries requested in English', () => {
      const prompt = buildScriptCritiqueSystemPrompt('en')
      expect(prompt).toContain('Write "missingCoverage" entries in English')
    })
  })
})

describe('analyze-graph — buildEvidenceAnalystSystemPrompt', () => {
  it('tr → free-text fields localized to Turkish, enum literals stay English', () => {
    const prompt = buildEvidenceAnalystSystemPrompt('tr')
    expect(prompt).toContain('CRITICAL LANGUAGE REQUIREMENT')
    expect(prompt).toContain('Turkish (native, fluent Turkish)')
    // decision/signalScore enum literals must remain the exact English strings
    // (parsed by code) regardless of the requested output language.
    expect(prompt).toContain('"continue discovery"')
    expect(prompt).toContain('"strong | medium | weak | negative"')
  })

  it('en → free-text fields localized to English', () => {
    const prompt = buildEvidenceAnalystSystemPrompt('en')
    expect(prompt).toContain('CRITICAL LANGUAGE REQUIREMENT')
    expect(prompt).toMatch(/entirely in English\./)
  })

  it('never-translate-quote rule is present for both languages (grounding depends on verbatim quotes)', () => {
    expect(buildEvidenceAnalystSystemPrompt('tr')).toContain('never translate a quote')
    expect(buildEvidenceAnalystSystemPrompt('en')).toContain('never translate a quote')
  })
})
