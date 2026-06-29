'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { AlertCircle, CheckCircle2, Compass, Mail } from 'lucide-react'

// ── Sekme tipi ─────────────────────────────────────────────────────────────

type AuthTab = 'login' | 'signup'

// ── Ana bileşen ────────────────────────────────────────────────────────────

export function LoginForm() {
  const [tab, setTab] = useState<AuthTab>('login')
  // Kayıt sonrası doğrulama bekleme ekranı
  const [pendingVerification, setPendingVerification] = useState<string | null>(null)

  if (pendingVerification) {
    return <VerificationPending email={pendingVerification} onBack={() => setPendingVerification(null)} />
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
          <Compass className="text-primary size-6" />
        </div>
        <CardTitle className="text-xl">MomTest AI</CardTitle>
        <CardDescription>
          {tab === 'login'
            ? 'Müşteri keşfi çalışma alanına giriş yapın'
            : 'Yeni hesap oluşturun'}
        </CardDescription>
      </CardHeader>

      {/* Sekme geçişi */}
      <div className="flex border-b px-6">
        <TabButton active={tab === 'login'} onClick={() => setTab('login')}>
          Giriş Yap
        </TabButton>
        <TabButton active={tab === 'signup'} onClick={() => setTab('signup')}>
          Kayıt Ol
        </TabButton>
      </div>

      {tab === 'login' ? (
        <LoginFields onVerificationPending={setPendingVerification} />
      ) : (
        <SignupFields onVerificationPending={setPendingVerification} />
      )}
    </Card>
  )
}

// ── TabButton ──────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 pb-3 pt-2 text-sm font-medium transition-colors',
        active
          ? 'text-foreground border-b-2 border-primary -mb-px'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

// ── Giriş formu ────────────────────────────────────────────────────────────

function LoginFields({
  onVerificationPending,
}: {
  onVerificationPending: (email: string) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectedFrom = searchParams.get('redirectedFrom') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      // E-posta doğrulanmamış kullanıcıyı doğrulama ekranına yönlendir
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        onVerificationPending(email.trim())
        setLoading(false)
        return
      }
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'E-posta veya şifre hatalı.'
          : signInError.message
      )
      setLoading(false)
      return
    }

    router.replace(redirectedFrom)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardContent className="flex flex-col gap-4 pt-5">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Giriş başarısız</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-email">E-posta</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="siz@sirket.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-password">Şifre</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      </CardContent>
      <CardFooter className="mt-2">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner data-icon="inline-start" />}
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </Button>
      </CardFooter>
    </form>
  )
}

// ── Kayıt formu ────────────────────────────────────────────────────────────

function SignupFields({
  onVerificationPending,
}: {
  onVerificationPending: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalıdır.')
      return
    }

    setLoading(true)

    const supabase = createClient()
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Callback URL — Supabase doğrulama linkini buraya yönlendirir
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (signUpError) {
      setError(
        signUpError.message.includes('already registered') ||
        signUpError.message.includes('User already registered')
          ? 'Bu e-posta adresiyle zaten bir hesap var. Giriş Yap sekmesini deneyin.'
          : signUpError.message
      )
      setLoading(false)
      return
    }

    // Kayıt başarılı — e-posta doğrulama ekranına geç
    onVerificationPending(email.trim())
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardContent className="flex flex-col gap-4 pt-5">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Kayıt başarısız</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="signup-email">E-posta</Label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="siz@sirket.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="signup-password">Şifre</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            placeholder="En az 8 karakter"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="signup-confirm">Şifre Tekrar</Label>
          <Input
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Şifrenizi tekrar girin"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      </CardContent>
      <CardFooter className="mt-2">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner data-icon="inline-start" />}
          {loading ? 'Hesap oluşturuluyor...' : 'Kayıt Ol'}
        </Button>
      </CardFooter>
    </form>
  )
}

// ── E-posta doğrulama bekleme ekranı ──────────────────────────────────────

function VerificationPending({
  email,
  onBack,
}: {
  email: string
  onBack: () => void
}) {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  async function handleResend() {
    setResending(true)
    setResendError(null)
    setResent(false)

    const supabase = createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setResendError('Mail gönderilemedi. Lütfen biraz bekleyip tekrar deneyin.')
    } else {
      setResent(true)
    }
    setResending(false)
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-amber-500/10">
          <Mail className="size-6 text-amber-400" />
        </div>
        <CardTitle className="text-xl">E-postanı doğrula</CardTitle>
        <CardDescription className="text-balance">
          <strong className="text-foreground">{email}</strong> adresine bir
          doğrulama linki gönderdik. Linke tıkladıktan sonra giriş yapabilirsin.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {resent && (
          <Alert>
            <CheckCircle2 className="text-emerald-500" />
            <AlertTitle>Mail yeniden gönderildi</AlertTitle>
            <AlertDescription>
              Gelen kutunu ve spam klasörünü kontrol et.
            </AlertDescription>
          </Alert>
        )}
        {resendError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{resendError}</AlertDescription>
          </Alert>
        )}

        <p className="text-muted-foreground text-center text-xs">
          Mail gelmediyse spam klasörünü kontrol et. Hâlâ gelmedi mi?
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void handleResend()}
          disabled={resending}
        >
          {resending && <Spinner data-icon="inline-start" />}
          {resending ? 'Gönderiliyor...' : 'Tekrar Gönder'}
        </Button>
      </CardContent>

      <CardFooter>
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground w-full text-center text-xs transition-colors"
        >
          ← Giriş sayfasına dön
        </button>
      </CardFooter>
    </Card>
  )
}
