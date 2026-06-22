import type { Project, Interview } from '@/types/database.types'

/**
 * projects tablosunda fiziksel bir `status` sütunu yoktur.
 * Durum, research_brief / interview_script ve ilgili mülakatların
 * varlığından TÜRETİLİR. UI karşılıkları görev tanımındaki haritaya uyar.
 */
export type ProjectStatus = 'intake' | 'brief_ready' | 'interviewing' | 'analyzed'

/** Bir projenin durumunu, opsiyonel mülakat verisiyle birlikte türetir. */
export function deriveProjectStatus(
  project: Pick<Project, 'research_brief' | 'interview_script'>,
  interviews: Pick<Interview, 'evidence_report' | 'signal_score'>[] = []
): ProjectStatus {
  const hasBrief = project.research_brief != null
  const hasAnalyzed = interviews.some(
    (i) => i.evidence_report != null || i.signal_score != null
  )

  if (hasAnalyzed) return 'analyzed'
  if (interviews.length > 0) return 'interviewing'
  if (hasBrief) return 'brief_ready'
  return 'intake'
}

interface StatusMeta {
  label: string
  /** Badge için Tailwind sınıfları (semantik durum renkleri). */
  badgeClass: string
  /** Yan noktanın rengi. */
  dotClass: string
}

export const PROJECT_STATUS_META: Record<ProjectStatus, StatusMeta> = {
  intake: {
    label: 'Intake',
    badgeClass: 'border-transparent bg-muted text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  brief_ready: {
    label: 'Brief Hazır',
    badgeClass: 'border-transparent bg-amber-500/15 text-amber-400',
    dotClass: 'bg-amber-400',
  },
  interviewing: {
    label: 'Mülakat',
    badgeClass: 'border-transparent bg-blue-500/15 text-blue-400',
    dotClass: 'bg-blue-400',
  },
  analyzed: {
    label: 'Analiz Edildi',
    badgeClass: 'border-transparent bg-emerald-500/15 text-emerald-400',
    dotClass: 'bg-emerald-400',
  },
}

/** Intake chat'in aktif olduğu durumlar. */
export function isIntakeActive(status: ProjectStatus): boolean {
  return status === 'intake' || status === 'brief_ready'
}
