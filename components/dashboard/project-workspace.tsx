'use client'

import { useEffect, useMemo, useState } from 'react'
import { isIntakeActive, type ProjectStatus } from '@/lib/project-status'
import type { DashboardProject } from '@/components/dashboard/types'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { IntakeChat } from '@/components/dashboard/intake-chat'
import { GenerateStream } from '@/components/dashboard/generate-stream'
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
import { Compass, Lightbulb, MessagesSquare } from 'lucide-react'
import { InterviewManager } from '@/components/dashboard/interview-manager'

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

function ProjectBody({
  project,
  onStatusChange,
}: {
  project: DashboardProject
  onStatusChange: (projectId: string, status: ProjectStatus) => void
}) {
  // Intake, research_brief üretildiğinde tamamlanmış sayılır
  // (status === 'intake' dışındaki her durum brief'in var olduğunu gösterir).
  const [intakeComplete, setIntakeComplete] = useState(
    () => project.status !== 'intake'
  )

  // update client side project:
  const [scriptReady, setScriptReady] = useState(
    () => project.interview_script != null
  )

  // Proje değişince (key sayesinde remount olur ama yine de güvenli olalım).
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
    if (project.status === 'intake') {
      onStatusChange(project.id, 'brief_ready')
    }
  }

  // Intake aktif değilse (interviewing / analyzed) salt-detay görünümü.
  if (!isIntakeActive(project.status)) {
  return (
    <div className="flex flex-1 flex-col overflow-auto p-5">
      <InterviewManager
        projectId={project.id}
        onStatusChange={onStatusChange}
      />
    </div>
  )
}

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
      {/* SOL: Proje detayları + üretim */}
      <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-5">
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
                <GenerateStream
                  projectId={project.id}
                  onDone={handleGenerateDone}
                />
                {scriptReady && (
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
