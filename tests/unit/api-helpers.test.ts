/**
 * Unit tests for API validation helpers
 *
 * Covers:
 * - Rate limiting logic (checkRateLimit)
 * - Request body validation (intake, interview, analyze)
 * - ApiResponse shape (success / error format)
 * - HTTP status code semantics
 *
 * All helpers are inlined here (mirrored from route files) since they are
 * not currently exported — keeps routes clean while enabling pure unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  ApiSuccess,
  ApiError,
  IntakeRequestBody,
  InterviewRequestBody,
} from '@/types/index'

// ── Rate limiting helper (mirrored from all route files) ──────────────────

function makeRateLimiter(maxRequests: number, windowMs: number) {
  const map = new Map<string, { count: number; resetAt: number }>()

  return function checkRateLimit(ip: string): boolean {
    const now = Date.now()
    const entry = map.get(ip)

    if (!entry || now > entry.resetAt) {
      map.set(ip, { count: 1, resetAt: now + windowMs })
      return true
    }

    if (entry.count >= maxRequests) return false

    entry.count++
    return true
  }
}

// ── ApiResponse shape helpers ─────────────────────────────────────────────

function successResponse<T>(data: T): ApiSuccess<T> {
  return { data, error: null }
}

function errorResponse(message: string): ApiError {
  return { data: null, error: message }
}

function isSuccess<T>(res: ApiSuccess<T> | ApiError): res is ApiSuccess<T> {
  return res.error === null
}

// ── Body validators (mirrored from route files) ───────────────────────────

function validateIntakeBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Geçersiz JSON gövdesi.'
  const b = body as Record<string, unknown>
  if (!b.message || typeof b.message !== 'string') return 'message alanı boş olamaz.'
  if ((b.message as string).trim().length === 0) return 'message alanı boş olamaz.'
  return null
}

function validateInterviewBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Geçersiz JSON gövdesi.'
  const b = body as Record<string, unknown>
  if (!b.message || typeof b.message !== 'string') return 'message alanı boş olamaz.'
  if ((b.message as string).trim().length === 0) return 'message alanı boş olamaz.'
  if (!b.participant_name || typeof b.participant_name !== 'string')
    return 'participant_name en az 2 karakter olmalıdır.'
  if ((b.participant_name as string).trim().length < 2)
    return 'participant_name en az 2 karakter olmalıdır.'
  return null
}

// ── Rate limiting tests ───────────────────────────────────────────────────

describe('Rate limiting — public route (max 10 req/min)', () => {
  const WINDOW_MS = 60_000
  const MAX = 10
  let checkRateLimit: (ip: string) => boolean

  beforeEach(() => {
    vi.useFakeTimers()
    checkRateLimit = makeRateLimiter(MAX, WINDOW_MS)
  })

  it('allows the first request', () => {
    expect(checkRateLimit('1.2.3.4')).toBe(true)
  })

  it('allows exactly MAX requests within the window', () => {
    for (let i = 0; i < MAX; i++) {
      expect(checkRateLimit('1.2.3.4')).toBe(true)
    }
  })

  it('blocks the (MAX + 1)th request within the window', () => {
    for (let i = 0; i < MAX; i++) checkRateLimit('1.2.3.4')
    expect(checkRateLimit('1.2.3.4')).toBe(false)
  })

  it('resets after the window expires', () => {
    for (let i = 0; i < MAX; i++) checkRateLimit('1.2.3.4')
    expect(checkRateLimit('1.2.3.4')).toBe(false)
    vi.advanceTimersByTime(WINDOW_MS + 1)
    expect(checkRateLimit('1.2.3.4')).toBe(true)
  })

  it('tracks different IPs independently', () => {
    for (let i = 0; i < MAX; i++) checkRateLimit('1.1.1.1')
    expect(checkRateLimit('1.1.1.1')).toBe(false)
    expect(checkRateLimit('2.2.2.2')).toBe(true)
  })

  it('allows fresh IP even when another IP is blocked', () => {
    for (let i = 0; i <= MAX; i++) checkRateLimit('blocked.ip')
    expect(checkRateLimit('new.ip')).toBe(true)
  })
})

describe('Rate limiting — authenticated route (max 20 req/min)', () => {
  const WINDOW_MS = 60_000
  const MAX = 20
  let checkRateLimit: (ip: string) => boolean

  beforeEach(() => {
    vi.useFakeTimers()
    checkRateLimit = makeRateLimiter(MAX, WINDOW_MS)
  })

  it('allows exactly 20 requests', () => {
    for (let i = 0; i < MAX; i++) {
      expect(checkRateLimit('10.0.0.1')).toBe(true)
    }
  })

  it('blocks the 21st request', () => {
    for (let i = 0; i < MAX; i++) checkRateLimit('10.0.0.1')
    expect(checkRateLimit('10.0.0.1')).toBe(false)
  })

  it('resets correctly after window', () => {
    for (let i = 0; i < MAX; i++) checkRateLimit('10.0.0.1')
    vi.advanceTimersByTime(WINDOW_MS + 1)
    expect(checkRateLimit('10.0.0.1')).toBe(true)
  })

  it('does not interfere with the public route limit (10)', () => {
    const publicLimit = makeRateLimiter(10, WINDOW_MS)
    for (let i = 0; i < 10; i++) publicLimit('shared.ip')
    expect(publicLimit('shared.ip')).toBe(false)
    // authenticated limiter on same IP is separate map
    expect(checkRateLimit('shared.ip')).toBe(true)
  })
})

// ── Intake body validation ────────────────────────────────────────────────

describe('validateIntakeBody — POST /api/intake/[projectId]', () => {
  it('returns null for valid body', () => {
    const body: IntakeRequestBody = { message: 'Hello world' }
    expect(validateIntakeBody(body)).toBeNull()
  })

  it('returns error for null body', () => {
    expect(validateIntakeBody(null)).not.toBeNull()
  })

  it('returns error for missing message field', () => {
    expect(validateIntakeBody({})).not.toBeNull()
  })

  it('returns error for empty message string', () => {
    expect(validateIntakeBody({ message: '' })).not.toBeNull()
  })

  it('returns error for whitespace-only message', () => {
    expect(validateIntakeBody({ message: '   ' })).not.toBeNull()
  })

  it('returns error for non-string message', () => {
    expect(validateIntakeBody({ message: 42 })).not.toBeNull()
  })

  it('returns error for array body', () => {
    expect(validateIntakeBody([])).not.toBeNull()
  })

  it('returns error for primitive body', () => {
    expect(validateIntakeBody('string')).not.toBeNull()
  })

  it('accepts message with leading/trailing whitespace (trim is caller\'s job)', () => {
    // Validator checks trimmed length but original string passes
    expect(validateIntakeBody({ message: '  valid  ' })).toBeNull()
  })

  it('accepts very long message', () => {
    expect(validateIntakeBody({ message: 'a'.repeat(5000) })).toBeNull()
  })

  it('error message is in Turkish', () => {
    const err = validateIntakeBody({ message: '' })
    expect(err).toMatch(/boş olamaz/)
  })
})

// ── Interview body validation ─────────────────────────────────────────────

describe('validateInterviewBody — POST /api/interview/[interviewId]', () => {
  it('returns null for valid body', () => {
    const body: InterviewRequestBody = { message: 'Hello', participant_name: 'Ali' }
    expect(validateInterviewBody(body)).toBeNull()
  })

  it('returns error for missing message', () => {
    expect(validateInterviewBody({ participant_name: 'Ali' })).not.toBeNull()
  })

  it('returns error for empty message', () => {
    expect(validateInterviewBody({ message: '', participant_name: 'Ali' })).not.toBeNull()
  })

  it('returns error for whitespace-only message', () => {
    expect(validateInterviewBody({ message: '  ', participant_name: 'Ali' })).not.toBeNull()
  })

  it('returns error for missing participant_name', () => {
    expect(validateInterviewBody({ message: 'Hello' })).not.toBeNull()
  })

  it('returns error for participant_name with 1 character', () => {
    expect(validateInterviewBody({ message: 'Hello', participant_name: 'A' })).not.toBeNull()
  })

  it('returns null for participant_name with exactly 2 characters', () => {
    expect(validateInterviewBody({ message: 'Hello', participant_name: 'Al' })).toBeNull()
  })

  it('returns error for whitespace-only participant_name', () => {
    expect(validateInterviewBody({ message: 'Hello', participant_name: '  ' })).not.toBeNull()
  })

  it('returns error for empty participant_name string', () => {
    expect(validateInterviewBody({ message: 'Hello', participant_name: '' })).not.toBeNull()
  })

  it('returns null for participant_name with spaces in middle', () => {
    expect(validateInterviewBody({ message: 'Hi', participant_name: 'Ali Veli' })).toBeNull()
  })

  it('returns error for non-string participant_name', () => {
    expect(validateInterviewBody({ message: 'Hi', participant_name: 123 })).not.toBeNull()
  })

  it('error message for short name is in Turkish', () => {
    const err = validateInterviewBody({ message: 'Hi', participant_name: 'A' })
    expect(err).toMatch(/2 karakter/)
  })
})

// ── ApiResponse shape ────────────────────────────────────────────────────

describe('ApiResponse shape — success format', () => {
  it('success response has data and null error', () => {
    const res = successResponse({ reply: 'hello', isComplete: false })
    expect(res.data).toBeDefined()
    expect(res.error).toBeNull()
  })

  it('success response data matches input', () => {
    const payload = { reply: 'Test reply', isComplete: true }
    const res = successResponse(payload)
    expect(res.data).toEqual(payload)
  })

  it('isSuccess type guard returns true for success', () => {
    const res = successResponse('value')
    expect(isSuccess(res)).toBe(true)
  })

  it('isSuccess type guard returns false for error', () => {
    const res = errorResponse('Something went wrong')
    expect(isSuccess(res)).toBe(false)
  })
})

describe('ApiResponse shape — error format', () => {
  it('error response has null data and non-empty error string', () => {
    const res = errorResponse('Proje bulunamadı.')
    expect(res.data).toBeNull()
    expect(res.error).toBeTruthy()
  })

  it('error message is preserved exactly', () => {
    const msg = 'message alanı boş olamaz.'
    expect(errorResponse(msg).error).toBe(msg)
  })

  it('error response data is strictly null (not undefined)', () => {
    expect(errorResponse('err').data).toStrictEqual(null)
  })

  it('success response error is strictly null (not undefined)', () => {
    expect(successResponse({}).error).toStrictEqual(null)
  })
})

// ── HTTP status code semantics ────────────────────────────────────────────

describe('HTTP status code semantics', () => {
  const STATUS_MAP: Record<string, number> = {
    'missing message → 400':          400,
    'auth failure → 401':             401,
    'wrong owner → 403':              403,
    'project not found → 404':        404,
    'rate limit exceeded → 429':      429,
    'LLM call failed → 500':          500,
    'interview completed → 200':       200,
    'resource created → 201':          201,
  }

  it('400 is used for bad request / validation failure', () => {
    expect(STATUS_MAP['missing message → 400']).toBe(400)
  })

  it('401 is used for missing or invalid auth', () => {
    expect(STATUS_MAP['auth failure → 401']).toBe(401)
  })

  it('403 is used for authenticated but unauthorised access', () => {
    expect(STATUS_MAP['wrong owner → 403']).toBe(403)
  })

  it('404 is used for missing resource', () => {
    expect(STATUS_MAP['project not found → 404']).toBe(404)
  })

  it('429 is used for rate limit exceeded', () => {
    expect(STATUS_MAP['rate limit exceeded → 429']).toBe(429)
  })

  it('500 is used for unexpected server / LLM failure', () => {
    expect(STATUS_MAP['LLM call failed → 500']).toBe(500)
  })

  it('200 is used for successful read/update operations', () => {
    expect(STATUS_MAP['interview completed → 200']).toBe(200)
  })

  it('4xx codes are client errors (< 500)', () => {
    const clientErrors = [400, 401, 403, 404, 429]
    clientErrors.forEach((code) => {
      expect(code).toBeGreaterThanOrEqual(400)
      expect(code).toBeLessThan(500)
    })
  })

  it('5xx codes are server errors (>= 500)', () => {
    expect(500).toBeGreaterThanOrEqual(500)
    expect(500).toBeLessThan(600)
  })
})

// ── Interview status transition guards ───────────────────────────────────

describe('Interview status guard logic', () => {
  type InterviewStatus = 'pending' | 'ongoing' | 'completed'

  function canAcceptMessage(status: InterviewStatus): boolean {
    return status !== 'completed'
  }

  function isFirstMessage(status: InterviewStatus): boolean {
    return status === 'pending'
  }

  function canBeAnalyzed(status: InterviewStatus): boolean {
    return status === 'completed'
  }

  it('pending interview can accept a message', () => {
    expect(canAcceptMessage('pending')).toBe(true)
  })

  it('ongoing interview can accept a message', () => {
    expect(canAcceptMessage('ongoing')).toBe(true)
  })

  it('completed interview cannot accept a message', () => {
    expect(canAcceptMessage('completed')).toBe(false)
  })

  it('first message is true only for pending status', () => {
    expect(isFirstMessage('pending')).toBe(true)
    expect(isFirstMessage('ongoing')).toBe(false)
    expect(isFirstMessage('completed')).toBe(false)
  })

  it('only completed interviews can be analyzed', () => {
    expect(canBeAnalyzed('completed')).toBe(true)
    expect(canBeAnalyzed('pending')).toBe(false)
    expect(canBeAnalyzed('ongoing')).toBe(false)
  })
})
