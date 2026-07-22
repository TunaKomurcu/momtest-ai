/**
 * Unit tests — lib/ai-guards/script-critique-validator.ts
 *
 * Kapsam:
 * - alignmentScore number / range kontrolleri
 * - missingCoverage array ve içerik validasyonu
 * - geçerli ScriptCritique çıktısının kabul edilmesi
 */

import { describe, it, expect } from 'vitest'
import { validateScriptCritique } from '@/lib/ai-guards/script-critique-validator'

describe('validateScriptCritique', () => {
  it('geçerli ScriptCritique objesi → ok:true', () => {
    const result = validateScriptCritique({ alignmentScore: 85, missingCoverage: ['PM budget signal'] })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok')
    expect(result.value.alignmentScore).toBe(85)
    expect(result.value.missingCoverage).toEqual(['PM budget signal'])
  })

  it('alignmentScore sayi değil → fail', () => {
    const result = validateScriptCritique({ alignmentScore: '80', missingCoverage: ['risk'] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected fail')
    expect(result.issues.some((i) => i.includes('alignmentScore'))).toBe(true)
  })

  it('alignmentScore 100 altı / 0 üstü sayi → pass', () => {
    const result = validateScriptCritique({ alignmentScore: 0, missingCoverage: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok')
    expect(result.value.alignmentScore).toBe(0)
  })

  it('alignmentScore 100 uzeri → fail', () => {
    const result = validateScriptCritique({ alignmentScore: 101, missingCoverage: [] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected fail')
    expect(result.issues).toContain('alignmentScore must be between 0 and 100')
  })

  it('missingCoverage string dizisi degil → fail', () => {
    const result = validateScriptCritique({ alignmentScore: 75, missingCoverage: ['one', 2] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected fail')
    expect(result.issues.some((i) => i.includes('missingCoverage'))).toBe(true)
  })
})
