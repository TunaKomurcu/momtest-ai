import { createClient } from '@/lib/supabase/server'
import { ParticipantChat } from './participant-chat'
import { Compass } from 'lucide-react'

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: interview, error } = await supabase
    .from('interviews')
    .select('id, status')
    .eq('id', id)
    .single()

  if (error || !interview) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="bg-primary/10 mb-4 flex size-12 items-center justify-center rounded-xl">
          <Compass className="text-primary size-6" />
        </div>
        <h1 className="text-lg font-semibold">Interview Not Found</h1>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm text-balance">
          This interview link is invalid or has expired. Please ask the researcher for a new link.
        </p>
      </main>
    )
  }

  if (interview.status === 'completed') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="bg-emerald-500/15 mb-4 flex size-12 items-center justify-center rounded-xl">
          <Compass className="text-emerald-400 size-6" />
        </div>
        <h1 className="text-lg font-semibold">Interview Already Completed</h1>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm text-balance">
          This interview session has already been completed. Thank you for your participation!
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col">
      <ParticipantChat interviewId={id} />
    </main>
  )
}