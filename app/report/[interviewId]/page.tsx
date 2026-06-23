import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EvidenceReport } from './evidence-report'

export default async function ReportPage({
  params,
}: {
  params: Promise<{ interviewId: string }>
}) {
  const { interviewId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Fetch interview
  const { data: interview, error } = await supabase
    .from('interviews')
    .select('id, project_id, participant_name, signal_score, evidence_report')
    .eq('id', interviewId)
    .single()

  if (error || !interview || !interview.evidence_report) {
    redirect('/dashboard')
  }

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', interview.project_id)
    .single()

  if (!project || project.user_id !== user.id) {
    redirect('/dashboard')
  }

  // Fetch transcript messages
  const { data: messages } = await supabase
    .from('messages')
    .select('id, sender, content')
    .eq('interview_id', interviewId)
    .order('created_at', { ascending: true })

  return (
    <EvidenceReport
      interview={{
        participant_name: interview.participant_name,
        signal_score: interview.signal_score,
        evidence_report: interview.evidence_report,
      }}
      messages={
        (messages ?? []) as Array<{
          id: string
          sender: 'agent' | 'participant'
          content: string
        }>
      }
    />
  )
}