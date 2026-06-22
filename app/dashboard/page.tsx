import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { deriveProjectStatus } from '@/lib/project-status'
import type { Project, Interview } from '@/types/database.types'
import type { DashboardProject } from '@/components/dashboard/types'
import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Kullanıcının projeleri (RLS zaten user_id ile sınırlar).
  const { data: projectsData } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  const projects = (projectsData ?? []) as Project[]

  // Durum türetmek için ilgili mülakatları çek.
  let interviews: Pick<
    Interview,
    'project_id' | 'evidence_report' | 'signal_score'
  >[] = []

  if (projects.length > 0) {
    const { data: interviewsData } = await supabase
      .from('interviews')
      .select('project_id, evidence_report, signal_score')
      .in(
        'project_id',
        projects.map((p) => p.id)
      )
    interviews = interviewsData ?? []
  }

  const dashboardProjects: DashboardProject[] = projects.map((project) => ({
    ...project,
    status: deriveProjectStatus(
      project,
      interviews.filter((i) => i.project_id === project.id)
    ),
  }))

  return (
    <DashboardWorkspace
      initialProjects={dashboardProjects}
      userEmail={user.email ?? ''}
    />
  )
}
