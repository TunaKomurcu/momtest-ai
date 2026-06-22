'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { deriveProjectStatus } from '@/lib/project-status'
import type { Project } from '@/types/database.types'
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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [productIdea, setProductIdea] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idea = productIdea.trim()
    if (!idea) return

    setLoading(true)
    const supabase = createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      toast.error('Oturum bulunamadı. Lütfen tekrar giriş yapın.')
      setLoading(false)
      router.replace('/auth/login')
      return
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: user.id, product_idea: idea })
      .select('*')
      .single()

    if (error || !data) {
      toast.error('Proje oluşturulamadı: ' + (error?.message ?? 'bilinmeyen hata'))
      setLoading(false)
      return
    }

    const project = data as Project
    onProjectCreated({
      ...project,
      status: deriveProjectStatus(project, []),
    })

    toast.success('Yeni proje oluşturuldu.')
    setProductIdea('')
    setLoading(false)
    setOpen(false)
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
