import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Oturum yenileme + rota koruması.
 * - /dashboard: kimliği doğrulanmamış kullanıcıyı /auth/login'e yönlendirir.
 * - /api/*: kimliği doğrulanmamış istekleri 401 JSON ile reddeder
 *   (public katılımcı uçları /api/interview ve auth callback hariç).
 *
 * Next.js 16: middleware.ts → proxy.ts, export adı middleware → proxy
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // ÖNEMLİ: getUser() oturum token'ını yeniler ve cookie'leri günceller.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public katılımcı mülakat ucu — auth gerektirmez.
  const isPublicApi = pathname.startsWith('/api/interview')

  // Sayfa koruması: /dashboard
  if (!user && pathname.startsWith('/dashboard')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    loginUrl.searchParams.set('redirectedFrom', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // API koruması: /api/* (public uçlar hariç)
  if (!user && pathname.startsWith('/api') && !isPublicApi) {
    return NextResponse.json(
      { data: null, error: 'Kimlik doğrulaması gereklidir.' },
      { status: 401 }
    )
  }

  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
}
