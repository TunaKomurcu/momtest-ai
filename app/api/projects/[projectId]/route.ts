import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ApiResponse } from '@/types/index'
import type { Project } from '@/types/database.types'

// ---------------------------------------------------------------------------
// GET /api/projects/[projectId] — projeyi döner (brief + script dahil)
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<Project>>> {
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json(
      { data: null, error: 'projectId gereklidir.' },
      { status: 400 }
    )
  }

  try {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!rows[0]) {
      return NextResponse.json(
        { data: null, error: 'Proje bulunamadı.' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { data: rows[0], error: null },
      { status: 200 }
    )
  } catch (err) {
    console.error('[Projects GET] Proje alınamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Sunucu hatası.' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/[projectId] — projeyi siler
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<{ id: string }>>> {
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json(
      { data: null, error: 'projectId gereklidir.' },
      { status: 400 }
    )
  }

  try {
    // Intake mesajları projects.id ile kaydedildiği için DB cascade kapsamı dışındadır.
    // Proje silinmeden önce manuel olarak temizlenir.
    await db
      .delete(messages)
      .where(eq(messages.interview_id, projectId))

    const deletedRows = await db
      .delete(projects)
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id })

    if (deletedRows.length === 0) {
      return NextResponse.json(
        { data: null, error: 'Proje bulunamadı.' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { data: { id: projectId }, error: null },
      { status: 200 }
    )
  } catch (err) {
    console.error('[Projects DELETE] Proje silinemedi:', err)
    return NextResponse.json(
      { data: null, error: 'Proje silinemedi.' },
      { status: 500 }
    )
  }
}
