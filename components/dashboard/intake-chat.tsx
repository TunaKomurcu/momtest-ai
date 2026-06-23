'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type {
  ApiResponse,
  IntakeResponseData,
  ConversationMessage,
} from '@/types/index'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Bot, SendHorizonal, User } from 'lucide-react'

interface ChatMessage extends ConversationMessage {
  /** İstemci tarafı geçici id — render key'i için. */
  localId: string
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function IntakeChat({
  projectId,
  disabled = false,
  onComplete,
}: {
  projectId: string
  /** Intake tamamlandıysa veya proje salt-okunur ise input kapatılır. */
  disabled?: boolean
  /** Backend isComplete=true döndüğünde tetiklenir. */
  onComplete: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  // --- Geçmiş intake mesajlarını yükle (proje değişince) ---
  useEffect(() => {
    let active = true
    setLoadingHistory(true)
    setError(null)

    const supabase = createClient()
    supabase
      .from('messages')
      .select('sender, content, created_at')
      .eq('interview_id', projectId)
      .order('created_at', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) {
          setError('Sohbet geçmişi yüklenemedi.')
          setMessages([])
        } else {
          setMessages(
            (data ?? []).map((m) => ({
              sender: m.sender as 'agent' | 'participant',
              content: m.content,
              localId: makeId(),
            }))
          )
        }
        setLoadingHistory(false)
      })

    return () => {
      active = false
    }
  }, [projectId])

  // --- Yeni mesajda en alta kaydır ---
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending || disabled) return

    setError(null)
    setSending(true)
    setInput('')

    // Kullanıcı mesajını iyimser olarak ekle.
    setMessages((prev) => [
      ...prev,
      { sender: 'participant', content: text, localId: makeId() },
    ])

    try {
      const res = await fetch(`/api/intake/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      const payload = (await res.json()) as ApiResponse<IntakeResponseData>

      if (!res.ok || payload.error || !payload.data) {
        setError(payload.error ?? 'Yanıt alınamadı. Lütfen tekrar deneyin.')
        return
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: 'agent',
          content: payload.data.reply,
          localId: makeId(),
        },
      ])

      if (payload.data.isComplete) {
        onComplete()
      }
    } catch {
      setError('Ağ hatası. Bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setSending(false)
    }
  }, [input, sending, disabled, projectId, onComplete])

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col gap-4 p-4">
          {loadingHistory ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Spinner />
              Sohbet yükleniyor...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-muted-foreground mx-auto max-w-xs py-10 text-center text-sm text-balance">
              Intake sohbetini başlatmak için ürün fikrinizi ve kime yönelik
              olduğunu birkaç cümleyle anlatın. Yapay zeka, test edilebilir bir
              araştırma özeti çıkarana kadar soru soracak.
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.localId} message={message} />
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 px-1">
              <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
                <Bot className="size-4" />
              </span>
              <span className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner className="size-3.5" />
                Düşünüyor...
              </span>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        {error && (
          <p className="text-destructive mb-2 px-1 text-xs">{error}</p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Intake tamamlandı.'
                : 'Yanıtınızı yazın... (Enter ile gönder)'
            }
            disabled={disabled || sending}
            rows={2}
            className="max-h-36 min-h-0 resize-none"
          />
          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
            disabled={disabled || sending || !input.trim()}
            aria-label="Gönder"
          >
            {sending ? <Spinner /> : <SendHorizonal className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split('\n').map((line, lineIdx) => (
    <span key={lineIdx}>
      {lineIdx > 0 && <br />}
      {line.split(/(\*\*[^*\n]+\*\*)/).map((part, partIdx) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={partIdx}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={partIdx}>{part}</span>
        )
      )}
    </span>
  ))
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAgent = message.sender === 'agent'

  // <research_brief> blokunu kullanıcıya ham göstermeyelim — temizle.
  const display = isAgent
    ? message.content.replace(/<research_brief>[\s\S]*?<\/research_brief>/g, '').trim() ||
      message.content
    : message.content

  return (
    <div
      className={cn(
        'flex items-start gap-2',
        isAgent ? 'flex-row' : 'flex-row-reverse'
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isAgent
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {isAgent ? <Bot className="size-4" /> : <User className="size-4" />}
      </span>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isAgent
            ? 'bg-muted text-foreground'
            : 'bg-primary text-primary-foreground'
        )}
      >
        {renderMarkdown(display)}
      </div>
    </div>
  )
}
