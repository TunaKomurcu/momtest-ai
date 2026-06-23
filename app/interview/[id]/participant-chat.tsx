'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ApiResponse, InterviewResponseData } from '@/types/index'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Bot, Compass, SendHorizonal, User } from 'lucide-react'

type Phase = 'name' | 'chat' | 'done'

interface ChatMessage {
  sender: 'agent' | 'participant'
  content: string
  localId: string
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ParticipantChat({ interviewId }: { interviewId: string }) {
  const [phase, setPhase] = useState<Phase>('name')
  const [nameInput, setNameInput] = useState('')
  const [participantName, setParticipantName] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const startInterview = useCallback(async () => {
    const name = nameInput.trim()
    if (!name || name.length < 2) return

    setStarting(true)
    setError(null)

    try {
      const res = await fetch(`/api/interview/${interviewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Ready', participant_name: name }),
      })

      const payload = (await res.json()) as ApiResponse<InterviewResponseData>

      if (!res.ok || payload.error || !payload.data) {
        setError(payload.error ?? 'Mülakat başlatılamadı. Lütfen tekrar deneyin.')
        return
      }

      setParticipantName(name)
      setMessages([
        { sender: 'agent', content: payload.data.reply, localId: makeId() },
      ])
      setPhase(payload.data.isComplete ? 'done' : 'chat')
    } catch {
      setError('Ağ hatası. Bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setStarting(false)
    }
  }, [nameInput, interviewId])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    setError(null)
    setSending(true)
    setInput('')

    setMessages(prev => [
      ...prev,
      { sender: 'participant', content: text, localId: makeId() },
    ])

    try {
      const res = await fetch(`/api/interview/${interviewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, participant_name: participantName }),
      })

      const payload = (await res.json()) as ApiResponse<InterviewResponseData>

      if (!res.ok || payload.error || !payload.data) {
        setError(payload.error ?? 'Yanıt alınamadı. Lütfen tekrar deneyin.')
        setSending(false)
        return
      }

      setMessages(prev => [
        ...prev,
        { sender: 'agent', content: payload.data.reply, localId: makeId() },
      ])

      if (payload.data.isComplete) {
        setPhase('done')
      }
    } catch {
      setError('Ağ hatası. Lütfen tekrar deneyin.')
    } finally {
      setSending(false)
    }
  }, [input, sending, interviewId, participantName])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ── İsim giriş ekranı ────────────────────────────────────────────────────
  if (phase === 'name') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
              <Compass className="text-primary size-6" />
            </div>
            <h1 className="text-lg font-semibold">Müşteri Araştırma Mülakatı</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Bu kısa bir araştırma görüşmesidir. Doğru veya yanlış cevap yoktur
              — sadece gerçek deneyiminizi anlamak istiyoruz.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="participant-name">Adınız</Label>
              <Input
                id="participant-name"
                placeholder="örn. Ayşe"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void startInterview()
                }}
                autoFocus
              />
            </div>

            {error && <p className="text-destructive text-xs">{error}</p>}

            <Button
              onClick={() => void startInterview()}
              disabled={starting || nameInput.trim().length < 2}
            >
              {starting && <Spinner data-icon="inline-start" />}
              {starting ? 'Başlanıyor...' : 'Mülakata Başla'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Teşekkür ekranı ──────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="bg-emerald-500/15 flex size-12 items-center justify-center rounded-xl">
            <Compass className="text-emerald-400 size-6" />
          </div>
          <h1 className="text-lg font-semibold">
            Teşekkürler, {participantName}!
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            Bu gerçekten çok yardımcı oldu. Cevaplarınız daha iyi ürünler
            oluşturmaya katkı sağlayacak. Bu pencereyi kapatabilirsiniz.
          </p>
        </div>
      </div>
    )
  }

  // ── Sohbet ekranı ────────────────────────────────────────────────────────
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="bg-primary/10 flex size-7 items-center justify-center rounded-lg">
          <Compass className="text-primary size-4" />
        </div>
        <span className="text-sm font-semibold">Araştırma Mülakatı</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {participantName}
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="mx-auto flex max-w-2xl flex-col gap-4 p-4"
        >
          {messages.map(message => (
            <MessageBubble key={message.localId} message={message} />
          ))}

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
        <div className="mx-auto max-w-2xl">
          {error && (
            <p className="text-destructive mb-2 px-1 text-xs">{error}</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Cevabınızı yazın... (Göndermek için Enter)"
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
        {renderMarkdown(message.content)}
      </div>
    </div>
  )
}