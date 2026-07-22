'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  Plus,
  Users,
} from 'lucide-react'
import type { Interview } from '@/types/database.types'
import type { ApiResponse, AnalyzeResponseData } from '@/types/index'
import type { ProjectStatus } from '@/lib/project-status'
import { ProjectSummaryBar } from '@/components/dashboard/project-summary-bar'

type InterviewSummary = Pick<
  Interview,
  'id' | 'participant_name' | 'status' | 'created_at' | 'evidence_report' | 'signal_score'
>

const STATUS_META = {
  pending: {
    label: 'Bekliyor',
    badgeClass: 'border-transparent bg-muted text-muted-foreground',
  },
  ongoing: {
    label: 'Devam ediyor',
    badgeClass: 'border-transparent bg-blue-500/15 text-blue-400',
  },
  completed: {
    label: 'Tamamlandı',
    badgeClass: 'border-transparent bg-emerald-500/15 text-emerald-400',
  },
}

export function InterviewManager({
  projectId,
  onStatusChange,
  showHeader = true,
  onCreateReady,
}: {
  projectId: string
  onStatusChange?: (projectId: string, status: ProjectStatus) => void
  showHeader?: boolean
  onCreateReady?: (createFn: () => Promise<void>) => void
}) {
  const [interviewList, setInterviewList] = useState<InterviewSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadInterviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/interviews/${projectId}`)
      const payload = (await res.json()) as ApiResponse<InterviewSummary[]>

      if (!res.ok || payload.error || !payload.data) {
        setError('Mülakatlar yüklenemedi.')
      } else {
        setInterviewList(payload.data)
      }
    } catch {
      setError('Mülakatlar yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadInterviews()
  }, [loadInterviews])

  const createInterview = useCallback(async () => {
    setCreating(true)
    setError(null)

    try {
      const res = await fetch(`/api/interviews/${projectId}`, {
        method: 'POST',
      })
      const payload = (await res.json()) as ApiResponse<InterviewSummary>

      if (!res.ok || payload.error || !payload.data) {
        setError(payload.error ?? 'Mülakat bağlantısı oluşturulamadı.')
      } else {
        setInterviewList((prev) => [payload.data, ...prev])
        onStatusChange?.(projectId, 'interviewing')
      }
    } catch {
      setError('Mülakat bağlantısı oluşturulamadı.')
    } finally {
      setCreating(false)
    }
  }, [projectId, onStatusChange])

  useEffect(() => {
    if (onCreateReady) {
      onCreateReady(createInterview)
    }
  }, [createInterview, onCreateReady])

  const analyzeInterview = useCallback(
    async (interviewId: string) => {
      setAnalyzingId(interviewId)
      setError(null)

      try {
        const res = await fetch(`/api/analyze/${interviewId}`, {
          method: 'POST',
        })

        const payload = (await res.json()) as ApiResponse<AnalyzeResponseData>

        if (!res.ok || payload.error || !payload.data) {
          setError(payload.error ?? 'Analiz başlatılamadı. Lütfen tekrar deneyin.')
          return
        }

        // Analiz tamamlandı — listeyi yenile
        await loadInterviews()
        onStatusChange?.(projectId, 'analyzed')
      } catch {
        setError('Ağ hatası. Lütfen tekrar deneyin.')
      } finally {
        setAnalyzingId(null)
      }
    },
    [projectId, onStatusChange, loadInterviews]
  )

  const copyLink = useCallback(async (interviewId: string) => {
    const url = `${window.location.origin}/interview/${interviewId}`
    await navigator.clipboard.writeText(url)
    setCopiedId(interviewId)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-hidden rounded-xl border bg-card p-5">
      {/* Proje bazlı konsolide özet — en az 1 analiz varsa görünür */}
      {!loading && <ProjectSummaryBar interviews={interviewList} />}

      {showHeader && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm shadow-black/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-sm font-semibold">Mülakat Bağlantıları</h3>
              <p className="text-muted-foreground text-xs text-balance">
                Her katılımcı için bir bağlantı oluşturun ve paylaşın.
              </p>
            </div>
            <Button
              onClick={() => void createInterview()}
              disabled={creating}
              size="sm"
            >
              {creating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" className="size-4" />
              )}
              {creating ? 'Oluşturuluyor...' : 'Yeni Bağlantı'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-destructive text-xs">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-5" />
        </div>
      ) : interviewList.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/10 py-8 text-center">
          <Users className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Henüz mülakat bağlantısı yok.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {interviewList.map((interview) => {
            const meta = STATUS_META[interview.status as keyof typeof STATUS_META] ?? STATUS_META.pending
            const isAnalyzing = analyzingId === interview.id
            const isCopied = copiedId === interview.id
            const hasReport = !!interview.evidence_report

            return (
              <div
                key={interview.id}
                className="bg-card flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-medium">
                      {interview.participant_name}
                    </span>
                    <Badge className={meta.badgeClass} variant="outline">
                      {meta.label}
                    </Badge>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {/* Bağlantıyı kopyala */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void copyLink(interview.id)}
                      title="Bağlantıyı kopyala"
                    >
                      {isCopied ? (
                        <Check className="size-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>

                    {/* Yeni sekmede aç */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        window.open(`/interview/${interview.id}`, '_blank')
                      }
                      title="Mülakatı aç"
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>

                    {/* Raporu görüntüle */}
                    {hasReport && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          window.open(`/report/${interview.id}`, '_blank')
                        }
                        title="Raporu görüntüle"
                      >
                        <FlaskConical className="size-3.5" />
                      </Button>
                    )}

                    {/* Analiz et */}
                    {interview.status === 'completed' && !hasReport && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void analyzeInterview(interview.id)}
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing && <Spinner data-icon="inline-start" />}
                        {isAnalyzing ? 'Analiz ediliyor...' : 'Analiz Et'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
