'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import type { Json } from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InterviewForSummary {
  id: string
  participant_name: string
  status: string
  evidence_report: string | null
  signal_score: Json | null
}

interface SignalTotals {
  strong: number
  medium: number
  weak: number
  negative: number
}

interface DecisionCount {
  label: string
  count: number
  color: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DECISION_LABELS: Record<string, { label: string; color: string }> = {
  'continue discovery': { label: 'Keşfe Devam Et', color: 'text-amber-400' },
  'test commitment':    { label: 'Bağlılığı Test Et', color: 'text-blue-400' },
  'change segment':     { label: 'Segmenti Değiştir', color: 'text-orange-400' },
  'stop':               { label: 'Durdur', color: 'text-destructive' },
  'build narrow prototype': { label: 'Dar Prototip Yap', color: 'text-emerald-400' },
}

function parseDecision(report: string | null): string {
  if (!report) return ''
  const match = report.match(/## Decision\n([^\n#]+)/)
  return match?.[1]?.trim().toLowerCase() ?? ''
}

function parseSignalTotals(score: Json | null): SignalTotals {
  if (!score || typeof score !== 'object' || Array.isArray(score)) {
    return { strong: 0, medium: 0, weak: 0, negative: 0 }
  }
  const s = score as Record<string, unknown>
  const len = (arr: unknown) => (Array.isArray(arr) ? arr.length : 0)
  return {
    strong:   len(s.strong),
    medium:   len(s.medium),
    weak:     len(s.weak),
    negative: len(s.negative),
  }
}

function computeSummary(interviews: InterviewForSummary[]) {
  const analyzed = interviews.filter((i) => i.evidence_report != null)
  const pendingAnalysis = interviews.filter(
    (i) => i.status === 'completed' && i.evidence_report == null
  )

  const totals: SignalTotals = { strong: 0, medium: 0, weak: 0, negative: 0 }
  const decisionMap = new Map<string, number>()

  for (const iv of analyzed) {
    const t = parseSignalTotals(iv.signal_score)
    totals.strong   += t.strong
    totals.medium   += t.medium
    totals.weak     += t.weak
    totals.negative += t.negative

    const decision = parseDecision(iv.evidence_report)
    if (decision) {
      decisionMap.set(decision, (decisionMap.get(decision) ?? 0) + 1)
    }
  }

  const decisions: DecisionCount[] = Array.from(decisionMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      label: DECISION_LABELS[key]?.label ?? key,
      count,
      color: DECISION_LABELS[key]?.color ?? 'text-muted-foreground',
    }))

  return { analyzed, pendingAnalysis, totals, decisions }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectSummaryBar({
  interviews,
}: {
  interviews: InterviewForSummary[]
}) {
  const [expanded, setExpanded] = useState(true)

  const { analyzed, pendingAnalysis, totals, decisions } = useMemo(
    () => computeSummary(interviews),
    [interviews]
  )

  // Hiç analiz edilmiş mülakat yoksa gösterme
  if (analyzed.length === 0) return null

  const totalSignals = totals.strong + totals.medium + totals.weak + totals.negative

  return (
    <div className="rounded-xl border bg-card">
      {/* Başlık satırı — her zaman görünür */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            Proje Özeti
          </span>
          <span className="text-muted-foreground text-xs">
            {analyzed.length} mülakat analiz edildi
          </span>
          {pendingAnalysis.length > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-400">
              <TriangleAlert className="size-3" />
              {pendingAnalysis.length} analiz bekliyor
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        )}
      </button>

      {/* Genişletilmiş içerik */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">

            {/* Sinyal sayaçları */}
            <div className="flex flex-1 flex-col gap-2">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Sinyal Toplamı ({totalSignals})
              </span>
              <div className="grid grid-cols-2 gap-2">
                <SignalCounter
                  label="Güçlü"
                  count={totals.strong}
                  barColor="bg-emerald-500"
                  textColor="text-emerald-400"
                  max={Math.max(totals.strong, 1)}
                />
                <SignalCounter
                  label="Orta"
                  count={totals.medium}
                  barColor="bg-amber-500"
                  textColor="text-amber-400"
                  max={Math.max(totals.strong, 1)}
                />
                <SignalCounter
                  label="Zayıf"
                  count={totals.weak}
                  barColor="bg-muted-foreground"
                  textColor="text-muted-foreground"
                  max={Math.max(totals.strong, 1)}
                />
                <SignalCounter
                  label="Negatif"
                  count={totals.negative}
                  barColor="bg-destructive"
                  textColor="text-destructive"
                  max={Math.max(totals.strong, 1)}
                />
              </div>
            </div>

            {/* Dikey ayırıcı */}
            {decisions.length > 0 && (
              <div className="hidden w-px bg-border sm:block" />
            )}

            {/* Karar dağılımı */}
            {decisions.length > 0 && (
              <div className="flex flex-1 flex-col gap-2">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Karar Dağılımı
                </span>
                <div className="flex flex-col gap-1.5">
                  {decisions.map((d) => (
                    <div key={d.label} className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium', d.color)}>
                        {d.label}
                      </span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        ×{d.count}
                      </span>
                      {/* Mini progress bar */}
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', decisionBarColor(d.color))}
                          style={{
                            width: `${Math.round((d.count / analyzed.length) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Analiz bekleyen uyarı */}
          {pendingAnalysis.length > 0 && (
            <p className="text-muted-foreground mt-3 text-xs">
              {pendingAnalysis.map((i) => i.participant_name).join(', ')} —
              tamamlandı ama henüz analiz edilmedi. Listedeki &ldquo;Analiz Et&rdquo; butonuna basın.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── SignalCounter ─────────────────────────────────────────────────────────────

function SignalCounter({
  label,
  count,
  barColor,
  textColor,
  max,
}: {
  label: string
  count: number
  barColor: string
  textColor: string
  max: number
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className={cn('text-xs font-semibold tabular-nums', textColor)}>
          {count}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Decision bar color helper ─────────────────────────────────────────────────

function decisionBarColor(textColor: string): string {
  const map: Record<string, string> = {
    'text-amber-400':      'bg-amber-500',
    'text-blue-400':       'bg-blue-500',
    'text-orange-400':     'bg-orange-500',
    'text-destructive':    'bg-destructive',
    'text-emerald-400':    'bg-emerald-500',
    'text-muted-foreground': 'bg-muted-foreground',
  }
  return map[textColor] ?? 'bg-muted-foreground'
}
