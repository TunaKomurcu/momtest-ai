'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { NewProjectDialog } from '@/components/dashboard/new-project-dialog'
import type { ApiResponse } from '@/types/index'
import type { DashboardProject } from '@/components/dashboard/types'
import {
  Compass,
  FolderOpen,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

export function ProjectSidebar({
  projects,
  selectedId,
  onSelect,
  onProjectCreated,
  onProjectDeleted,
}: {
  projects: DashboardProject[]
  selectedId: string | null
  onSelect: (id: string) => void
  onProjectCreated: (project: DashboardProject) => void
  onProjectDeleted: (id: string) => void
}) {
  const [deleteTarget, setDeleteTarget] = useState<DashboardProject | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)

    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: 'DELETE',
      })

      const payload = (await res.json()) as ApiResponse<{ id: string }>

      if (!res.ok || payload.error) {
        console.error('[ProjectSidebar] Proje silinemedi:', payload.error)
        setDeleteError('Proje silinemedi. Lütfen tekrar deneyin.')
        return
      }

      onProjectDeleted(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      console.error('[ProjectSidebar] Beklenmeyen hata:', err)
      setDeleteError('Proje silinemedi. Lütfen tekrar deneyin.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Sidebar>
        <SidebarHeader className="gap-3 p-3">
          <div className="flex items-center gap-2 px-1">
            <div className="bg-primary/10 flex size-8 items-center justify-center rounded-lg">
              <Compass className="text-primary size-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight">
                MomTest AI
              </span>
              <span className="text-muted-foreground text-xs leading-tight">
                Müşteri Keşfi
              </span>
            </div>
          </div>
          <NewProjectDialog onProjectCreated={onProjectCreated} />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projeler</SidebarGroupLabel>
            <SidebarGroupContent>
              {projects.length === 0 ? (
                <p className="text-muted-foreground px-2 py-6 text-center text-xs text-balance">
                  Henüz projeniz yok. Yukarıdan yeni bir proje başlatın.
                </p>
              ) : (
                <SidebarMenu>
                  {projects.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <div className="group/item flex w-full items-center gap-1 pr-1">
                        <SidebarMenuButton
                          isActive={project.id === selectedId}
                          onClick={() => onSelect(project.id)}
                          className="h-auto min-w-0 flex-1 flex-col items-start gap-1.5 py-2"
                        >
                          <span className="flex w-full items-center gap-2">
                            <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                            <span className="truncate text-sm font-medium">
                              {project.product_idea}
                            </span>
                          </span>
                          <StatusBadge
                            status={project.status}
                            className="ml-6 text-[10px]"
                          />
                        </SidebarMenuButton>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                className={cn(
                                  'text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-opacity',
                                  'opacity-0 group-hover/item:opacity-100 focus:opacity-100'
                                )}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Proje seçenekleri"
                              />
                            }
                          >
                            <MoreHorizontal className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="w-44">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget(project)
                                  setDeleteError(null)
                                }}
                                className="text-destructive focus:text-destructive gap-2"
                              >
                                <Trash2 className="size-4" />
                                Projeyi Sil
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* Silme onay dialogu */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projeyi sil</DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">
                &ldquo;{deleteTarget?.product_idea}&rdquo;
              </strong>{' '}
              projesini silmek istediğinizden emin misiniz? Bu işlem geri
              alınamaz — projeyle birlikte tüm mülakatlar, mesajlar ve analiz
              raporları kalıcı olarak silinecek.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <p className="text-destructive text-sm">{deleteError}</p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteError(null)
              }}
              disabled={deleting}
            >
              İptal
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
            >
              {deleting && <Spinner data-icon="inline-start" />}
              {deleting ? 'Siliniyor...' : 'Evet, Sil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
