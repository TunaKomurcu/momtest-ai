'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

    fetch(`/api/messages/${projectId}`)
      .then((res) => res.json() as Promise<ApiResponse<ConversationMessage[]>>)
      .then((payload) => {
        if (!active) return
        if (payload.error || !payload.data) {
          setError('Sohbet geçmişi yüklenemedi.')
          setMessages([])
        } else {
          setMessages(
            payload.data.map((m) => ({
              sender: m.sender,
              content: m.content,
              localId: makeId(),
            }))
          )
        }
        setLoadingHistory(false)
      })
      .catch(() => {
        if (!active) return
        setError('Sohbet geçmişi yüklenemedi.')
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
        { sender: 'agent', content: payload.data.reply, localId: makeId() },
      ])

      if (payload.data.isComplete) {
        onComplete()
      }
    } catch {
      setError('Ağ hatası. Lütfen tekrar deneyin.')
    } finally {
      setSending(false)
    }
  }, [input, sending, disabled, projectId, onComplete])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="flex flex-col gap-4 p-4"
        >
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Ürün fikrinizi anlatarak sohbeti başlatın.
            </p>
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

      {!disabled && (
        <div className="border-t p-3">
          {error && (
            <p className="text-destructive mb-2 px-1 text-xs">{error}</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Mesajınızı yazın... (Göndermek için Enter)"
              disabled={sending}
              rows={2}
              className="max-h-36 min-h-0 resize-none"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              aria-label="Gönder"
            >
              {sending ? (
                <Spinner />
              ) : (
                <SendHorizonal className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {disabled && error && (
        <p className="text-destructive px-4 pb-3 text-xs">{error}</p>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAgent = message.sender === 'agent'

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
        {message.content}
      </div>
    </div>
  )
}
