import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth callback — auth kaldırıldığı için doğrudan dashboard'a yönlendirir.
 */
export function GET(request: NextRequest) {
  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/dashboard`)
}
