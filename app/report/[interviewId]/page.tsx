import { redirect } from 'next/navigation'
import { db } from '@/lib/db/index'
import { interviews, messages } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { EvidenceReport } from './evidence-report'

export default async function ReportPage({
  params,
}: {
  params: Promise<{ interviewId: string }>
}) {
  const { interviewId } = await params

  // Interview'u çek
  const interviewRows = await db
    .select({
      id: interviews.id,
      participant_name: interviews.participant_name,
      signal_score: interviews.signal_score,
      evidence_report: interviews.evidence_report,
    })
    .from(interviews)
    .where(eq(interviews.id, interviewId))
    .limit(1)
    .catch(() => [])

  const interview = interviewRows[0]

  if (!interview || !interview.evidence_report) {
    redirect('/dashboard')
  }

  // Transkript mesajlarını çek
  const messageRows = await db
    .select({
      id: messages.id,
      sender: messages.sender,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.interview_id, interviewId))
    .orderBy(asc(messages.created_at))
    .catch(() => [])

  return (
    <EvidenceReport
      interview={{
        participant_name: interview.participant_name,
        signal_score: interview.signal_score,
        evidence_report: interview.evidence_report,
      }}
      messages={
        messageRows as Array<{
          id: string
          sender: 'agent' | 'participant'
          content: string
        }>
      }
    />
  )
}
