'use client'

import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { GenerateStreamChunk } from '@/types/index'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
  CheckCircle2,
  FileText,
  ListChecks,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'

type RunState = 'idle' | 'streaming' | 'done' | 'error'

/**
 * /api/generate/[projectId] SSE akışını tüketir.
 * Gelen chunk'ları `stage`'e göre iki panele (Research Brief / Interview Script)
 * canlı olarak append eder.
 */
export function GenerateStream({
  projectId,
  onDone,
}: {
  projectId: string
  /** Akış 'done' aşamasına ulaştığında tetiklenir. */
  onDone?: () => void
}) {
  const [state, setState] = useState<RunState>('idle')
  const [brief, setBrief] = useState('')
  const [script, setScript] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    setState('streaming')
    setBrief('')
    setScript('')
    setErrorMessage(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/generate/${projectId}`, {
        method: 'POST',
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // Hata gövdesi düz JSON olabilir.
        let message = 'Üretim başlatılamadı.'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          /* yoksay */
        }
        setErrorMessage(message)
        setState('error')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let sawDone = false

      // SSE: "data: <json>\n\n" — satır bazlı oku.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const evt of events) {
          const line = evt.trim()
          if (!line.startsWith('data:')) continue

          const json = line.slice(line.indexOf('data:') + 5).trim()
          if (!json) continue

          let chunk: GenerateStreamChunk
          try {
            chunk = JSON.parse(json) as GenerateStreamChunk
          } catch {
            continue
          }

          if (chunk.stage === 'research_brief') {
            setBrief((prev) => prev + chunk.content)
          } else if (chunk.stage === 'interview_script') {
            setScript((prev) => prev + chunk.content)
          } else if (chunk.stage === 'error') {
            setErrorMessage(chunk.content || 'Üretim sırasında hata oluştu.')
            setState('error')
            return
          } else if (chunk.stage === 'done') {
            sawDone = true
          }
        }
      }

      if (sawDone) {
        setState('done')
        onDone?.()
      } else {
        setState('done')
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setErrorMessage('Akış sırasında bağlantı hatası oluştu.')
      setState('error')
    } finally {
      abortRef.current = null
    }
  }, [projectId, onDone])

  const isStreaming = state === 'streaming'
  const hasOutput = brief.length > 0 || script.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">Araştırma Üretimi</h3>
          <p className="text-muted-foreground text-xs text-balance">
            Intake tamamlandı. Araştırma özeti ve mülakat scripti oluşturun.
          </p>
        </div>
        <Button onClick={() => void run()} disabled={isStreaming} size="sm">
          {isStreaming ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Sparkles data-icon="inline-start" className="size-4" />
          )}
          {isStreaming
            ? 'Üretiliyor...'
            : state === 'done'
              ? 'Yeniden Üret'
              : 'Üret'}
        </Button>
      </div>

      {state === 'error' && errorMessage && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {(hasOutput || isStreaming || state === 'done') && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
          <OutputPanel
            title="Research Brief"
            icon={<FileText className="size-4" />}
            content={brief}
            active={isStreaming && brief.length === 0}
            complete={state === 'done' && brief.length > 0}
          />
          <OutputPanel
            title="Interview Script"
            icon={<ListChecks className="size-4" />}
            content={script}
            active={isStreaming && brief.length > 0 && script.length === 0}
            complete={state === 'done' && script.length > 0}
          />
        </div>
      )}
    </div>
  )
}

function OutputPanel({
  title,
  icon,
  content,
  active,
  complete,
}: {
  title: string
  icon: React.ReactNode
  content: string
  active: boolean
  complete: boolean
}) {
  return (
    <div className="bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium">{title}</span>
        {active && <Spinner className="text-muted-foreground ml-auto size-3.5" />}
        {complete && (
          <CheckCircle2 className="ml-auto size-4 text-emerald-500" />
        )}
      </div>
      <ScrollArea className="min-h-40 flex-1">
        <pre
          className={cn(
            'whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed',
            content ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {content || (active ? 'Akış bekleniyor...' : 'Henüz içerik yok.')}
        </pre>
      </ScrollArea>
    </div>
  )
}
