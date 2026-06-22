'use client'

import { useRouter } from 'next/navigation'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { NewProjectDialog } from '@/components/dashboard/new-project-dialog'
import type { DashboardProject } from '@/components/dashboard/types'
import { Compass, LogOut, ChevronsUpDown, FolderOpen } from 'lucide-react'

export function ProjectSidebar({
  projects,
  selectedId,
  userEmail,
  onSelect,
  onProjectCreated,
}: {
  projects: DashboardProject[]
  selectedId: string | null
  userEmail: string
  onSelect: (id: string) => void
  onProjectCreated: (project: DashboardProject) => void
}) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/auth/login')
    router.refresh()
  }

  const initials = userEmail.slice(0, 2).toUpperCase() || 'ME'

  return (
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
                    <SidebarMenuButton
                      isActive={project.id === selectedId}
                      onClick={() => onSelect(project.id)}
                      className="h-auto flex-col items-start gap-1.5 py-2"
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
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent"
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
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className={cn('w-(--radix-dropdown-menu-trigger-width) min-w-56')}
              >
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  {userEmail}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleLogout}>
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
  )
}
