/**
 * Offline Eval Harness
 *
 * Kullanım: npx tsx lib/evals/run-evals.ts
 *
 * Ne yapar:
 *  1. brief-input.json fixture'ı üzerinde RESEARCH_BRIEF_SYSTEM_PROMPT'u çalıştırır,
 *     çıktıyı validateFullResearchBrief ile validate eder ve sonuçları raporlar.
 *  2. analysis-input.json fixture'ı üzerinde EVIDENCE_ANALYST_SYSTEM_PROMPT'u çalıştırır,
 *     çıktıyı validateStructuredAnalysis ile validate eder ve sonuçları raporlar.
 *
 * Herhangi bir FAILED varsa process.exit(1) ile çıkar (CI entegrasyonu için).
 *
 * Bağımlılıklar: Next.js veya route katmanından hiçbir şey import edilmez.
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { join } from 'path'
import OpenAI from 'openai'
import { load as yamlLoad } from 'js-yaml'
import { parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateFullResearchBrief } from '@/lib/ai-guards/brief-validator'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'
import type { OpenAIAgentConfig, ValidationResult } from '@/types/index'

// .env.local'ı yükle (OPENAI_API_KEY buradan okunur)
config({ path: '.env.local' })

// ---------------------------------------------------------------------------
// Renkli terminal çıktısı
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function pass(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`)
}

function fail(msg: string): void {
  console.log(`  ${RED}✗${RESET} ${msg}`)
}

function header(msg: string): void {
  console.log(`\n${BOLD}${YELLOW}${msg}${RESET}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FixtureMessage {
  id?: string
  sender: string
  content: string
}

function loadFixture(filename: string): FixtureMessage[] {
  const fixturePath = join(process.cwd(), 'lib', 'evals', 'fixtures', filename)
  const raw = readFileSync(fixturePath, 'utf-8')
  return JSON.parse(raw) as FixtureMessage[]
}

function loadAgentConfig(): Partial<OpenAIAgentConfig> {
  try {
    const yamlPath = join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml')
    const raw = readFileSync(yamlPath, 'utf-8')
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch {
    console.warn('[Evals] openai.yaml okunamadı, varsayılan değerler kullanılıyor.')
    return {}
  }
}

async function callLLM(
  openai: OpenAI,
  agentConfig: Partial<OpenAIAgentConfig>,
  systemPrompt: string,
  userContent: string
): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.3,
      max_tokens: agentConfig.model?.max_tokens ?? 2000,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    })
    return completion.choices[0]?.message?.content?.trim() ?? null
  } catch (err) {
    console.error('[Evals] LLM çağrısı başarısız:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Eval runner — generic
// ---------------------------------------------------------------------------

interface EvalResult {
  suiteName: string
  passed: number
  total: number
}

function runValidation<T>(
  suiteName: string,
  parsed: T | null,
  validate: (p: unknown) => ValidationResult<T>
): EvalResult {
  header(`── ${suiteName} ──`)

  if (parsed === null) {
    fail('LLM çıktısı JSON olarak parse edilemedi')
    console.log(`\n  ${RED}PASSED: 0/1  FAILED: 1/1${RESET}\n`)
    return { suiteName, passed: 0, total: 1 }
  }

  const result = validate(parsed)

  if (result.ok) {
    // Başarılı — temel alanları özetle
    const summary = parsed as Record<string, unknown>
    const checks: string[] = []

    if (suiteName === 'Research Brief') {
      const brief = summary
      checks.push(`productIdea: "${String(brief.productIdea ?? '').slice(0, 60)}..."`)
      checks.push(`targetCustomer: "${String(brief.targetCustomer ?? '').slice(0, 50)}..."`)
      checks.push(`riskiestAssumption: "${String(brief.riskiestAssumption ?? '').slice(0, 60)}..."`)
      const aMap = Array.isArray(brief.assumptionMap) ? brief.assumptionMap : []
      checks.push(`assumptionMap: ${aMap.length} items`)
      const fq = Array.isArray(brief.forbiddenQuestions) ? brief.forbiddenQuestions : []
      checks.push(`forbiddenQuestions: ${fq.length} items`)
    } else if (suiteName === 'Structured Analysis') {
      const analysis = summary
      checks.push(`decision: "${String(analysis.decision ?? '')}"`)
      checks.push(`summary: "${String(analysis.summary ?? '').slice(0, 60)}..."`)
      const strong = Array.isArray(analysis.strongEvidence) ? analysis.strongEvidence : []
      const medium = Array.isArray(analysis.mediumEvidence) ? analysis.mediumEvidence : []
      const weak = Array.isArray(analysis.weakEvidence) ? analysis.weakEvidence : []
      checks.push(`strongEvidence: ${strong.length} items`)
      checks.push(`mediumEvidence: ${medium.length} items`)
      checks.push(`weakEvidence: ${weak.length} items`)
      const oq = Array.isArray(analysis.openQuestions) ? analysis.openQuestions : []
      checks.push(`openQuestions: ${oq.length} items`)
    }

    checks.forEach((c) => pass(c))
    const total = checks.length
    console.log(`\n  ${GREEN}${BOLD}PASSED: ${total}/${total}  FAILED: 0/${total}${RESET}\n`)
    return { suiteName, passed: total, total }
  } else {
    // Kısmi başarı — hangi alanlar geçti, hangisi geçmedi
    // validation tüm issue'ları listeler — geçen alan sayısını tahmin et
    const issueCount = result.issues.length
    result.issues.forEach((issue) => fail(issue))
    // toplam kontrol sayısını suite'e göre belirle
    const totalChecks = suiteName === 'Research Brief' ? 10 : 9
    const passed = Math.max(0, totalChecks - issueCount)
    console.log(
      `\n  ${RED}${BOLD}PASSED: ${passed}/${totalChecks}  FAILED: ${issueCount}/${totalChecks}${RESET}\n`
    )
    return { suiteName, passed, total: totalChecks }
  }
}

// ---------------------------------------------------------------------------
// System prompts (generate/route.ts ve analyze/route.ts'deki ile aynı)
// ---------------------------------------------------------------------------

const RESEARCH_BRIEF_SYSTEM_PROMPT = `You are a customer discovery architect trained in Mom Test principles.

You will receive a PM intake conversation. Your task is to produce a structured Research Brief and Assumption Map.

Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

Output format:
{
  "productIdea": "one sentence",
  "targetCustomer": "who-where segment",
  "coreSituation": "when the problem appears",
  "currentBelief": "what the PM believes is true",
  "riskiestAssumption": "the assumption most likely to kill the idea",
  "interviewObjective": "what the interview must learn",
  "evidenceNeeded": {
    "strong": "behavior or commitment that confirms the assumption",
    "weak": "compliment, opinion, or hypothetical",
    "negative": "no pain, no workaround, no urgency"
  },
  "participantCriteria": {
    "mustHave": ["criterion 1", "criterion 2"],
    "avoid": ["avoid 1", "avoid 2"]
  },
  "forbiddenQuestions": ["leading question 1", "pitchy question 2"],
  "assumptionMap": [
    {
      "assumption": "the belief being tested",
      "riskLevel": "high",
      "whatToAskAbout": "topic area",
      "strongEvidence": "concrete behavior that confirms",
      "weakEvidence": "vague claim or compliment"
    }
  ]
}

Assumption categories to cover: Problem, Frequency, Urgency, Workaround, Budget, Buyer/User split, Channel, Switching.
Risk levels: high, medium, low. Include at least 4 assumptions.`

const EVIDENCE_ANALYST_SYSTEM_PROMPT = `You are a strict customer-discovery analyst trained in Mom Test principles.

## Your job
Analyze the interview transcript and separate evidence from noise. Classify every participant signal. Produce a structured JSON analysis object.

## Evidence classification rules (from evidence-rubric.md)

### Strong evidence — count only when participant gives:
- A recent specific example
- Repeated occurrence
- Named tools or people in the workflow
- A workaround they currently maintain
- Money already spent
- Time regularly spent
- Reputation or operational risk
- Active search for alternatives
- Introduction to another stakeholder
- Pilot, preorder, deposit, or scheduled next step

### Medium evidence — plausible problem but lacks:
- Proof of urgency, cost, workaround, or commitment

### Weak evidence — treat as noise:
- Praise or compliments
- Opinions
- Hypotheticals ("I would...", "I think...", "probably...")
- Feature suggestions
- Future-tense promises
- Unsupported willingness to pay
- Generic claims ("usually", "always", "never")

### Negative evidence — red flags:
- Cannot remember a recent example
- Does not currently solve the problem
- Problem has no meaningful cost
- Workaround is good enough
- Not the buyer or user
- Unreachable as a segment
- Resists any concrete next step

## Decision criteria
- "continue discovery": strong evidence of problem but not yet enough for commitment test
- "test commitment": strong problem evidence + urgency + some budget signal
- "change segment": wrong participant, no pain, or negative evidence dominates
- "stop": no problem, no urgency, no workaround, nothing to learn
- "build narrow prototype": strong evidence across problem + frequency + workaround + budget dimensions

## Output format
Output ONLY valid JSON. No prose, no markdown fences, no explanation — just the JSON object.

{
  "decision": "continue discovery | test commitment | change segment | stop | build narrow prototype",
  "summary": "2-3 sentence plain-language summary of what was learned",
  "signalScore": {
    "problemEvidence": "strong | medium | weak | negative",
    "urgency": "strong | medium | weak | negative",
    "workaroundEvidence": "strong | medium | weak | negative",
    "budgetOrCommitment": "strong | medium | weak | negative"
  },
  "strongEvidence": [
    { "quote": "exact or close paraphrase from participant", "message_id": "msg-uuid", "whyItMatters": "behavioral reason" }
  ],
  "mediumEvidence": [
    { "quote": "...", "message_id": "msg-uuid", "context": "why this is medium not strong" }
  ],
  "weakEvidence": [
    { "quote": "...", "message_id": "msg-uuid", "whyItIsWeak": "compliment/hypothetical/opinion/etc." }
  ],
  "negativeEvidence": [
    "plain description of what suggests the idea may be wrong"
  ],
  "openQuestions": [
    "next important unknown 1",
    "next important unknown 2",
    "next important unknown 3"
  ],
  "recommendedNextStep": "one concrete action"
}

Rules:
- Use the exact message_id provided in the transcript for each signal.
- Do not invent quotes. Use close paraphrases if exact quotes are long.
- Do not count agent questions as evidence — only participant answers matter.
- If the transcript is too short to analyze, set decision to "change segment" and explain in summary.`

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n${BOLD}═══════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  MomTest AI — Offline Eval Harness${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════${RESET}`)

  if (!process.env.OPENAI_API_KEY) {
    console.error(`\n${RED}HATA: OPENAI_API_KEY bulunamadı. .env.local dosyasını kontrol edin.${RESET}\n`)
    process.exit(1)
  }

  const agentConfig = loadAgentConfig()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const allResults: EvalResult[] = []

  // ── EVAL 1: Research Brief ───────────────────────────────────────────────

  console.log('\n⏳ Eval 1/2: Research Brief — LLM çağrılıyor...')

  const briefFixture = loadFixture('brief-input.json')
  const briefTranscript = briefFixture
    .map((m) => `${m.sender === 'agent' ? 'Discovery Architect' : 'PM'}: ${m.content}`)
    .join('\n')

  const rawBrief = await callLLM(
    openai,
    agentConfig,
    RESEARCH_BRIEF_SYSTEM_PROMPT,
    `Intake conversation:\n${briefTranscript}`
  )

  console.log('[RAW LLM OUTPUT]', rawBrief?.slice(0, 200))

  const parsedBrief = rawBrief ? parseAndClean(rawBrief) : null
  const briefResult = runValidation('Research Brief', parsedBrief, validateFullResearchBrief)
  allResults.push(briefResult)

  // ── EVAL 2: Structured Analysis ─────────────────────────────────────────

  console.log('⏳ Eval 2/2: Structured Analysis — LLM çağrılıyor...')

  const analysisFixture = loadFixture('analysis-input.json')
  const transcript = analysisFixture
    .map((m) => {
      const role = m.sender === 'agent' ? 'Interviewer' : 'Participant'
      return `[${m.id ?? 'no-id'}] ${role}: ${m.content}`
    })
    .join('\n')

  const rawAnalysis = await callLLM(
    openai,
    agentConfig,
    EVIDENCE_ANALYST_SYSTEM_PROMPT,
    `Participant name: Eval Fixture\n\nInterview transcript:\n${transcript}`
  )

  console.log('[RAW LLM OUTPUT]', rawAnalysis?.slice(0, 200))

  const parsedAnalysis = rawAnalysis ? parseAndClean(rawAnalysis) : null
  const analysisResult = runValidation('Structured Analysis', parsedAnalysis, validateStructuredAnalysis)
  allResults.push(analysisResult)

  // ── Özet ────────────────────────────────────────────────────────────────

  const totalPassed = allResults.reduce((sum, r) => sum + r.passed, 0)
  const totalChecks = allResults.reduce((sum, r) => sum + r.total, 0)
  const anyFailed = allResults.some((r) => r.passed < r.total)

  console.log(`${BOLD}═══════════════════════════════════════${RESET}`)
  if (anyFailed) {
    console.log(`${RED}${BOLD}  SONUÇ: FAILED  (${totalPassed}/${totalChecks} check geçti)${RESET}`)
  } else {
    console.log(`${GREEN}${BOLD}  SONUÇ: PASSED  (${totalPassed}/${totalChecks} check geçti)${RESET}`)
  }
  console.log(`${BOLD}═══════════════════════════════════════${RESET}\n`)

  if (anyFailed) {
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  console.error('[Evals] Beklenmeyen hata:', err)
  process.exit(1)
})
