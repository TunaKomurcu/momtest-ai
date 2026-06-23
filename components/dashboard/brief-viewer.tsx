'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Download, FileText, ListChecks } from 'lucide-react'
import type { Json } from '@/types/database.types'
import type { FullResearchBrief, InterviewScript, InterviewQuestion } from '@/types/index'

// ── Types ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'brief' | 'script'

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadJson(data: Json, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function parseResearchBrief(raw: Json | null): FullResearchBrief | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (!b.productIdea && !b.targetCustomer && !b.riskiestAssumption) return null
  return raw as unknown as FullResearchBrief
}

function parseInterviewScript(raw: Json | null): InterviewScript | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (!s.goal && !Array.isArray(s.questions)) return null
  return raw as unknown as InterviewScript
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BriefViewer({
  projectId,
  productIdea,
  researchBrief,
  interviewScript,
}: {
  projectId: string
  productIdea: string
  researchBrief: Json | null
  interviewScript: Json | null
}) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('brief')

  const brief = parseResearchBrief(researchBrief)
  const script = parseInterviewScript(interviewScript)

  const hasBrief = brief !== null
  const hasScript = script !== null

  if (!hasBrief && !hasScript) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        Araştırma özeti henüz oluşturulmadı. Intake sohbetini tamamladıktan
        sonra &ldquo;Üret&rdquo; butonuna basın.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Sekme başlıkları */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <TabButton
            active={activeTab === 'brief'}
            onClick={() => setActiveTab('brief')}
            icon={<FileText className="size-3.5" />}
            label="Research Brief"
            disabled={!hasBrief}
          />
          <TabButton
            active={activeTab === 'script'}
            onClick={() => setActiveTab('script')}
            icon={<ListChecks className="size-3.5" />}
            label="Interview Script"
            disabled={!hasScript}
          />
        </div>

        {/* İndir butonu — aktif sekmeye göre */}
        {activeTab === 'brief' && hasBrief && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadJson(
                researchBrief!,
                `research-brief-${productIdea.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}-${projectId.slice(0, 8)}.json`
              )
            }
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 text-xs"
          >
            <Download className="size-3.5" />
            JSON İndir
          </Button>
        )}
        {activeTab === 'script' && hasScript && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadJson(
                interviewScript!,
                `interview-script-${productIdea.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}-${projectId.slice(0, 8)}.json`
              )
            }
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 text-xs"
          >
            <Download className="size-3.5" />
            JSON İndir
          </Button>
        )}
      </div>

      {/* Sekme içerikleri */}
      {activeTab === 'brief' && hasBrief && (
        <ResearchBriefPanel brief={brief!} />
      )}
      {activeTab === 'script' && hasScript && (
        <InterviewScriptPanel script={script!} />
      )}
      {activeTab === 'brief' && !hasBrief && (
        <EmptyTab message="Research Brief henüz oluşturulmadı." />
      )}
      {activeTab === 'script' && !hasScript && (
        <EmptyTab message="Interview Script henüz oluşturulmadı." />
      )}
    </div>
  )
}

// ── TabButton ─────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ── EmptyTab ──────────────────────────────────────────────────────────────────

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
      {message}
    </div>
  )
}

// ── ResearchBriefPanel ────────────────────────────────────────────────────────

function ResearchBriefPanel({ brief }: { brief: FullResearchBrief }) {
  return (
    <ScrollArea className="max-h-[420px]">
      <div className="flex flex-col gap-4 pr-2">
        <BriefSection label="Ürün Fikri" value={brief.productIdea} />
        <BriefSection label="Hedef Müşteri" value={brief.targetCustomer} />
        <BriefSection label="Temel Durum" value={brief.coreSituation} />
        <BriefSection label="Mevcut İnanç" value={brief.currentBelief} />
        <BriefSection
          label="En Riskli Varsayım"
          value={brief.riskiestAssumption}
          highlight
        />
        <BriefSection
          label="Mülakat Hedefi"
          value={brief.interviewObjective}
        />

        {/* Kanıt ihtiyacı */}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Kanıt İhtiyacı
          </span>
          <div className="flex flex-col gap-1.5">
            <EvidenceRow type="strong" label="Güçlü" value={brief.evidenceNeeded.strong} />
            <EvidenceRow type="weak" label="Zayıf" value={brief.evidenceNeeded.weak} />
            <EvidenceRow type="negative" label="Negatif" value={brief.evidenceNeeded.negative} />
          </div>
        </div>

        {/* Katılımcı kriterleri */}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Katılımcı Kriterleri
          </span>
          <div className="flex flex-col gap-2">
            {brief.participantCriteria.mustHave.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[11px]">Olması gereken</span>
                <div className="flex flex-wrap gap-1">
                  {brief.participantCriteria.mustHave.map((c, i) => (
                    <Badge key={i} variant="outline" className="text-[11px]">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {brief.participantCriteria.avoid.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[11px]">Kaçınılacak</span>
                <div className="flex flex-wrap gap-1">
                  {brief.participantCriteria.avoid.map((c, i) => (
                    <Badge key={i} variant="outline" className="text-[11px] border-destructive/40 text-destructive">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Yasaklı sorular */}
        {brief.forbiddenQuestions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Yasaklı Sorular
            </span>
            <ul className="flex flex-col gap-1">
              {brief.forbiddenQuestions.map((q, i) => (
                <li key={i} className="text-muted-foreground flex items-start gap-1.5 text-xs">
                  <span className="mt-0.5 text-destructive">✕</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Assumption Map */}
        {brief.assumptionMap?.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Varsayım Haritası
            </span>
            <div className="flex flex-col gap-2">
              {brief.assumptionMap.map((row, i) => (
                <div
                  key={i}
                  className="bg-muted/40 flex flex-col gap-1 rounded-lg p-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <RiskBadge level={row.riskLevel} />
                    <span className="font-medium">{row.assumption}</span>
                  </div>
                  <span className="text-muted-foreground">
                    Sorulacak: {row.whatToAskAbout}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ── InterviewScriptPanel ──────────────────────────────────────────────────────

function InterviewScriptPanel({ script }: { script: InterviewScript }) {
  return (
    <ScrollArea className="max-h-[420px]">
      <div className="flex flex-col gap-4 pr-2">
        <BriefSection label="Mülakat Hedefi" value={script.goal} />

        {script.rulesForInterviewer?.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Kurallar
            </span>
            <ul className="flex flex-col gap-1">
              {script.rulesForInterviewer.map((r, i) => (
                <li key={i} className="text-muted-foreground flex items-start gap-1.5 text-xs">
                  <span className="mt-0.5 shrink-0">—</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {script.questions?.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Sorular ({script.questions.length})
            </span>
            <div className="flex flex-col gap-2">
              {script.questions.map((q: InterviewQuestion) => (
                <div
                  key={q.order}
                  className="bg-muted/40 flex flex-col gap-1.5 rounded-lg p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-0.5 shrink-0 font-mono text-[11px]">
                      {q.order}.
                    </span>
                    <span className="text-sm leading-snug">{q.question}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 pl-5">
                    <Badge
                      variant="outline"
                      className="text-muted-foreground h-4 text-[10px]"
                    >
                      {q.signalSought}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function BriefSection({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <p
        className={cn(
          'text-sm leading-relaxed',
          highlight && 'text-amber-400 font-medium'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function EvidenceRow({
  type,
  label,
  value,
}: {
  type: 'strong' | 'weak' | 'negative'
  label: string
  value: string
}) {
  const colors = {
    strong: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    weak: 'bg-muted text-muted-foreground border-border',
    negative: 'bg-destructive/10 text-destructive border-destructive/20',
  }
  return (
    <div className={cn('rounded-md border px-2.5 py-1.5 text-xs', colors[type])}>
      <span className="font-medium">{label}:</span> {value}
    </div>
  )
}

function RiskBadge({ level }: { level: string }) {
  const meta: Record<string, string> = {
    high: 'bg-destructive/15 text-destructive border-destructive/30',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    low: 'bg-muted text-muted-foreground border-border',
  }
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
        meta[level] ?? meta.low
      )}
    >
      {level}
    </span>
  )
}
