import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { PROJECT_STATUS_META, type ProjectStatus } from '@/lib/project-status'

export function StatusBadge({
  status,
  className,
}: {
  status: ProjectStatus
  className?: string
}) {
  const meta = PROJECT_STATUS_META[status]

  return (
    <Badge className={cn('gap-1.5 font-medium', meta.badgeClass, className)}>
      <span className={cn('size-1.5 rounded-full', meta.dotClass)} />
      {meta.label}
    </Badge>
  )
}
