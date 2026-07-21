'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Bot, User } from 'lucide-react'
import type {
  StrongSignalEntry,
  MediumSignalEntry,
  WeakSignalEntry,
  NegativeSignalEntry,
  StructuredAnalysis,
} from '@/types/index'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SignalScore {
  strong: StrongSignalEntry[]
  medium: MediumSignalEntry[]
  weak: WeakSignalEntry[]
  negative: NegativeSignalEntry[]
}

interface InterviewData {
  participant_name: string
  participant_role?: string
  signal_score: unknown
  evidence_report: string
  /** Yeni kayıtlarda dolu, eski kayıtlarda null — fallback olarak evidence_report kullanılır */
  analysis_json: unknown | null
}

interface MessageData {
  id: string
  sender: 'agent' | 'participant'
  content: string
}

type SignalType = 'strong' | 'medium' | 'weak' | 'negative'
type FilterType = 'all' | SignalType

// ── Helpers ──────────────────────────────────────────────────────────────────

/** analysis_json'dan StructuredAnalysis parse eder. null veya geçersizse null döner. */
function parseAnalysisJson(raw: unknown): StructuredAnalysis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const a = raw as Record<string, unknown>
  if (typeof a.decision !== 'string' || typeof a.summary !== 'string') return null
  return raw as StructuredAnalysis
}

// ── Regex fallback — sadece analysis_json null olan eski kayıtlar için ──────

function parseDecisionFallback(report: string): string {
  const match = report.match(/## Decision\n([^\n#]+)/)
  return match?.[1]?.trim() ?? ''
}

function parseSummaryFallback(report: string): string {
  const match = report.match(/## Summary\n([\s\S]+?)(?=\n##)/)
  return match?.[1]?.trim() ?? ''
}

function parseNextStepFallback(report: string): string {
  const match = report.match(/## Recommended next step\n([\s\S]+?)$/)
  return match?.[1]?.trim() ?? ''
}

// ── signal_score JSONB parse ─────────────────────────────────────────────────

function parseSignalScore(raw: unknown): SignalScore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { strong: [], medium: [], weak: [], negative: [] }
  }
  const s = raw as Record<string, unknown>

  const toStrong = (arr: unknown): StrongSignalEntry[] =>
    Array.isArray(arr)
      ? (arr.filter(
          (e): e is StrongSignalEntry =>
            typeof e === 'object' && e !== null && 'quote' in e && 'message_id' in e
        ) as StrongSignalEntry[])
      : []

  const toMedium = (arr: unknown): MediumSignalEntry[] =>
    Array.isArray(arr)
      ? (arr.filter(
          (e): e is MediumSignalEntry =>
            typeof e === 'object' && e !== null && 'quote' in e && 'message_id' in e
        ) as MediumSignalEntry[])
      : []

  const toWeak = (arr: unknown): WeakSignalEntry[] =>
    Array.isArray(arr)
      ? (arr.filter(
          (e): e is WeakSignalEntry =>
            typeof e === 'object' && e !== null && 'quote' in e && 'message_id' in e
        ) as WeakSignalEntry[])
      : []

  const toNegative = (arr: unknown): NegativeSignalEntry[] =>
    Array.isArray(arr)
      ? (arr.filter(
          (e): e is NegativeSignalEntry =>
            typeof e === 'object' && e !== null && 'quote' in e && 'message_id' in e
        ) as NegativeSignalEntry[])
      : []

  return {
    strong: toStrong(s.strong),
    medium: toMedium(s.medium),
    weak: toWeak(s.weak),
    negative: toNegative(s.negative),
  }
}

// ── Meta maps ────────────────────────────────────────────────────────────────

const DECISION_META: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  'continue discovery': {
    label: 'Keşfe Devam Et',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
  },
  'test commitment': {
    label: 'Bağlılığı Test Et',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
  },
  'change segment': {
    label: 'Segmenti Değiştir',
    bg: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
  },
  stop: {
    label: 'Durdur',
    bg: 'bg-destructive/15',
    text: 'text-destructive',
    border: 'border-destructive/30',
  },
  'build narrow prototype': {
    label: 'Dar Prototip Yap',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
}

const SIGNAL_META: Record<
  SignalType,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  strong: {
    label: 'Güçlü Kanıt',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  medium: {
    label: 'Orta Kanıt',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
  },
  weak: {
    label: 'Zayıf Kanıt',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    dot: 'bg-muted-foreground',
  },
  negative: {
    label: 'Negatif Kanıt',
    bg: 'bg-destructive/15',
    text: 'text-destructive',
    border: 'border-destructive/30',
    dot: 'bg-destructive',
  },
}

const SIGNAL_TYPES: SignalType[] = ['strong', 'medium', 'weak', 'negative']
const FILTER_TYPES: FilterType[] = ['all', 'strong', 'medium', 'weak', 'negative']

// ── Component ────────────────────────────────────────────────────────────────

export function EvidenceReport({
  interview,
  messages,
}: {
  interview: InterviewData
  messages: MessageData[]
}) {
  const [activeTab, setActiveTab] = useState<SignalType>('strong')
  const [transcriptFilter, setTranscriptFilter] = useState<FilterType>('all')

  // analysis_json varsa doğrudan oku, yoksa markdown fallback
  const analysisJson = useMemo(
    () => parseAnalysisJson(interview.analysis_json),
    [interview.analysis_json]
  )

  const decision = analysisJson
    ? analysisJson.decision
    : parseDecisionFallback(interview.evidence_report)

  const summary = analysisJson
    ? analysisJson.summary
    : parseSummaryFallback(interview.evidence_report)

  const nextStep = analysisJson
    ? analysisJson.recommendedNextStep
    : parseNextStepFallback(interview.evidence_report)

  const openQuestions: string[] = analysisJson?.openQuestions ?? []

  const signalScore = useMemo(
    () => parseSignalScore(interview.signal_score),
    [interview.signal_score]
  )

  const decisionMeta =
    DECISION_META[decision.toLowerCase()] ?? DECISION_META['continue discovery']

  // Map message_id → signal type for transcript annotation
  const signalMap = useMemo(() => {
    const map = new Map<string, SignalType>()
    SIGNAL_TYPES.forEach(type => {
      signalScore[type].forEach(e => {
        if (e.message_id) map.set(e.message_id, type)
      })
    })
    return map
  }, [signalScore])

  const filteredMessages = useMemo(() => {
    if (transcriptFilter === 'all') return messages
    return messages.filter(m => {
      if (m.sender === 'agent') return true
      return signalMap.get(m.id) === transcriptFilter
    })
  }, [messages, transcriptFilter, signalMap])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Kanıt Raporu</span>
          <span className="text-muted-foreground text-xs">
            {interview.participant_name}
            {interview.participant_role && (
              <span className="ml-1 opacity-70">· {interview.participant_role}</span>
            )}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Decision Banner */}
        <div
          className={cn(
            'rounded-xl border p-6 text-center',
            decisionMeta.bg,
            decisionMeta.border
          )}
        >
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wider">
            Karar
          </p>
          <h1 className={cn('text-2xl font-bold', decisionMeta.text)}>
            {decisionMeta.label}
          </h1>
          {summary && (
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-sm leading-relaxed">
              {summary}
            </p>
          )}
        </div>

        {/* Signal Score Overview */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SIGNAL_TYPES.map(type => {
            const meta = SIGNAL_META[type]
            const count = signalScore[type].length
            const isActive = activeTab === type
            return (
              <button
                key={type}
                onClick={() => setActiveTab(type)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-all',
                  isActive
                    ? cn(meta.bg, meta.border)
                    : 'bg-card border-border hover:bg-muted/50'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', meta.dot)} />
                  <span className="text-muted-foreground text-xs">
                    {meta.label}
                  </span>
                </div>
                <p
                  className={cn(
                    'mt-1 text-2xl font-bold',
                    isActive ? meta.text : 'text-foreground'
                  )}
                >
                  {count}
                </p>
              </button>
            )
          })}
        </div>

        {/* Evidence Quotes for active tab */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {SIGNAL_META[activeTab].label}
          </h2>
          {signalScore[activeTab].length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Bu kategoride kanıt bulunamadı.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {signalScore[activeTab].map((entry, i) => {
                // Her kategori kendi açıklama alanına sahip
                const explanation =
                  activeTab === 'strong'
                    ? (entry as StrongSignalEntry).whyItMatters
                    : activeTab === 'medium'
                    ? (entry as MediumSignalEntry).context
                    : activeTab === 'weak'
                    ? (entry as WeakSignalEntry).whyItIsWeak
                    : (entry as NegativeSignalEntry).whyItIsNegative

                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg border p-3',
                      SIGNAL_META[activeTab].bg,
                      SIGNAL_META[activeTab].border
                    )}
                  >
                    <p
                      className={cn(
                        'text-sm leading-relaxed',
                        SIGNAL_META[activeTab].text
                      )}
                    >
                      &ldquo;{entry.quote}&rdquo;
                    </p>
                    {explanation && (
                      <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                        {explanation}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Open Questions — sadece analysis_json varsa göster */}
        {openQuestions.length > 0 && (
          <div className="bg-card rounded-xl border p-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
              Sonraki Mülakatlar İçin Açık Sorular
            </p>
            <ol className="space-y-1">
              {openQuestions.map((q, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  <span className="text-muted-foreground mr-2 font-mono text-xs">
                    {i + 1}.
                  </span>
                  {q}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Recommended Next Step */}
        {nextStep && (
          <div className="bg-card rounded-xl border p-4">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wider">
              Önerilen Sonraki Adım
            </p>
            <p className="text-sm leading-relaxed">{nextStep}</p>
          </div>
        )}

        {/* Transcript */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Transkript</h2>
            <div className="flex flex-wrap gap-1">
              {FILTER_TYPES.map(f => {
                const label =
                  f === 'all' ? 'Tümü' : SIGNAL_META[f as SignalType].label
                return (
                  <button
                    key={f}
                    onClick={() => setTranscriptFilter(f)}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs transition-colors',
                      transcriptFilter === f
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {filteredMessages.map(message => {
              const isAgent = message.sender === 'agent'
              const signalType = signalMap.get(message.id)
              const signalMeta = signalType ? SIGNAL_META[signalType] : null

              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex items-start gap-2',
                    isAgent ? 'flex-row' : 'flex-row-reverse'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full',
                      isAgent
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isAgent ? (
                      <Bot className="size-4" />
                    ) : (
                      <User className="size-4" />
                    )}
                  </span>
                  <div className="flex max-w-[75%] flex-col gap-1">
                    <div
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm',
                        isAgent
                          ? 'bg-muted text-foreground'
                          : 'bg-primary text-primary-foreground'
                      )}
                    >
                      {message.content}
                    </div>
                    {signalMeta && (
                      <div className="self-end">
                        <Badge
                          className={cn(
                            'h-4 gap-1 border text-[10px]',
                            signalMeta.bg,
                            signalMeta.text,
                            signalMeta.border
                          )}
                        >
                          <span
                            className={cn('size-1.5 rounded-full', signalMeta.dot)}
                          />
                          {signalMeta.label}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
