import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/index'
import { messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import type { ApiResponse, ConversationMessage } from '@/types/index'

// ---------------------------------------------------------------------------
// GET /api/messages/[interviewId] — bir interview'a ait tüm mesajları döner
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
): Promise<NextResponse<ApiResponse<ConversationMessage[]>>> {
  const { interviewId } = await params

  if (!interviewId) {
    return NextResponse.json(
      { data: null, error: 'interviewId gereklidir.' },
      { status: 400 }
    )
  }

  try {
    const rows = await db
      .select({ sender: messages.sender, content: messages.content })
      .from(messages)
      .where(eq(messages.interview_id, interviewId))
      .orderBy(asc(messages.created_at))

    const conversationMessages: ConversationMessage[] = rows.map((m) => ({
      sender: m.sender as 'agent' | 'participant',
      content: m.content,
    }))

    return NextResponse.json(
      { data: conversationMessages, error: null },
      { status: 200 }
    )
  } catch (err) {
    console.error('[Messages GET] Mesaj geçmişi alınamadı:', err)
    return NextResponse.json(
      { data: null, error: 'Mesaj geçmişi alınamadı.' },
      { status: 500 }
    )
  }
}
