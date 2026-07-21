'use client'

import { useCallback, useRef, useState, useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Bot, User } from 'lucide-react'
import { SignalDimensionsGrid } from './signal-dimensions-grid'
import { useIsMobile } from '@/hooks/use-mobile'
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
  analysis_json: unknown | null
  project_id: string
  project_name?: string
  analyzed_at?: string
}

interface MessageData {
  id: string
  sender: 'agent' | 'participant'
  content: string
}

type SignalType = 'strong' | 'medium' | 'weak' | 'negative'
type FilterType = 'all' | SignalType

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseAnalysisJson(raw: unknown): StructuredAnalysis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const a = raw as Record<string, unknown>
  if (typeof a.decision !== 'string' || typeof a.summary !== 'string') return null
  return raw as StructuredAnalysis
}

function parseDecisionFallback(report: string): string {
  return report.match(/## Decision\n([^\n#]+)/)?.[1]?.trim() ?? ''
}

function parseSummaryFallback(report: string): string {
  return report.match(/## Summary\n([\s\S]+?)(?=\n##)/)?.[1]?.trim() ?? ''
}

function parseNextStepFallback(report: string): string {
  return report.match(/## Recommended next step\n([\s\S]+?)$/)?.[1]?.trim() ?? ''
}

function parseSignalScore(raw: unknown): SignalScore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { strong: [], medium: [], weak: [], negative: [] }
  }
  const s = raw as Record<string, unknown>
  const guard =
    (arr: unknown): unknown[] =>
      Array.isArray(arr)
        ? arr.filter(
            (e) => typeof e === 'object' && e !== null && 'quote' in e && 'message_id' in e
          )
        : []
  return {
    strong:   guard(s.strong)   as StrongSignalEntry[],
    medium:   guard(s.medium)   as MediumSignalEntry[],
    weak:     guard(s.weak)     as WeakSignalEntry[],
    negative: guard(s.negative) as NegativeSignalEntry[],
  }
}

// ── Meta maps ────────────────────────────────────────────────────────────────

const DECISION_META: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  'continue discovery':   { label: 'Keşfe Devam Et',    bg: 'bg-amber-500/15',     text: 'text-amber-400',     border: 'border-amber-500/30'     },
  'test commitment':      { label: 'Bağlılığı Test Et',  bg: 'bg-blue-500/15',      text: 'text-blue-400',      border: 'border-blue-500/30'      },
  'change segment':       { label: 'Segmenti Değiştir',  bg: 'bg-orange-500/15',    text: 'text-orange-400',    border: 'border-orange-500/30'    },
  stop:                   { label: 'Durdur',             bg: 'bg-destructive/15',   text: 'text-destructive',   border: 'border-destructive/30'   },
  'build narrow prototype': { label: 'Dar Prototip Yap', bg: 'bg-emerald-500/15',   text: 'text-emerald-400',   border: 'border-emerald-500/30'   },
}

const SIGNAL_META: Record<
  SignalType,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  strong:   { label: 'Güçlü Kanıt',   bg: 'bg-emerald-500/15',  text: 'text-emerald-400',      border: 'border-emerald-500/30',  dot: 'bg-emerald-400'      },
  medium:   { label: 'Orta Kanıt',    bg: 'bg-amber-500/15',    text: 'text-amber-400',        border: 'border-amber-500/30',    dot: 'bg-amber-400'        },
  weak:     { label: 'Zayıf Kanıt',   bg: 'bg-muted',           text: 'text-muted-foreground', border: 'border-border',          dot: 'bg-muted-foreground' },
  negative: { label: 'Negatif Kanıt', bg: 'bg-destructive/15',  text: 'text-destructive',      border: 'border-destructive/30',  dot: 'bg-destructive'      },
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
  const [activeTab, setActiveTab]                   = useState<SignalType>('strong')
  const [transcriptFilter, setTranscriptFilter]     = useState<FilterType>('all')
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const isMobile = useIsMobile()

  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const scrollToMessage = useCallback((messageId: string) => {
    if (!messageId) return
    setTranscriptFilter('all')
    setTimeout(() => {
      const el = messageRefs.current.get(messageId)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedMessageId(messageId)
      setTimeout(() => setHighlightedMessageId(null), 2000)
    }, 50)
  }, [])

  const analysisJson = useMemo(
    () => parseAnalysisJson(interview.analysis_json),
    [interview.analysis_json]
  )

  const decision  = analysisJson ? analysisJson.decision              : parseDecisionFallback(interview.evidence_report)
  const summary   = analysisJson ? analysisJson.summary               : parseSummaryFallback(interview.evidence_report)
  const nextStep  = analysisJson ? analysisJson.recommendedNextStep   : parseNextStepFallback(interview.evidence_report)
  const openQuestions: string[] = analysisJson?.openQuestions ?? []

  const signalScore = useMemo(
    () => parseSignalScore(interview.signal_score),
    [interview.signal_score]
  )

  const decisionMeta =
    DECISION_META[decision.toLowerCase()] ?? DECISION_META['continue discovery']

  const signalMap = useMemo(() => {
    const map = new Map<string, SignalType>()
    SIGNAL_TYPES.forEach(type => {
      signalScore[type].forEach(e => { if (e.message_id) map.set(e.message_id, type) })
    })
    return map
  }, [signalScore])

  const filteredMessages = useMemo(() => {
    if (transcriptFilter === 'all') return messages
    return messages.filter(m => m.sender === 'agent' || signalMap.get(m.id) === transcriptFilter)
  }, [messages, transcriptFilter, signalMap])

  // ── Render helpers ──────────────────────────────────────────────────────────

  function evidenceExplanation(entry: StrongSignalEntry | MediumSignalEntry | WeakSignalEntry | NegativeSignalEntry): string | undefined {
    if (activeTab === 'strong')   return (entry as StrongSignalEntry).whyItMatters
    if (activeTab === 'medium')   return (entry as MediumSignalEntry).context
    if (activeTab === 'weak')     return (entry as WeakSignalEntry).whyItIsWeak
    return (entry as NegativeSignalEntry).whyItIsNegative
  }

  return (
    <div className="min-h-screen">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Kanıt Raporu</span>
            {interview.project_name && (
              <>
                <span className="text-muted-foreground text-xs">·</span>
                <Link
                  href="/dashboard"
                  className="text-muted-foreground hover:text-foreground truncate text-xs transition-colors"
                >
                  {interview.project_name}
                </Link>
              </>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span>{interview.participant_name}</span>
            {interview.participant_role && (
              <><span className="opacity-40">·</span><span className="opacity-70">{interview.participant_role}</span></>
            )}
            {interview.analyzed_at && (
              <><span className="opacity-40">·</span>
              <span className="opacity-60">
                {new Date(interview.analyzed_at).toLocaleDateString('tr-TR', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span></>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">

        {/* Decision Banner — tam genişlik */}
        <div className={cn('rounded-xl border p-5 text-center sm:p-6', decisionMeta.bg, decisionMeta.border)}>
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wider">Karar</p>
          <h1 className={cn('text-xl font-bold sm:text-2xl', decisionMeta.text)}>{decisionMeta.label}</h1>
          {summary && (
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-sm leading-relaxed">{summary}</p>
          )}
        </div>

        {/* Sinyal Boyutları + Sayaç Kartları
            Mobil: üst üste (1 sütun)
            Masaüstü: yan yana (2 sütun)                                   */}
        <div className={cn('grid gap-3', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>

          {/* Sinyal boyutları — analysis_json varsa */}
          {analysisJson?.signalScore && (
            <SignalDimensionsGrid
              problemEvidence={analysisJson.signalScore.problemEvidence}
              urgency={analysisJson.signalScore.urgency}
              workaroundEvidence={analysisJson.signalScore.workaroundEvidence}
              budgetOrCommitment={analysisJson.signalScore.budgetOrCommitment}
            />
          )}

          {/* Sayaç kartları — her zaman 2×2 grid */}
          <div className="grid grid-cols-2 gap-3">
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
                    isActive ? cn(meta.bg, meta.border) : 'bg-card border-border hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', meta.dot)} />
                    <span className="text-muted-foreground text-xs">{meta.label}</span>
                  </div>
                  <p className={cn('mt-1 text-2xl font-bold', isActive ? meta.text : 'text-foreground')}>
                    {count}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Kanıt Kartları + Transkript
            Mobil: üst üste (1 sütun), kanıtlar önce
            Masaüstü: yan yana (2 sütun), eşit yükseklik                   */}
        <div className={cn('grid gap-6 items-start', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>

          {/* Sol panel: Kanıt kartları + öneriler */}
          <div className="space-y-4">

            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{SIGNAL_META[activeTab].label}</h2>

              {signalScore[activeTab].length === 0 ? (
                <p className="text-muted-foreground text-sm">Bu kategoride kanıt bulunamadı.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {signalScore[activeTab].map((entry, i) => {
                    const explanation = evidenceExplanation(entry)
                    const hasLink = Boolean(entry.message_id)
                    return (
                      <div
                        key={i}
                        onClick={() => hasLink && scrollToMessage(entry.message_id)}
                        className={cn(
                          'rounded-lg border p-3 transition-colors',
                          SIGNAL_META[activeTab].bg,
                          SIGNAL_META[activeTab].border,
                          hasLink && 'cursor-pointer hover:brightness-110'
                        )}
                      >
                        <p className={cn('text-sm leading-relaxed', SIGNAL_META[activeTab].text)}>
                          &ldquo;{entry.quote}&rdquo;
                        </p>
                        {explanation && (
                          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                            {explanation}
                          </p>
                        )}
                        {hasLink && (
                          <p className="text-muted-foreground/60 mt-1.5 text-[10px]">
                            Transkripte git ↓
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Open Questions */}
            {openQuestions.length > 0 && (
              <div className="bg-card rounded-xl border p-4">
                <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
                  Sonraki Mülakatlar İçin Açık Sorular
                </p>
                <ol className="space-y-1">
                  {openQuestions.map((q, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      <span className="text-muted-foreground mr-2 font-mono text-xs">{i + 1}.</span>
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
          </div>

          {/* Sağ panel: Transkript */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Transkript</h2>
              <div className="flex flex-wrap gap-1">
                {FILTER_TYPES.map(f => {
                  const label = f === 'all' ? 'Tümü' : SIGNAL_META[f as SignalType].label
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
                const isAgent      = message.sender === 'agent'
                const signalType   = signalMap.get(message.id)
                const signalMeta   = signalType ? SIGNAL_META[signalType] : null
                const isHighlighted = highlightedMessageId === message.id

                return (
                  <div
                    key={message.id}
                    ref={(el) => {
                      if (el) messageRefs.current.set(message.id, el)
                      else    messageRefs.current.delete(message.id)
                    }}
                    className={cn(
                      'flex items-start gap-2 rounded-lg p-1 transition-colors duration-500',
                      isAgent ? 'flex-row' : 'flex-row-reverse',
                      isHighlighted && 'bg-primary/10'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full',
                        isAgent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {isAgent ? <Bot className="size-4" /> : <User className="size-4" />}
                    </span>
                    <div className="flex max-w-[75%] flex-col gap-1">
                      <div
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm',
                          isAgent ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'
                        )}
                      >
                        {message.content}
                      </div>
                      {signalMeta && (
                        <div className="self-end">
                          <Badge
                            className={cn(
                              'h-4 gap-1 border text-[10px]',
                              signalMeta.bg, signalMeta.text, signalMeta.border
                            )}
                          >
                            <span className={cn('size-1.5 rounded-full', signalMeta.dot)} />
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
    </div>
  )
}
