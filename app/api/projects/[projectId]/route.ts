import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ApiResponse } from '@/types/index'

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
