/**
 * Unit tests for lib/project-status.ts
 *
 * Covers:
 * - deriveProjectStatus: all 4 status transitions + priority order
 * - isIntakeActive: which statuses allow intake chat
 * - PROJECT_STATUS_META: all 4 statuses have required label/badgeClass/dotClass
 */

import { describe, it, expect } from 'vitest'
import {
  deriveProjectStatus,
  isIntakeActive,
  PROJECT_STATUS_META,
  type ProjectStatus,
} from '@/lib/project-status'

// ── deriveProjectStatus ────────────────────────────────────────────────────

describe('deriveProjectStatus', () => {
  describe('intake state', () => {
    it('returns "intake" when research_brief and interview_script are both null', () => {
      expect(
        deriveProjectStatus({ research_brief: null, interview_script: null }, [])
      ).toBe('intake')
    })

    it('returns "intake" when both fields are null and interviews arg is omitted', () => {
      expect(
        deriveProjectStatus({ research_brief: null, interview_script: null })
      ).toBe('intake')
    })

    it('returns "intake" even if interview_script is present but research_brief is null', () => {
      // interview_script alone does not advance status
      expect(
        deriveProjectStatus({ research_brief: null, interview_script: { questions: [] } }, [])
      ).toBe('intake')
    })
  })

  describe('brief_ready state', () => {
    it('returns "brief_ready" when research_brief is set and no interviews exist', () => {
      expect(
        deriveProjectStatus({ research_brief: { goal: 'test' }, interview_script: null }, [])
      ).toBe('brief_ready')
    })

    it('returns "brief_ready" when both brief and script are set but no interviews', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: { questions: [] } },
          []
        )
      ).toBe('brief_ready')
    })

    it('uses any truthy value for research_brief (empty object counts)', () => {
      expect(
        deriveProjectStatus({ research_brief: {}, interview_script: null }, [])
      ).toBe('brief_ready')
    })
  })

  describe('interviewing state', () => {
    it('returns "interviewing" when at least one interview exists and none are analyzed', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: null },
          [{ evidence_report: null, signal_score: null }]
        )
      ).toBe('interviewing')
    })

    it('returns "interviewing" with multiple non-analyzed interviews', () => {
      expect(
        deriveProjectStatus(
          { research_brief: null, interview_script: null },
          [
            { evidence_report: null, signal_score: null },
            { evidence_report: null, signal_score: null },
            { evidence_report: null, signal_score: null },
          ]
        )
      ).toBe('interviewing')
    })

    it('returns "interviewing" even when research_brief is null', () => {
      // interviews array drives the status regardless of brief
      expect(
        deriveProjectStatus(
          { research_brief: null, interview_script: null },
          [{ evidence_report: null, signal_score: null }]
        )
      ).toBe('interviewing')
    })
  })

  describe('analyzed state', () => {
    it('returns "analyzed" when at least one interview has evidence_report', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: null },
          [{ evidence_report: '# Report', signal_score: null }]
        )
      ).toBe('analyzed')
    })

    it('returns "analyzed" when at least one interview has signal_score', () => {
      expect(
        deriveProjectStatus(
          { research_brief: null, interview_script: null },
          [{ evidence_report: null, signal_score: { strong: [], weak: [] } }]
        )
      ).toBe('analyzed')
    })

    it('returns "analyzed" when one of several interviews has evidence_report', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: null },
          [
            { evidence_report: null, signal_score: null },
            { evidence_report: '# Report', signal_score: null },
            { evidence_report: null, signal_score: null },
          ]
        )
      ).toBe('analyzed')
    })

    it('returns "analyzed" when both evidence_report and signal_score are present', () => {
      expect(
        deriveProjectStatus(
          { research_brief: null, interview_script: null },
          [{ evidence_report: '# R', signal_score: { strong: [] } }]
        )
      ).toBe('analyzed')
    })
  })

  describe('priority order', () => {
    it('"analyzed" takes priority over "interviewing"', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: null },
          [
            { evidence_report: null, signal_score: null },
            { evidence_report: '# Report', signal_score: null },
          ]
        )
      ).toBe('analyzed')
    })

    it('"analyzed" takes priority even when research_brief is null', () => {
      expect(
        deriveProjectStatus(
          { research_brief: null, interview_script: null },
          [{ evidence_report: '# Report', signal_score: null }]
        )
      ).toBe('analyzed')
    })

    it('"interviewing" takes priority over "brief_ready"', () => {
      expect(
        deriveProjectStatus(
          { research_brief: { goal: 'test' }, interview_script: null },
          [{ evidence_report: null, signal_score: null }]
        )
      ).toBe('interviewing')
    })

    it('"brief_ready" takes priority over "intake"', () => {
      expect(
        deriveProjectStatus({ research_brief: { goal: 'test' }, interview_script: null }, [])
      ).toBe('brief_ready')
    })
  })
})

// ── isIntakeActive ─────────────────────────────────────────────────────────

describe('isIntakeActive', () => {
  it('returns true for "intake"', () => {
    expect(isIntakeActive('intake')).toBe(true)
  })

  it('returns true for "brief_ready"', () => {
    expect(isIntakeActive('brief_ready')).toBe(true)
  })

  it('returns false for "interviewing"', () => {
    expect(isIntakeActive('interviewing')).toBe(false)
  })

  it('returns false for "analyzed"', () => {
    expect(isIntakeActive('analyzed')).toBe(false)
  })

  it('covers every ProjectStatus value', () => {
    const allStatuses: ProjectStatus[] = ['intake', 'brief_ready', 'interviewing', 'analyzed']
    const activeStatuses = allStatuses.filter(isIntakeActive)
    expect(activeStatuses).toEqual(['intake', 'brief_ready'])
  })
})

// ── PROJECT_STATUS_META ────────────────────────────────────────────────────

describe('PROJECT_STATUS_META', () => {
  const allStatuses: ProjectStatus[] = ['intake', 'brief_ready', 'interviewing', 'analyzed']

  it('has an entry for every ProjectStatus', () => {
    allStatuses.forEach((status) => {
      expect(PROJECT_STATUS_META[status]).toBeDefined()
    })
  })

  it('every entry has a non-empty label', () => {
    allStatuses.forEach((status) => {
      expect(PROJECT_STATUS_META[status].label).toBeTruthy()
      expect(PROJECT_STATUS_META[status].label.length).toBeGreaterThan(0)
    })
  })

  it('every entry has a non-empty badgeClass', () => {
    allStatuses.forEach((status) => {
      expect(PROJECT_STATUS_META[status].badgeClass).toBeTruthy()
    })
  })

  it('every entry has a non-empty dotClass', () => {
    allStatuses.forEach((status) => {
      expect(PROJECT_STATUS_META[status].dotClass).toBeTruthy()
    })
  })

  it('"intake" label is "Intake"', () => {
    expect(PROJECT_STATUS_META.intake.label).toBe('Intake')
  })

  it('"brief_ready" label is "Brief Hazır"', () => {
    expect(PROJECT_STATUS_META.brief_ready.label).toBe('Brief Hazır')
  })

  it('"interviewing" label is "Mülakat"', () => {
    expect(PROJECT_STATUS_META.interviewing.label).toBe('Mülakat')
  })

  it('"analyzed" label is "Analiz Edildi"', () => {
    expect(PROJECT_STATUS_META.analyzed.label).toBe('Analiz Edildi')
  })

  it('"brief_ready" uses amber color classes', () => {
    expect(PROJECT_STATUS_META.brief_ready.badgeClass).toMatch(/amber/)
    expect(PROJECT_STATUS_META.brief_ready.dotClass).toMatch(/amber/)
  })

  it('"interviewing" uses blue color classes', () => {
    expect(PROJECT_STATUS_META.interviewing.badgeClass).toMatch(/blue/)
    expect(PROJECT_STATUS_META.interviewing.dotClass).toMatch(/blue/)
  })

  it('"analyzed" uses emerald color classes', () => {
    expect(PROJECT_STATUS_META.analyzed.badgeClass).toMatch(/emerald/)
    expect(PROJECT_STATUS_META.analyzed.dotClass).toMatch(/emerald/)
  })

  it('badgeClass values do not contain "any" type leakage', () => {
    allStatuses.forEach((status) => {
      expect(typeof PROJECT_STATUS_META[status].badgeClass).toBe('string')
    })
  })
})
