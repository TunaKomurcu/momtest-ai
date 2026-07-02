import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import type { ApiResponse } from '@/types/index'
import type { Project } from '@/types/database.types'

// ---------------------------------------------------------------------------
// GET /api/projects — tüm projeleri listeler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<ApiResponse<Project[]>>> {
  try {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.created_at))

    return NextResponse.json({ data: rows, error: null }, { status: 200 })
  } catch (err) {
    console.error('[Projects GET] Proje listesi alınamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects — yeni proje oluşturur
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<Project>>> {
  let body: { product_idea: string }

  try {
    body = (await request.json()) as { product_idea: string }
  } catch {
    return NextResponse.json(
      { data: null, error: 'Geçersiz JSON gövdesi.' },
      { status: 400 }
    )
  }

  if (!body.product_idea || body.product_idea.trim().length === 0) {
    return NextResponse.json(
      { data: null, error: 'product_idea alanı boş olamaz.' },
      { status: 400 }
    )
  }

  try {
    const rows = await db
      .insert(projects)
      .values({ product_idea: body.product_idea.trim() })
      .returning()

    const newProject = rows[0]

    if (!newProject) {
      throw new Error('Insert başarısız — returning boş.')
    }

    return NextResponse.json({ data: newProject, error: null }, { status: 201 })
  } catch (err) {
    console.error('[Projects POST] Proje oluşturulamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Proje oluşturulamadı.' },
      { status: 500 }
    )
  }
}
