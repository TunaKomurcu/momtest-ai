import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase auth callback handler.
 * E-posta onayı / OAuth dönüşünde gelen `code`'u oturuma çevirir
 * ve kullanıcıyı hedef sayfaya yönlendirir.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Kod yok ya da değişim başarısız — login'e dön.
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
}
