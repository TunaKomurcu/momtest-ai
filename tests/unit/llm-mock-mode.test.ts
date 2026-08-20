import { describe, it, expect, afterEach } from 'vitest'
import {
  isMockLLMMode,
  getMockIntakeReply,
  getMockGeneratePayload,
  getMockInterviewReply,
} from '@/lib/llm/mock'

describe('LLM mock mode', () => {
  const original = process.env.APP_LLM_MODE

  afterEach(() => {
    if (typeof original === 'string') {
      process.env.APP_LLM_MODE = original
    } else {
      delete process.env.APP_LLM_MODE
    }
  })

  it('detects mock mode when APP_LLM_MODE is mock', () => {
    process.env.APP_LLM_MODE = 'mock'
    expect(isMockLLMMode()).toBe(true)
  })

  it('returns a deterministic intake research brief in mock mode', () => {
    process.env.APP_LLM_MODE = 'mock'
    const reply = getMockIntakeReply('A workflow app for teams')

    expect(reply).toContain('<research_brief>')
    expect(reply).toContain('researchGoal')
    expect(reply).toContain('A workflow app for teams')
  })

  it('returns a generate payload with brief and script in mock mode', () => {
    process.env.APP_LLM_MODE = 'mock'
    const payload = getMockGeneratePayload('task tracking app')

    expect(payload.brief.productIdea).toContain('task tracking app')
    expect(payload.script.questions.length).toBeGreaterThan(0)
  })

  it('returns a safe interview reply in mock mode', () => {
    process.env.APP_LLM_MODE = 'mock'
    const reply = getMockInterviewReply('What did you do last time?')

    expect(reply).toContain('last time')
    expect(reply.length).toBeGreaterThan(20)
  })
})
