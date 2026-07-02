import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware — auth kaldırıldığı için tüm istekler doğrudan geçer.
 */
export function proxy(request: NextRequest) {
  return NextResponse.next({ request })
}

export const config = { matcher: [] }
