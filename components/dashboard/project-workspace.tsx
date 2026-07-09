'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { isIntakeActive, type ProjectStatus } from '@/lib/project-status'
import type { DashboardProject } from '@/components/dashboard/types'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { IntakeChat } from '@/components/dashboard/intake-chat'
import { GenerateStream } from '@/components/dashboard/generate-stream'
import { BriefViewer } from '@/components/dashboard/brief-viewer'
import { InterviewManager } from '@/components/dashboard/interview-manager'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Compass, FileText, Lightbulb, MessageSquareText, MessagesSquare, Users } from 'lucide-react'

// ── Sekme tipi ────────────────────────────────────────────────────────────────

type WorkspaceTab = 'briefs' | 'interviews' | 'intake'

// ── ProjectWorkspace ──────────────────────────────────────────────────────────

export function ProjectWorkspace({
  project,
  onStatusChange,
}: {
  project: DashboardProject | null
  onStatusChange: (projectId: string, status: ProjectStatus) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-5" />
        {project ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="truncate text-sm font-semibold">
              {project.product_idea}
            </h1>
            <StatusBadge status={project.status} className="shrink-0" />
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">Çalışma Alanı</span>
        )}
      </header>

      {project ? (
        <ProjectBody
          key={project.id}
          project={project}
          onStatusChange={onStatusChange}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Compass />
              </EmptyMedia>
              <EmptyTitle>Proje seçin veya yeni bir tane oluşturun</EmptyTitle>
              <EmptyDescription>
                Soldaki listeden bir proje seçin ya da &quot;Yeni Proje
                Başlat&quot; ile bir ürün fikrini test etmeye başlayın.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}

// ── ProjectBody ───────────────────────────────────────────────────────────────

function ProjectBody({
  project,
  onStatusChange,
}: {
  project: DashboardProject
  onStatusChange: (projectId: string, status: ProjectStatus) => void
}) {
  const [intakeComplete, setIntakeComplete] = useState(
    () => project.status !== 'intake'
  )
  const [scriptReady, setScriptReady] = useState(
    () => project.interview_script != null
  )
  // Canlı brief verisi: generate tamamlanınca güncellenir
  const [liveBrief, setLiveBrief] = useState(
    () => project.research_brief
  )
  const [liveScript, setLiveScript] = useState(
    () => project.interview_script
  )

  useEffect(() => {
    setIntakeComplete(project.status !== 'intake')
  }, [project.status])

  const createdLabel = useMemo(() => {
    try {
      return new Date(project.created_at).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }, [project.created_at])

  function handleIntakeComplete() {
    setIntakeComplete(true)
    if (project.status === 'intake') {
      onStatusChange(project.id, 'brief_ready')
    }
  }

  function handleGenerateDone() {
    setScriptReady(true)
    onStatusChange(project.id, 'interviewing')
    // DB'den güncel brief + script'i çek
    fetch(`/api/projects/${project.id}`)
      .then((res) => res.json() as Promise<{ data: { research_brief: unknown; interview_script: unknown } | null; error: string | null }>)
      .then((payload) => {
        if (payload.data) {
          setLiveBrief(payload.data.research_brief)
          setLiveScript(payload.data.interview_script)
        }
      })
      .catch(() => {
        // Sessiz fail — sayfa yenilenince DB'den gelir
      })
  }

  // ── interviewing / analyzed: sekmeli layout ───────────────────────────────
  if (!isIntakeActive(project.status)) {
    return (
      <TabbedWorkspace
        project={project}
        onStatusChange={onStatusChange}
      />
    )
  }

  // ── intake / brief_ready: 2 sütun layout ─────────────────────────────────
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
      {/* SOL: Proje detayları + üretim + brief viewer */}
      <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-5">
            {/* Ürün fikri */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                  <Lightbulb className="size-4" />
                </span>
                <h2 className="text-sm font-semibold">Ürün Fikri</h2>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {project.product_idea}
              </p>
            </div>

            <Separator />

            {/* Meta */}
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">Durum</dt>
                <dd>
                  <StatusBadge status={project.status} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">Oluşturulma</dt>
                <dd className="font-medium">{createdLabel}</dd>
              </div>
            </dl>

            {intakeComplete && (
              <>
                <Separator />
                {/* GenerateStream: brief/script üretimi */}
                <GenerateStream
                  projectId={project.id}
                  onDone={handleGenerateDone}
                />

                {/* BriefViewer: DB'den okunan kalıcı brief */}
                {(liveBrief ?? liveScript) && (
                  <>
                    <Separator />
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                          <FileText className="size-4" />
                        </span>
                        <h2 className="text-sm font-semibold">Araştırma Dökümanları</h2>
                      </div>
                      <BriefViewer
                        projectId={project.id}
                        productIdea={project.product_idea}
                        researchBrief={liveBrief}
                        interviewScript={liveScript}
                      />
                    </div>
                  </>
                )}

                {/* InterviewManager: intake tamamlandıysa her zaman göster */}
                {intakeComplete && (
                  <>
                    <Separator />
                    <InterviewManager
                      projectId={project.id}
                      onStatusChange={onStatusChange}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </section>

      {/* SAĞ: Intake sohbeti */}
      <section className="flex min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
            <MessagesSquare className="size-4" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold leading-tight">
              Intake Sohbeti
            </h2>
            <p className="text-muted-foreground text-xs leading-tight">
              Araştırma özetini birlikte oluşturun
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <IntakeChat
            projectId={project.id}
            disabled={intakeComplete}
            onComplete={handleIntakeComplete}
          />
        </div>
      </section>
    </div>
  )
}

// ── TabbedWorkspace — interviewing / analyzed ─────────────────────────────────

function TabbedWorkspace({
  project,
  onStatusChange,
}: {
  project: DashboardProject
  onStatusChange: (projectId: string, status: ProjectStatus) => void
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('interviews')

  const hasBriefs =
    project.research_brief != null || project.interview_script != null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sekme başlık çubuğu */}
      <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
        <WorkspaceTabButton
          active={activeTab === 'interviews'}
          onClick={() => setActiveTab('interviews')}
          icon={<Users className="size-3.5" />}
          label="Mülakatlar"
        />
        <WorkspaceTabButton
          active={activeTab === 'briefs'}
          onClick={() => setActiveTab('briefs')}
          icon={<FileText className="size-3.5" />}
          label="Araştırma Dökümanları"
          badge={hasBriefs ? undefined : undefined}
        />
        <WorkspaceTabButton
          active={activeTab === 'intake'}
          onClick={() => setActiveTab('intake')}
          icon={<MessageSquareText className="size-3.5" />}
          label="Intake Geçmişi"
        />
      </div>

      {/* Sekme içerikleri */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'interviews' && (
          <div className="p-5">
            <InterviewManager
              projectId={project.id}
              onStatusChange={onStatusChange}
            />
          </div>
        )}

        {activeTab === 'briefs' && (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-6 p-5">
              {/* Ürün fikri özeti */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                    <Lightbulb className="size-4" />
                  </span>
                  <h2 className="text-sm font-semibold">Ürün Fikri</h2>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {project.product_idea}
                </p>
              </div>

              <Separator />

              {/* Üret butonu — brief kayıpsa veya yeniden üretmek istiyorsa */}
              <GenerateStream
                projectId={project.id}
                onDone={() => {
                  // Sayfa yenilenince DB'den güncel veri gelir
                  window.location.reload()
                }}
              />

              {/* Brief içerikleri */}
              {!!(project.research_brief ?? project.interview_script) && (
                <>
                  <Separator />
                  <BriefViewer
                    projectId={project.id}
                    productIdea={project.product_idea}
                    researchBrief={project.research_brief}
                    interviewScript={project.interview_script}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        )}
        {activeTab === 'intake' && (
          <div className="flex h-full min-h-0 flex-col">
            {/* Başlık */}
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
              <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                <MessagesSquare className="size-4" />
              </span>
              <div className="flex flex-col">
                <h2 className="text-sm font-semibold leading-tight">
                  Intake Sohbeti Geçmişi
                </h2>
                <p className="text-muted-foreground text-xs leading-tight">
                  Salt okunur — araştırma özetine esas olan konuşma
                </p>
              </div>
            </div>
            {/* IntakeChat disabled modda: input kapalı, geçmiş görünür */}
            <div className="min-h-0 flex-1">
              <IntakeChat
                projectId={project.id}
                disabled
                onComplete={() => {
                  // readonly modda tamamlanma eventi tetiklenmez
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── WorkspaceTabButton ─────────────────────────────────────────────────────────

function WorkspaceTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
    >
      {icon}
      {label}
      {badge && (
        <span className="bg-primary/20 text-primary ml-0.5 rounded px-1 text-[10px]">
          {badge}
        </span>
      )}
    </button>
  )
}
