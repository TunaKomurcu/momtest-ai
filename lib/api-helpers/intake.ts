/**
 * Intake route pure helpers — PM intake conversation logic.
 * Next.js'e bağımlılığı yoktur.
 */

import type { ConversationMessage, ResearchBrief, IntakeCompletionStatus } from '@/types/index'

/**
 * Ajan yanıtından <research_brief> JSON bloğunu çıkarır.
 * Tag yoksa veya JSON geçersizse null döner.
 */
export function extractResearchBrief(reply: string): ResearchBrief | null {
  const match = reply.match(/<research_brief>([\s\S]*?)<\/research_brief>/)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim()) as ResearchBrief
  } catch {
    return null
  }
}

/**
 * Intake konuşmasının tamamlanıp tamamlanmadığını kontrol eder.
 * - <research_brief> bloğu varsa tamamdır.
 * - 8 veya daha fazla ajan mesajı varsa tamamdır.
 */
export function checkIntakeCompletion(
  messages: ConversationMessage[],
  agentReply: string
): boolean {
  if (extractResearchBrief(agentReply)) return true
  const agentCount = messages.filter((m) => m.sender === 'agent').length
  return agentCount >= 8
}

/**
 * Mevcut konuşmadan hangi intake alanlarının dolu olduğunu tespit eder.
 */
export function detectCompletionStatus(
  messages: ConversationMessage[]
): IntakeCompletionStatus {
  const fullText = messages.map((m) => m.content).join(' ').toLowerCase()
  return {
    hasProductIdea: fullText.length > 50,
    hasTargetSegment:
      /segment|hedef kitle|target|kullanıcı|customer|user/.test(fullText),
    hasRiskiestAssumption:
      /risk|assumption|varsayım|kritik|problem/.test(fullText),
  }
}
