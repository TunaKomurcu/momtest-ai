'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { NewProjectDialog } from '@/components/dashboard/new-project-dialog'
import type { DashboardProject } from '@/components/dashboard/types'
import {
  Compass,
  LogOut,
  ChevronsUpDown,
  FolderOpen,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

export function ProjectSidebar({
  projects,
  selectedId,
  userEmail,
  onSelect,
  onProjectCreated,
  onProjectDeleted,
}: {
  projects: DashboardProject[]
  selectedId: string | null
  userEmail: string
  onSelect: (id: string) => void
  onProjectCreated: (project: DashboardProject) => void
  onProjectDeleted: (id: string) => void
}) {
  // Silinecek projeyi tutar — null ise dialog kapalı
  const [deleteTarget, setDeleteTarget] = useState<DashboardProject | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Hard navigation: cookie'leri ve tüm client state'i temizler
    window.location.href = '/auth/login'
  }

  // ── Proje silme ───────────────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', deleteTarget.id)

    if (error) {
      console.error(`[Supabase Error] Proje silinemedi: ${error.message} (${error.code})`)
      setDeleteError('Proje silinemedi. Lütfen tekrar deneyin.')
      setDeleting(false)
      return
    }

    onProjectDeleted(deleteTarget.id)
    setDeleteTarget(null)
    setDeleting(false)
  }

  const initials = userEmail.slice(0, 2).toUpperCase() || 'ME'

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
                        {/* Proje butonu */}
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

                        {/* Üç nokta menü — hover'da görünür */}
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

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent"
                    />
                  }
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col text-left leading-tight">
                    <span className="truncate text-sm font-medium">Hesap</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {userEmail}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className={cn('w-(--radix-dropdown-menu-trigger-width) min-w-56')}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                      {userEmail}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => void handleLogout()}>
                      <LogOut />
                      Çıkış Yap
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Silme onay dialogu — Sidebar dışında render edilir, z-index sorunu olmaz */}
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
