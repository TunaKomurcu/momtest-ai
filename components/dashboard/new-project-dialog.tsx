'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { deriveProjectStatus } from '@/lib/project-status'
import type { Project } from '@/types/database.types'
import type { ApiResponse } from '@/types/index'
import type { DashboardProject } from '@/components/dashboard/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'

export function NewProjectDialog({
  onProjectCreated,
}: {
  onProjectCreated: (project: DashboardProject) => void
}) {
  const [open, setOpen] = useState(false)
  const [productIdea, setProductIdea] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idea = productIdea.trim()
    if (!idea) return

    setLoading(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_idea: idea }),
      })

      const payload = (await res.json()) as ApiResponse<Project>

      if (!res.ok || payload.error || !payload.data) {
        toast.error('Proje oluşturulamadı: ' + (payload.error ?? 'bilinmeyen hata'))
        return
      }

      const project = payload.data
      onProjectCreated({
        ...project,
        status: deriveProjectStatus(project, []),
      })

      toast.success('Yeni proje oluşturuldu.')
      setProductIdea('')
      setOpen(false)
    } catch (err) {
      console.error('[NewProjectDialog] Hata:', err)
      toast.error('Proje oluşturulamadı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="w-full" size="sm" />}>
        <Plus data-icon="inline-start" />
        Yeni Proje Başlat
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni Proje</DialogTitle>
          <DialogDescription>
            Test etmek istediğiniz ürün fikrini kısaca açıklayın. Yapay zeka
            intake sohbetiyle araştırma özetini birlikte oluşturacaksınız.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-idea">Ürün Fikri</Label>
            <Textarea
              id="product-idea"
              placeholder="Örn: Freelancer'lar için otomatik fatura takibi yapan bir mobil uygulama..."
              value={productIdea}
              onChange={(e) => setProductIdea(e.target.value)}
              rows={4}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !productIdea.trim()}>
              {loading && <Spinner data-icon="inline-start" />}
              {loading ? 'Oluşturuluyor...' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
