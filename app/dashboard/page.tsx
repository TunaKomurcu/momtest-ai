import { db } from '@/lib/db/index'
import { projects, interviews } from '@/lib/db/schema'
import { desc, inArray } from 'drizzle-orm'
import { deriveProjectStatus } from '@/lib/project-status'
import type { Project, Interview } from '@/types/database.types'
import type { DashboardProject } from '@/components/dashboard/types'
import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace'

export default async function DashboardPage() {
  // Tüm projeleri çek
  const projectRows = await db
    .select()
    .from(projects)
    .orderBy(desc(projects.created_at))
    .catch((err) => {
      console.error('[Dashboard] Proje listesi alınamadı:', err)
      return [] as Project[]
    })

  // Durum türetmek için ilgili mülakatları çek
  let interviewRows: Pick<Interview, 'project_id' | 'evidence_report' | 'signal_score'>[] = []

  if (projectRows.length > 0) {
    interviewRows = await db
      .select({
        project_id: interviews.project_id,
        evidence_report: interviews.evidence_report,
        signal_score: interviews.signal_score,
      })
      .from(interviews)
      .where(inArray(interviews.project_id, projectRows.map((p) => p.id)))
      .catch((err) => {
        console.error('[Dashboard] Mülakat listesi alınamadı:', err)
        return []
      })
  }

  const dashboardProjects: DashboardProject[] = projectRows.map((project) => ({
    ...project,
    status: deriveProjectStatus(
      project,
      interviewRows.filter((i) => i.project_id === project.id)
    ),
  }))

  return (
    <DashboardWorkspace
      initialProjects={dashboardProjects}
    />
  )
}
