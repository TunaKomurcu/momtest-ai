export function isMockLLMMode(): boolean {
  return (process.env.APP_LLM_MODE ?? '').toLowerCase() === 'mock'
}

export function shouldUseMockLLM(): boolean {
  return isMockLLMMode() || !process.env.OPENAI_API_KEY
}

export function getMockIntakeReply(productIdea: string): string {
  return `<research_brief>
{
  "researchGoal": "Understand the real workflow pain around ${productIdea} and where users currently spend time or lose momentum.",
  "targetCustomerSegment": "Small team leads and operators who manage recurring work across multiple tools.",
  "coreSituation": "Users have to coordinate tasks, handoffs, and deadlines manually while juggling multiple systems and reminders.",
  "riskiestAssumption": "The main value is not task tracking itself, but reducing operational overhead and missed context across a team.",
  "interviewObjective": "Learn how work is currently coordinated, what breaks down, and what people already do to compensate.",
  "evidenceNeeded": "Concrete examples of missed handoffs, repeated manual coordination, and the cost of current workarounds.",
  "forbiddenQuestions": ["Would you use this product?", "Do you like this idea?", "Would you pay for it?"],
  "participantCriteria": "Current team lead or operator managing recurring work across at least two people or tools."
}
</research_brief>
Mock mode is active. The intake flow is using a safe demo response so the app can be deployed without a live LLM key.`
}

export function getMockGeneratePayload(productIdea: string) {
  return {
    brief: {
      productIdea,
      targetCustomer: 'Team leads and operators tracking recurring work',
      coreSituation: 'Manual coordination creates delays and context loss',
      currentBelief: 'A simple workflow system would reduce friction',
      riskiestAssumption: 'A single workflow tool would reduce coordination overhead',
      interviewObjective: 'Capture the exact moments where users lose time or context',
      evidenceNeeded: {
        strong: 'A recent real example of a missed handoff or delayed task',
        weak: 'An opinion about wanting less friction',
        negative: 'No recurring task coordination problem or no workaround',
      },
      participantCriteria: {
        mustHave: ['Uses collaboration tools regularly', 'Coordinates recurring work'],
        avoid: ['No team coordination responsibilities'],
      },
      forbiddenQuestions: ['Would you use this?', 'Do you like this idea?'],
      assumptionMap: [
        {
          assumption: 'Users need less manual coordination',
          riskLevel: 'high',
          whatToAskAbout: 'Current coordination workflow',
          strongEvidence: 'They rely on manual follow-ups or spreadsheets',
          weakEvidence: 'They say the process is mildly annoying',
        },
      ],
    },
    script: {
      goal: 'Understand current work coordination and failure points',
      rulesForInterviewer: [
        'Do not pitch the product',
        'Ask one question at a time',
        'Ask for recent examples',
        'Probe vague answers',
      ],
      questions: [
        {
          order: 1,
          question: 'Can you walk me through the last time you had to coordinate work across your team?',
          signalSought: 'workflow',
          whyItPasses: 'It asks for a real example rather than future interest.',
        },
        {
          order: 2,
          question: 'What was the hardest part when that happened?',
          signalSought: 'pain',
          whyItPasses: 'It focuses on actual friction and the work around.',
        },
      ],
    },
  }
}

export function getMockInterviewReply(prompt: string): string {
  const trimmed = prompt.trim()
  const base = trimmed.length > 0 ? trimmed : 'Can you tell me about the last time this happened?'

  return `Thanks for the detail. To keep this grounded in real behavior, can you tell me about the last time this happened and what you did before, during, and after?`
}
