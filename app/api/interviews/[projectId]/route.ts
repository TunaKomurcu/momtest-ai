import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { interviews } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { ApiResponse } from '@/types/index'
import type { Interview } from '@/types/database.types'

type InterviewSummary = Pick<
  Interview,
  'id' | 'participant_name' | 'status' | 'created_at' | 'evidence_report' | 'signal_score'
>

// ---------------------------------------------------------------------------
// GET /api/interviews/[projectId] — bir projeye ait tüm interview'ları döner
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<InterviewSummary[]>>> {
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json(
      { data: null, error: 'projectId gereklidir.' },
      { status: 400 }
    )
  }

  try {
    const rows = await db
      .select({
        id: interviews.id,
        participant_name: interviews.participant_name,
        status: interviews.status,
        created_at: interviews.created_at,
        evidence_report: interviews.evidence_report,
        signal_score: interviews.signal_score,
      })
      .from(interviews)
      .where(eq(interviews.project_id, projectId))
      .orderBy(desc(interviews.created_at))

    return NextResponse.json({ data: rows, error: null }, { status: 200 })
  } catch (err) {
    console.error('[Interviews GET] Mülakat listesi alınamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Mülakat listesi alınamadı.' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/interviews/[projectId] — yeni mülakat oluşturur
// ---------------------------------------------------------------------------

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse<ApiResponse<InterviewSummary>>> {
  const { projectId } = await params

  if (!projectId) {
    return NextResponse.json(
      { data: null, error: 'projectId gereklidir.' },
      { status: 400 }
    )
  }

  try {
    const rows = await db
      .insert(interviews)
      .values({
        project_id: projectId,
        participant_name: 'Katılımcı',
        status: 'pending',
      })
      .returning({
        id: interviews.id,
        participant_name: interviews.participant_name,
        status: interviews.status,
        created_at: interviews.created_at,
        evidence_report: interviews.evidence_report,
        signal_score: interviews.signal_score,
      })

    const newInterview = rows[0]

    if (!newInterview) {
      throw new Error('Insert başarısız — returning boş.')
    }

    return NextResponse.json(
      { data: newInterview, error: null },
      { status: 201 }
    )
  } catch (err) {
    console.error('[Interviews POST] Mülakat oluşturulamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Mülakat oluşturulamadı.' },
      { status: 500 }
    )
  }
}
