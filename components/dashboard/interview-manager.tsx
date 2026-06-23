'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
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
}: {
  projectId: string
  onStatusChange?: (projectId: string, status: ProjectStatus) => void
}) {
  const [interviews, setInterviews] = useState<InterviewSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadInterviews = useCallback(async () => {
    const supabase = createClient()
    const { data, error: queryError } = await supabase
      .from('interviews')
      .select('id, participant_name, status, created_at, evidence_report, signal_score')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (queryError) {
      setError('Mülakatlar yüklenemedi.')
    } else {
      setInterviews((data ?? []) as InterviewSummary[])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void loadInterviews()
  }, [loadInterviews])

  const createInterview = useCallback(async () => {
    setCreating(true)
    setError(null)

    const supabase = createClient()
    const { data, error: insertError } = await supabase
      .from('interviews')
      .insert({
        project_id: projectId,
        participant_name: 'Katılımcı',
        status: 'pending',
      })
      .select('id, participant_name, status, created_at, evidence_report, signal_score')
      .single()

    if (insertError || !data) {
      setError('Mülakat bağlantısı oluşturulamadı.')
    } else {
      setInterviews(prev => [data as InterviewSummary, ...prev])
      onStatusChange?.(projectId, 'interviewing')
    }
    setCreating(false)
  }, [projectId, onStatusChange])

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

        // Mark this interview as analyzed in local state
        setInterviews(prev =>
          prev.map(i =>
            i.id === interviewId
              ? { ...i, evidence_report: 'analyzed' }
              : i
          )
        )

        onStatusChange?.(projectId, 'analyzed')
      } catch {
        setError('Ağ hatası. Lütfen tekrar deneyin.')
      } finally {
        setAnalyzingId(null)
      }
    },
    [projectId, onStatusChange]
  )

  const copyLink = useCallback(async (interviewId: string) => {
    const url = `${window.location.origin}/interview/${interviewId}`
    await navigator.clipboard.writeText(url)
    setCopiedId(interviewId)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
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

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
          <Spinner className="size-3.5" />
          Yükleniyor...
        </div>
      ) : interviews.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm">
          <Users className="size-6 opacity-40" />
          <p className="max-w-xs text-balance">
            Henüz mülakat yok. Bir bağlantı oluşturun ve ilk katılımcınızla
            paylaşın.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {interviews.map(interview => {
            const meta =
              STATUS_META[interview.status as keyof typeof STATUS_META]
            const copied = copiedId === interview.id
            const isAnalyzing = analyzingId === interview.id
            const isAnalyzed = interview.evidence_report != null
            const canAnalyze =
              interview.status === 'completed' && !isAnalyzed

            return (
              <div
                key={interview.id}
                className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2.5"
              >
                {/* Info */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {interview.participant_name}
                    </span>
                    <Badge
                      className={`h-4 gap-1 text-[10px] ${meta.badgeClass}`}
                    >
                      {meta.label}
                    </Badge>
                    {isAnalyzed && (
                      <Badge className="h-4 gap-1 border-transparent bg-violet-500/15 text-[10px] text-violet-400">
                        Analiz edildi
                      </Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground truncate font-mono text-[11px]">
                    /interview/{interview.id}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {isAnalyzed && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/report/${interview.id}`, '_blank')}
                        title="Raporu gör"
                    >
                        Raporu Gör
                    </Button>
                    )}
                  {canAnalyze && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void analyzeInterview(interview.id)}
                      disabled={isAnalyzing}
                      title="Analiz et"
                    >
                      {isAnalyzing ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <FlaskConical data-icon="inline-start" className="size-3.5" />
                      )}
                      {isAnalyzing ? 'Analiz ediliyor...' : 'Analiz Et'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void copyLink(interview.id)}
                    title="Bağlantıyı kopyala"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
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
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}