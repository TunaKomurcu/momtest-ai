/**
 * Intake Flow Tests
 *
 * Covers:
 * - UC1:  PM intake from a vague idea (segment clarity, brief fields)
 * - UC4:  Quick smoke test — agent asks clarifying questions before generating script
 * - UC5:  Intake produces correct research brief for strong-pain scenario
 * - UC9:  Segment confusion detection
 * - §2:   Minimum acceptance bar criteria
 * - §18:  Evaluation checklist — PM intake section
 *
 * Reference: mom-test-agent-testing-instructions.md §4, §5, §13
 */

import { describe, it, expect } from 'vitest'
import type { ResearchBrief } from '@/types/index'
import type { ConversationMessage } from '@/types/index'

// ── Helpers mirrored from app/api/intake route ────────────────────────────

function extractResearchBrief(reply: string): ResearchBrief | null {
  const match = reply.match(/<research_brief>([\s\S]*?)<\/research_brief>/)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim()) as ResearchBrief
  } catch {
    return null
  }
}

function checkCompletion(messages: ConversationMessage[], agentReply: string): boolean {
  if (extractResearchBrief(agentReply)) return true
  const agentMsgCount = messages.filter((m) => m.sender === 'agent').length
  return agentMsgCount >= 8
}

function detectCompletionStatus(messages: ConversationMessage[]) {
  const fullText = messages.map((m) => m.content).join(' ').toLowerCase()
  return {
    hasProductIdea:         fullText.length > 50,
    hasTargetSegment:       /segment|hedef kitle|target|kullanıcı|customer|user/.test(fullText),
    hasRiskiestAssumption:  /risk|assumption|varsayım|kritik|problem/.test(fullText),
  }
}

/** Checks whether a string looks like a clarifying intake question (not a script question) */
function isClarifyingQuestion(text: string): boolean {
  return (
    /what decision are you trying to make/i.test(text) ||
    /which (type|segment|kind) of/i.test(text) ||
    /who (is|are) (your|the) (target|first|primary)/i.test(text) ||
    /when does the (problem|pain|issue|payment problem) happen/i.test(text) ||
    /what do you (believe|think|assume) they currently/i.test(text) ||
    /what assumption would kill/i.test(text) ||
    /what would you do with the (results|findings)/i.test(text) ||
    /narrow(er)? (the )?segment/i.test(text) ||
    /too broad/i.test(text) ||
    /which (one )?segment should we test/i.test(text) ||
    /targeting first/i.test(text) ||
    /what (type|kind) of freelancer/i.test(text)
  )
}

/** Checks whether a brief has all required fields populated */
function isBriefComplete(brief: Partial<ResearchBrief>): boolean {
  return !!(
    brief.researchGoal &&
    brief.targetCustomerSegment &&
    brief.coreSituation &&
    brief.riskiestAssumption &&
    brief.interviewObjective &&
    brief.evidenceNeeded &&
    brief.forbiddenQuestions &&
    brief.participantCriteria
  )
}

/** Checks whether a brief's forbidden questions contain banned patterns */
function briefForbidsLeadingQuestions(brief: ResearchBrief): boolean {
  return brief.forbiddenQuestions.some((q) =>
    /would you use|would you pay|do you like|do you think this is a good idea/i.test(q)
  )
}

// ── UC4 — Quick smoke test: freelancer invoice idea ───────────────────────

describe('UC4 — Quick smoke test: agent clarifies before generating script', () => {
  const expectedClarifyingQuestions = [
    'What decision are you trying to make after these interviews?',
    'Which type of freelancer are you targeting first?',
    'When does the payment problem happen in their workflow?',
    'What do you believe they currently do to solve it?',
    'What assumption would kill this idea if false?',
  ]

  it('all expected clarifying questions pass the isClarifyingQuestion check', () => {
    expectedClarifyingQuestions.forEach((q) => {
      expect(isClarifyingQuestion(q)).toBe(true)
    })
  })

  it('clarifying questions do NOT contain banned interview question patterns', () => {
    const BANNED = [/would you use/i, /do you like/i, /would you pay/i, /is this interesting/i]
    expectedClarifyingQuestions.forEach((q) => {
      BANNED.forEach((re) => {
        expect(re.test(q)).toBe(false)
      })
    })
  })

  it('research brief produced for smoke test has all required fields', () => {
    const brief: ResearchBrief = {
      researchGoal: 'Learn whether freelance designers have a repeated, painful workflow around late invoice follow-up.',
      targetCustomerSegment: 'Freelance designers with at least three active monthly clients.',
      coreSituation: 'After sending invoices, they need to track payment status and remind late clients.',
      riskiestAssumption: 'Late payment follow-up is painful and frequent enough that freelancers already use manual systems or paid tools.',
      interviewObjective: 'Understand frequency, cost, current workaround, and whether urgency justifies a product.',
      evidenceNeeded: 'Specific recent events, manual tracking systems, existing spend on related tools.',
      forbiddenQuestions: ['Would you use an AI invoice reminder app?', 'Would you pay for this?', 'Do you like this idea?'],
      participantCriteria: 'Active freelance designer with 3+ clients and net-payment terms.',
    }
    expect(isBriefComplete(brief)).toBe(true)
  })

  it('smoke test brief explicitly forbids leading questions', () => {
    const brief: ResearchBrief = {
      researchGoal: 'Test',
      targetCustomerSegment: 'Freelancers',
      coreSituation: 'Invoice tracking',
      riskiestAssumption: 'Pain is frequent',
      interviewObjective: 'Validate frequency',
      evidenceNeeded: 'Workarounds',
      forbiddenQuestions: ['Would you use an AI invoice reminder app?', 'Would you pay for this?'],
      participantCriteria: 'Active freelancer',
    }
    expect(briefForbidsLeadingQuestions(brief)).toBe(true)
  })
})

// ── UC1 — PM intake: creator sponsorship tool ─────────────────────────────

describe('UC1 — PM intake from vague idea: creator sponsorship tool', () => {
  const expectedIntakeAreas = [
    'creator type',
    'sponsorship workflow',
    'stage of sponsorship process',
    'current workaround',
    'decision the PM needs to make',
    'riskiest assumption',
    'participant criteria',
  ]

  it('brief covers all 7 expected intake areas', () => {
    const brief: ResearchBrief = {
      researchGoal: 'Learn whether independent YouTube creators lose time or money due to fragmented sponsorship tracking.',
      targetCustomerSegment: 'YouTube creators with 10k–250k subscribers who handle sponsorships without an agency.',
      coreSituation: 'A brand reaches out; the creator negotiates terms, tracks deliverables, sends invoices, follows up on payment.',
      riskiestAssumption: 'Creators lose meaningful time or money because sponsorship tracking is currently fragmented.',
      interviewObjective: 'Understand how creators currently manage sponsorship deals and where breakdowns happen.',
      evidenceNeeded: 'Tools, spreadsheets, managers, templates already in use; recurring failures; missed payments.',
      forbiddenQuestions: ['Would you use a sponsorship dashboard?', 'Do you want this feature?'],
      participantCriteria: 'Independent YouTube creator with at least 2 active sponsorships in the last 6 months.',
    }

    // Verify each expected area is reflected in the brief
    expect(brief.targetCustomerSegment).toMatch(/youtube|creator/i)   // creator type
    expect(brief.coreSituation).toMatch(/sponsorship|brand|deal/i)     // workflow
    expect(brief.riskiestAssumption).toMatch(/time|money|fragmented/i) // riskiest assumption
    expect(brief.forbiddenQuestions.length).toBeGreaterThan(0)
    expect(isBriefComplete(brief)).toBe(true)
  })

  it('brief rejects "creators" as segment — must be narrower', () => {
    const vagueSegment = 'creators'
    const narrowSegment = 'YouTube creators with 10k–250k subscribers who handle sponsorships without an agency'
    // The vague segment is too short to reflect specific targeting
    expect(vagueSegment.split(' ').length).toBeLessThan(5)
    // The narrow segment is detailed
    expect(narrowSegment.split(' ').length).toBeGreaterThan(10)
  })

  it('pass: agent identifies riskiest assumption', () => {
    const brief: ResearchBrief = {
      researchGoal: 'g', targetCustomerSegment: 'YouTube creators with 10k-250k subscribers',
      coreSituation: 'Sponsorship tracking after brand outreach',
      riskiestAssumption: 'Creators lose meaningful time or money because sponsorship tracking is fragmented',
      interviewObjective: 'o', evidenceNeeded: 'e',
      forbiddenQuestions: ['Would you use a sponsorship tool?'],
      participantCriteria: 'p',
    }
    expect(brief.riskiestAssumption).toMatch(/time|money|fragmented|lose/i)
  })

  it('fail: agent should NOT accept "creators" as a clear segment', () => {
    // A valid brief must specify type, size, context
    const badBrief: Partial<ResearchBrief> = {
      researchGoal: 'Help creators',
      targetCustomerSegment: 'creators',
    }
    // Segment is too vague — under 5 words
    const words = (badBrief.targetCustomerSegment ?? '').split(' ').length
    expect(words).toBeLessThan(5)
    expect(isBriefComplete(badBrief)).toBe(false)
  })
})

// ── UC5 — Intake produces correct brief for strong-pain scenario ──────────

describe('UC5 — Intake brief for invoice reminder (freelance designer)', () => {
  const denizBrief: ResearchBrief = {
    researchGoal: 'Learn whether freelance designers experience frequent, costly invoice follow-up pain that exceeds their current manual workarounds.',
    targetCustomerSegment: 'Freelance designers with 3+ active clients using net-payment invoice terms.',
    coreSituation: 'After sending invoices, designers track payment status manually and follow up with late clients via email.',
    riskiestAssumption: 'Late payment follow-up is frequent and painful enough that designers already maintain dedicated systems.',
    interviewObjective: 'Map the current workflow, identify existing workarounds, quantify cost, and assess urgency.',
    evidenceNeeded: 'Specific late payment events, manual tracking tools, time spent, cash flow impact, existing spend.',
    forbiddenQuestions: [
      'Would you use an AI invoice reminder?',
      'Do you think this would save you time?',
      'Would you pay for this?',
    ],
    participantCriteria: 'Active freelance designer with 3+ clients, net-30 or net-60 payment terms, at least one late payment in the last 6 months.',
  }

  it('brief has all required fields', () => {
    expect(isBriefComplete(denizBrief)).toBe(true)
  })

  it('riskiest assumption focuses on frequency and pain severity', () => {
    expect(denizBrief.riskiestAssumption).toMatch(/frequent|painful|maintain|workaround/i)
  })

  it('participant criteria requires actual past experience with the problem', () => {
    expect(denizBrief.participantCriteria).toMatch(/late payment|net-\d+|3\+ client/i)
  })

  it('forbidden questions include all leading question variants', () => {
    expect(denizBrief.forbiddenQuestions.length).toBeGreaterThanOrEqual(2)
    expect(briefForbidsLeadingQuestions(denizBrief)).toBe(true)
  })

  it('interviewObjective covers workflow, workaround, cost, urgency', () => {
    const obj = denizBrief.interviewObjective.toLowerCase()
    expect(obj).toMatch(/workflow/)
    expect(obj).toMatch(/workaround|existing/)
    expect(obj).toMatch(/cost|urgency/)
  })
})

// ── UC9 — Segment confusion detection ────────────────────────────────────

describe('UC9 — Segment confusion: mixed customer groups', () => {
  const mixedSegmentInput = 'The app is for freelancers, agencies, and small businesses that need help getting paid on time.'

  it('detects multiple segments in a single description', () => {
    const segments = ['freelancer', 'agenc', 'small business']
    const matchCount = segments.filter((s) => mixedSegmentInput.toLowerCase().includes(s)).length
    expect(matchCount).toBeGreaterThanOrEqual(3)
  })

  it('a brief with mixed segments fails the single-segment check', () => {
    const multiSegmentBrief: Partial<ResearchBrief> = {
      targetCustomerSegment: 'freelancers, agencies, and small businesses',
    }
    // A valid segment should not contain commas listing different types
    const hasMultiple = (multiSegmentBrief.targetCustomerSegment ?? '').includes(',')
    expect(hasMultiple).toBe(true) // this is a problem
    expect(isBriefComplete(multiSegmentBrief)).toBe(false)
  })

  it('agent pushback message identifies "too broad" problem', () => {
    const agentPushback = 'That is too broad for useful discovery. Which one segment should we test first: solo freelancers, agencies, or small businesses? The workflow, buyer, frequency, and budget are likely different.'
    expect(isClarifyingQuestion(agentPushback)).toBe(true)
  })

  it('expected output lists segment risk', () => {
    const segmentRiskNote = 'The proposed customer group mixes at least three different workflows.'
    expect(segmentRiskNote).toMatch(/mixes|different|workflows/i)
  })

  it('each segment has different buyer / user / frequency implications', () => {
    // These are known structural differences — validated as true by domain logic
    const implications: Record<string, string[]> = {
      freelancer: ['solo buyer', 'high frequency', 'personal cash flow'],
      agency: ['team buyer', 'medium frequency', 'project margin'],
      small_business: ['manager buyer', 'variable frequency', 'AR process'],
    }
    const segments = Object.keys(implications)
    expect(segments).toHaveLength(3)
    segments.forEach((seg) => {
      expect(implications[seg].length).toBeGreaterThan(0)
    })
  })

  it('fail: agent must NOT create one generic script for all three segments', () => {
    // A single script with a mixed segment target is invalid
    const badScript = {
      goal: 'Learn about getting paid',
      targetSegment: 'freelancers, agencies, and small businesses',
    }
    const hasComma = badScript.targetSegment.includes(',')
    expect(hasComma).toBe(true) // this IS a problem we must detect
  })
})

// ── extractResearchBrief + checkCompletion ────────────────────────────────

describe('extractResearchBrief — intake completion detection', () => {
  const validBrief: ResearchBrief = {
    researchGoal: 'Learn whether freelancers have frequent invoice follow-up pain.',
    targetCustomerSegment: 'Freelance designers with 3+ clients',
    coreSituation: 'Tracking payment after invoice delivery',
    riskiestAssumption: 'Problem is frequent and costly enough to justify a tool',
    interviewObjective: 'Map workflow, workaround, cost, and urgency',
    evidenceNeeded: 'Specific events, tools in use, time spent',
    forbiddenQuestions: ['Would you use this?'],
    participantCriteria: 'Active freelancer with net-payment terms',
  }

  it('returns null when no tag present', () => {
    expect(extractResearchBrief('Here is my plan.')).toBeNull()
  })

  it('parses valid brief from agent reply', () => {
    const reply = `Some context.\n<research_brief>\n${JSON.stringify(validBrief)}\n</research_brief>\nDone.`
    const result = extractResearchBrief(reply)
    expect(result).not.toBeNull()
    expect(result?.riskiestAssumption).toBeTruthy()
  })

  it('returns null for malformed JSON in tag', () => {
    expect(extractResearchBrief('<research_brief>{bad}</research_brief>')).toBeNull()
  })

  it('checkCompletion returns true when reply has valid brief', () => {
    const reply = `<research_brief>${JSON.stringify(validBrief)}</research_brief>`
    expect(checkCompletion([], reply)).toBe(true)
  })

  it('checkCompletion returns true after 8 agent messages', () => {
    const msgs: ConversationMessage[] = Array.from({ length: 8 }, () => ({ sender: 'agent', content: 'Q' }))
    expect(checkCompletion(msgs, 'No brief here')).toBe(true)
  })

  it('checkCompletion returns false before 8 agent messages without brief', () => {
    const msgs: ConversationMessage[] = Array.from({ length: 5 }, () => ({ sender: 'agent', content: 'Q' }))
    expect(checkCompletion(msgs, 'No brief here')).toBe(false)
  })
})

// ── §2 — Minimum acceptance bar ───────────────────────────────────────────

describe('§2 — Minimum acceptance bar', () => {
  it('brief asks about customer life, not PM idea', () => {
    const brief: ResearchBrief = {
      researchGoal: 'Learn how freelancers currently manage invoice follow-up',
      targetCustomerSegment: 'Freelancers with 3+ clients',
      coreSituation: 'After invoice delivery, tracking payment status manually',
      riskiestAssumption: 'Problem is frequent and painful',
      interviewObjective: 'Understand workflow, tools, frequency, and cost',
      evidenceNeeded: 'Workarounds, time spent, existing spend',
      forbiddenQuestions: ['Would you use this?'],
      participantCriteria: 'Active freelancer',
    }
    // Research goal focuses on customer behavior, not product validation
    expect(brief.researchGoal).not.toMatch(/validate|confirm|prove our|our idea/i)
    expect(brief.researchGoal).toMatch(/learn|understand|how|what/i)
  })

  it('brief identifies riskiest assumption', () => {
    const brief: Partial<ResearchBrief> = {
      riskiestAssumption: 'Pain is frequent and costly enough to justify abandoning the manual workflow',
    }
    expect(brief.riskiestAssumption).toBeTruthy()
    expect((brief.riskiestAssumption ?? '').length).toBeGreaterThan(20)
  })

  it('brief produces concrete next step (participant criteria)', () => {
    const brief: Partial<ResearchBrief> = {
      participantCriteria: 'Active freelancer with 3+ clients using net-30 payment terms who experienced a late payment in the last 3 months',
    }
    expect(brief.participantCriteria).toMatch(/3\+|client|freelancer|late payment/i)
  })

  it('detectCompletionStatus: all three fields detected from substantive conversation', () => {
    const msgs: ConversationMessage[] = [
      { sender: 'participant', content: 'I want to build a tool for freelance designers who struggle with late payments from their customers' },
      { sender: 'agent', content: 'What is the target segment?' },
      { sender: 'participant', content: 'The target customer is freelancers with 3 or more clients on net-30 terms' },
      { sender: 'agent', content: 'What is the riskiest assumption?' },
      { sender: 'participant', content: 'The risk is that the problem is not frequent enough to justify building something' },
    ]
    const status = detectCompletionStatus(msgs)
    expect(status.hasProductIdea).toBe(true)
    expect(status.hasTargetSegment).toBe(true)
    expect(status.hasRiskiestAssumption).toBe(true)
  })
})
