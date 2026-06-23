/**
 * Interview route pure helpers — participant interview logic.
 * Next.js'e bağımlılığı yoktur.
 */

import type { ConversationMessage } from '@/types/index'
import type { Json } from '@/types/database.types'

/**
 * Anlamlı katılımcı yanıtı sayısını hesaplar.
 * 5 kelimeden kısa yanıtlar sayılmaz.
 */
export function countMeaningfulParticipantReplies(
  messages: ConversationMessage[]
): number {
  return messages.filter(
    (m) =>
      m.sender === 'participant' &&
      m.content.trim().split(/\s+/).length >= 5
  ).length
}

/**
 * Ajanın kapanış mesajı içerip içermediğini tespit eder.
 */
export function isClosingMessage(text: string): boolean {
  return (
    /thank you for your time/i.test(text) ||
    /thanks for taking the time/i.test(text) ||
    /this has been really helpful/i.test(text) ||
    /have a great day/i.test(text)
  )
}

/**
 * interview_script JSONB verisini LLM'e verilecek okunabilir metne çevirir.
 * Katılımcıya asla gösterilmez.
 */
export function serializeInterviewScript(script: Json | null): string {
  if (!script)
    return 'No interview script available. Use general Mom Test question patterns.'

  try {
    const s = script as {
      goal?: string
      rulesForInterviewer?: string[]
      questions?: Array<{
        order?: number
        question: string
        signalSought?: string
      }>
    }

    const lines: string[] = []

    if (s.goal) lines.push(`Interview goal: ${s.goal}`)

    if (s.rulesForInterviewer?.length) {
      lines.push('\nRules for this interview:')
      s.rulesForInterviewer.forEach((r) => lines.push(`- ${r}`))
    }

    if (s.questions?.length) {
      lines.push('\nGuided question sequence (follow this order, adapt naturally):')
      s.questions.forEach((q) => {
        const prefix = q.order !== undefined ? `${q.order}. ` : '- '
        const signal = q.signalSought ? ` [signal: ${q.signalSought}]` : ''
        lines.push(`${prefix}${q.question}${signal}`)
      })
    }

    return lines.join('\n')
  } catch {
    return 'Interview script available but could not be parsed. Use general Mom Test question patterns.'
  }
}

/**
 * Mülakat kapanması gerekip gerekmediğini belirler.
 * min 3 replies gate + isClosingMessage VEYA >= 10 replies threshold.
 */
export function shouldCloseInterview(
  messages: ConversationMessage[],
  agentReply: string
): boolean {
  const meaningful = countMeaningfulParticipantReplies(messages)
  if (meaningful >= 10) return true
  if (meaningful >= 3 && isClosingMessage(agentReply)) return true
  return false
}
