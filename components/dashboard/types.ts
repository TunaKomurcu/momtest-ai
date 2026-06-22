import type { Project } from '@/types/database.types'
import type { ProjectStatus } from '@/lib/project-status'

/** Dashboard'da kullanılan, türetilmiş durumla zenginleştirilmiş proje. */
export interface DashboardProject extends Project {
  status: ProjectStatus
}
