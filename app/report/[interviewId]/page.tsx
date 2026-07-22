import { redirect } from 'next/navigation'
import { db } from '@/lib/db/index'
import { interviews, messages, projects } from '@/lib/db/schema'
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
      project_id: interviews.project_id,
      participant_name: interviews.participant_name,
      participant_role: interviews.participant_role,
      signal_score: interviews.signal_score,
      evidence_report: interviews.evidence_report,
      analysis_json: interviews.analysis_json,
      analyzed_at: interviews.analyzed_at,
    })
    .from(interviews)
    .where(eq(interviews.id, interviewId))
    .limit(1)
    .catch(() => [])

  const interview = interviewRows[0]

  console.log('[ReportPage] Interview data:', {
    id: interview?.id,
    has_analysis_json: !!interview?.analysis_json,
    analysis_json_keys: interview?.analysis_json ? Object.keys(interview.analysis_json as Record<string, unknown>) : [],
    has_signal_score: !!interview?.signal_score,
    participant_role: interview?.participant_role,
    analyzed_at: interview?.analyzed_at,
  })

  if (!interview || !interview.evidence_report) {
    redirect('/dashboard')
  }

  // Proje adını çek
  const projectRows = await db
    .select({ id: projects.id, product_idea: projects.product_idea })
    .from(projects)
    .where(eq(projects.id, interview.project_id))
    .limit(1)
    .catch(() => [])

  const project = projectRows[0]

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
        participant_role: interview.participant_role ?? undefined,
        signal_score: interview.signal_score,
        evidence_report: interview.evidence_report,
        analysis_json: interview.analysis_json ?? null,
        project_id: interview.project_id,
        project_name: project?.product_idea ?? undefined,
        analyzed_at: interview.analyzed_at?.toISOString() ?? undefined,
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
