'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ProjectSidebar } from '@/components/dashboard/project-sidebar'
import { ProjectWorkspace } from '@/components/dashboard/project-workspace'
import type { DashboardProject } from '@/components/dashboard/types'
import type { ProjectStatus } from '@/lib/project-status'

const STORAGE_KEY = 'momtest_selected_project'

export function DashboardWorkspace({
  initialProjects,
}: {
  initialProjects: DashboardProject[]
}) {
  const [projects, setProjects] = useState<DashboardProject[]>(initialProjects)

  // Başlangıçta server ve client aynı render etsin: ilk proje seçili.
  const [selectedId, setSelectedId] = useState<string | null>(initialProjects[0]?.id ?? null)

  // Client'ta mount olduktan sonra localStorage'dan son seçili projeyi oku.
  // Server'daki render ile eşleşmesi için bu okuma useEffect içinde yapılır.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && initialProjects.some((p) => p.id === saved)) {
      setSelectedId(saved)
    }
  }, [initialProjects])

  // selectedId değişince localStorage'a kaydet
  useEffect(() => {
    if (selectedId) {
      localStorage.setItem(STORAGE_KEY, selectedId)
    }
  }, [selectedId])

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  )

  const handleProjectCreated = useCallback((project: DashboardProject) => {
    setProjects((prev) => [project, ...prev])
    setSelectedId(project.id)
  }, [])

  const handleProjectDeleted = useCallback(
    (projectId: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== projectId))
      setSelectedId((prev) => {
        if (prev !== projectId) return prev
        const remaining = projects.filter((p) => p.id !== projectId)
        return remaining[0]?.id ?? null
      })
    },
    [projects]
  )

  const handleStatusChange = useCallback(
    (projectId: string, status: ProjectStatus) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status } : p))
      )
    },
    []
  )

  return (
    <SidebarProvider>
      <ProjectSidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onProjectCreated={handleProjectCreated}
        onProjectDeleted={handleProjectDeleted}
      />
      <SidebarInset className="h-svh overflow-hidden">
        <ProjectWorkspace
          project={selectedProject}
          onStatusChange={handleStatusChange}
        />
      </SidebarInset>
      <Toaster position="top-center" />
    </SidebarProvider>
  )
}
