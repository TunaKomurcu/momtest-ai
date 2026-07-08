/**
 * demo-harness.ts — Harness'ın validation fail/pass davranışını gösteren demo
 *
 * Kullanım: npx tsx lib/evals/demo-harness.ts
 *
 * Ne yapar:
 *   Gerçek API çağrısı YAPMAZ. Hazır fixture JSON'ları kullanır.
 *   Her validator'ı farklı durumlarla çalıştırır:
 *
 *   1. Geçerli brief     → PASS
 *   2. Eksik alan brief  → FAIL + hangi alanlar eksik görünür
 *   3. Geçerli analysis  → PASS
 *   4. Bozuk decision    → FAIL + hangi alan yanlış görünür
 *   5. Gerçek LLM çıktısı (fixtures) → PASS veya FAIL
 */

import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateFullResearchBrief, validateInterviewScript } from '@/lib/ai-guards/brief-validator'
import { validateStructuredAnalysis } from '@/lib/ai-guards/analysis-validator'
import type { FullResearchBrief, StructuredAnalysis, InterviewScript } from '@/types/index'

config({ path: '.env.local' })

// ---------------------------------------------------------------------------
// Renkli çıktı
// ---------------------------------------------------------------------------

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'

function section(title: string) {
  console.log(`\n${BOLD}${YELLOW}${'─'.repeat(55)}${RESET}`)
  console.log(`${BOLD}${YELLOW}  ${title}${RESET}`)
  console.log(`${BOLD}${YELLOW}${'─'.repeat(55)}${RESET}`)
}

function runCheck(label: string, ok: boolean, detail?: string) {
  const icon = ok ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`
  console.log(`  ${icon}  ${label}`)
  if (detail) console.log(`         ${DIM}${detail}${RESET}`)
}

function showIssues(issues: string[]) {
  issues.forEach(i => console.log(`         ${RED}→ ${i}${RESET}`))
}

// ---------------------------------------------------------------------------
// Test fixture JSON'ları (API çağrısı yok, hepsi lokal)
// ---------------------------------------------------------------------------

const VALID_BRIEF: FullResearchBrief = {
  productIdea: 'AI-powered customer interview analyzer for B2B SaaS product managers',
  targetCustomer: 'Product managers in B2B SaaS startups doing customer discovery',
  coreSituation: 'After completing a customer discovery interview call',
  currentBelief: 'PMs cannot distinguish weak from strong evidence signals',
  riskiestAssumption: 'PMs feel this pain strongly enough to pay for a solution',
  interviewObjective: 'Confirm whether evidence misclassification is a real daily pain',
  evidenceNeeded: {
    strong: 'PM describes a specific wrong build decision caused by misreading signals',
    weak: 'PM says they would like better tooling',
    negative: 'PM has no memory of any bad decision from weak signals',
  },
  participantCriteria: {
    mustHave: ['Active PM doing customer discovery', 'B2B SaaS context'],
    avoid: ['PMs who do not conduct discovery interviews'],
  },
  forbiddenQuestions: ['Would you use this tool?', 'Do you think this is a good idea?'],
  assumptionMap: [
    { assumption: 'Evidence misclassification happens regularly', riskLevel: 'high', whatToAskAbout: 'recent wrong decision', strongEvidence: 'named bad build', weakEvidence: 'general frustration' },
    { assumption: 'PMs feel this pain acutely', riskLevel: 'high', whatToAskAbout: 'urgency level', strongEvidence: 'workaround behavior', weakEvidence: 'opinion' },
    { assumption: 'Current tools do not solve this', riskLevel: 'medium', whatToAskAbout: 'existing solutions', strongEvidence: 'spend on alternatives', weakEvidence: 'wishlist item' },
    { assumption: 'PMs would pay to fix this', riskLevel: 'medium', whatToAskAbout: 'budget signals', strongEvidence: 'prior purchase', weakEvidence: 'hypothetical' },
  ],
}

const VALID_ANALYSIS: StructuredAnalysis = {
  decision: 'test commitment',
  summary: 'Participant showed concrete evidence of a past wrong build decision caused by misreading customer signals.',
  signalScore: {
    problemEvidence: 'strong',
    urgency: 'medium',
    workaroundEvidence: 'strong',
    budgetOrCommitment: 'weak',
  },
  strongEvidence: [
    { quote: 'We built the Slack integration because three customers said they would love it. None of them used it.', message_id: 'msg-010', whyItMatters: 'Concrete $15k mistake from misreading future-tense signals as validated demand.' },
  ],
  mediumEvidence: [
    { quote: 'I spend about 30 minutes writing up notes after each call.', message_id: 'msg-006', context: 'Clear time cost but no urgency signal yet.' },
  ],
  weakEvidence: [
    { quote: 'I would love a tool that does this automatically.', message_id: 'msg-008', whyItIsWeak: 'Future hypothetical — no current behavior or spend.' },
  ],
  negativeEvidence: [],
  openQuestions: [
    'Does this happen often enough to justify ongoing spend?',
    'Is the PM the actual budget owner or does a team lead approve tools?',
  ],
  recommendedNextStep: 'Run 3 more interviews targeting senior PMs at Series A+ companies with budget authority.',
}

const VALID_SCRIPT: InterviewScript = {
  goal: 'Understand how PMs handle signal classification after customer discovery interviews',
  rulesForInterviewer: ['Do not pitch the product', 'Ask one question at a time', 'Ask about past behavior'],
  questions: Array.from({ length: 8 }, (_, i) => ({
    order: i + 1,
    question: `Tell me about the last time situation ${i + 1} happened in your workflow.`,
    signalSought: 'problem',
    whyItPasses: 'Asks about past behavior not hypothetical future.',
  })),
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${BOLD}${'═'.repeat(55)}${RESET}`)
  console.log(`${BOLD}  HARNESS DEMO — Validator Davranışı Gösterimi${RESET}`)
  console.log(`${BOLD}  (API çağrısı yok — tamamen lokal)${RESET}`)
  console.log(`${BOLD}${'═'.repeat(55)}${RESET}`)

  let totalPass = 0
  let totalFail = 0

  // ─────────────────────────────────────────────────────────────────────────
  // BÖLÜM 1: validateFullResearchBrief
  // ─────────────────────────────────────────────────────────────────────────

  section('BÖLÜM 1: validateFullResearchBrief')

  // 1a. Geçerli brief
  {
    const r = validateFullResearchBrief(VALID_BRIEF)
    runCheck('Tam dolu geçerli brief → PASS bekleniyor', r.ok,
      r.ok ? `productIdea: "${VALID_BRIEF.productIdea.slice(0, 50)}..."` : '')
    if (!r.ok) showIssues(r.issues)
    r.ok ? totalPass++ : totalFail++
  }

  // 1b. assumptionMap boş
  {
    const broken = { ...VALID_BRIEF, assumptionMap: [] }
    const r = validateFullResearchBrief(broken)
    const expectedFail = !r.ok
    runCheck('assumptionMap boş → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG: Geçmesi gerekmiyor!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 1c. forbiddenQuestions sadece 1 eleman
  {
    const broken = { ...VALID_BRIEF, forbiddenQuestions: ['only one'] }
    const r = validateFullResearchBrief(broken)
    const expectedFail = !r.ok
    runCheck('forbiddenQuestions 1 eleman → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 1d. productIdea çok kısa
  {
    const broken = { ...VALID_BRIEF, productIdea: 'Short' }
    const r = validateFullResearchBrief(broken)
    const expectedFail = !r.ok
    runCheck('productIdea çok kısa (5 karakter) → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 1e. evidenceNeeded.strong boş
  {
    const broken = { ...VALID_BRIEF, evidenceNeeded: { ...VALID_BRIEF.evidenceNeeded, strong: '' } }
    const r = validateFullResearchBrief(broken)
    const expectedFail = !r.ok
    runCheck('evidenceNeeded.strong boş → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 1f. assumptionMap'te geçersiz riskLevel
  {
    const badMap = [
      ...VALID_BRIEF.assumptionMap.slice(0, 3),
      { assumption: 'test', riskLevel: 'critical' as 'high', whatToAskAbout: 'x', strongEvidence: 'y', weakEvidence: 'z' },
    ]
    const broken = { ...VALID_BRIEF, assumptionMap: badMap }
    const r = validateFullResearchBrief(broken)
    const expectedFail = !r.ok
    runCheck('assumptionMap[3].riskLevel="critical" → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BÖLÜM 2: validateStructuredAnalysis
  // ─────────────────────────────────────────────────────────────────────────

  section('BÖLÜM 2: validateStructuredAnalysis')

  // 2a. Geçerli analysis
  {
    const r = validateStructuredAnalysis(VALID_ANALYSIS)
    runCheck('Tam dolu geçerli analysis → PASS bekleniyor', r.ok,
      r.ok ? `decision: "${VALID_ANALYSIS.decision}"` : '')
    if (!r.ok) showIssues(r.issues)
    r.ok ? totalPass++ : totalFail++
  }

  // 2b. Tüm 5 geçerli decision değeri
  const validDecisions = ['continue discovery', 'test commitment', 'change segment', 'stop', 'build narrow prototype']
  for (const d of validDecisions) {
    const r = validateStructuredAnalysis({ ...VALID_ANALYSIS, decision: d })
    runCheck(`decision="${d}" → PASS bekleniyor`, r.ok)
    if (!r.ok) showIssues(r.issues)
    r.ok ? totalPass++ : totalFail++
  }

  // 2c. Geçersiz decision (prose)
  {
    const broken = { ...VALID_ANALYSIS, decision: 'I recommend continuing the discovery process further' }
    const r = validateStructuredAnalysis(broken)
    const expectedFail = !r.ok
    runCheck('decision=prose cümle → FAIL bekleniyor', expectedFail,
      expectedFail ? `Yakalanan değer: "${broken.decision.slice(0, 40)}..."` : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 2d. signalScore geçersiz seviye
  {
    const broken = { ...VALID_ANALYSIS, signalScore: { ...VALID_ANALYSIS.signalScore, urgency: 'moderate' as 'medium' } }
    const r = validateStructuredAnalysis(broken)
    const expectedFail = !r.ok
    runCheck('signalScore.urgency="moderate" → FAIL bekleniyor', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // 2e. openQuestions boş
  {
    const broken = { ...VALID_ANALYSIS, openQuestions: [] }
    const r = validateStructuredAnalysis(broken)
    const expectedFail = !r.ok
    runCheck('openQuestions=[] → FAIL bekleniyor (min 1)', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BÖLÜM 3: validateInterviewScript
  // ─────────────────────────────────────────────────────────────────────────

  section('BÖLÜM 3: validateInterviewScript')

  // 3a. 8 sorulu geçerli script
  {
    const r = validateInterviewScript(VALID_SCRIPT)
    runCheck('8 sorulu geçerli script → PASS bekleniyor', r.ok,
      r.ok ? `${VALID_SCRIPT.questions.length} soru, goal: "${VALID_SCRIPT.goal.slice(0, 40)}..."` : '')
    if (!r.ok) showIssues(r.issues)
    r.ok ? totalPass++ : totalFail++
  }

  // 3b. 5 sorulu script (yetersiz)
  {
    const short = { ...VALID_SCRIPT, questions: VALID_SCRIPT.questions.slice(0, 5) }
    const r = validateInterviewScript(short)
    const expectedFail = !r.ok
    runCheck('5 sorulu script → FAIL bekleniyor (min 8)', expectedFail,
      expectedFail ? 'Validator doğru yakaladı' : 'BUG!')
    if (!r.ok) showIssues(r.issues)
    expectedFail ? totalPass++ : totalFail++
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BÖLÜM 4: parseAndClean — LLM çıktısı temizleme
  // ─────────────────────────────────────────────────────────────────────────

  section('BÖLÜM 4: parseAndClean — Ham LLM Çıktısı Temizleme')

  const cases = [
    { label: 'Temiz JSON', input: JSON.stringify({ a: 1 }), expectOk: true },
    { label: '```json fence', input: '```json\n{"a":1}\n```', expectOk: true },
    { label: 'Prose + JSON', input: 'Sure! Here is the result:\n{"a":1}', expectOk: true },
    { label: 'Sadece prose (JSON yok)', input: 'I cannot process that right now.', expectOk: false },
    { label: 'Kırık JSON', input: '{"a": 1, broken', expectOk: false },
    { label: 'Boş string', input: '', expectOk: false },
  ]

  for (const c of cases) {
    const result = parseAndClean(c.input)
    const ok = c.expectOk ? result !== null : result === null
    runCheck(`${c.label} → ${c.expectOk ? 'PARSE edilmeli' : 'null dönmeli'}`, ok,
      ok ? (result ? `Sonuç: ${JSON.stringify(result).slice(0, 40)}` : 'null döndü (beklenen)') : 'BEKLENMEDIK SONUÇ')
    ok ? totalPass++ : totalFail++
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BÖLÜM 5: Gerçek fixture JSON'ları (fixtures/ klasöründen)
  // ─────────────────────────────────────────────────────────────────────────

  section('BÖLÜM 5: Fixture Dosyaları Doğrulama')

  try {
    const briefInput = JSON.parse(
      readFileSync(join(process.cwd(), 'lib', 'evals', 'fixtures', 'brief-input.json'), 'utf-8')
    ) as unknown[]
    runCheck(`brief-input.json yüklendi (${briefInput.length} mesaj)`, briefInput.length > 0)
    briefInput.length > 0 ? totalPass++ : totalFail++
  } catch {
    runCheck('brief-input.json yüklenemedi', false, 'Dosya bulunamadı')
    totalFail++
  }

  try {
    const analysisInput = JSON.parse(
      readFileSync(join(process.cwd(), 'lib', 'evals', 'fixtures', 'analysis-input.json'), 'utf-8')
    ) as unknown[]
    runCheck(`analysis-input.json yüklendi (${analysisInput.length} mesaj)`, analysisInput.length > 0)
    analysisInput.length > 0 ? totalPass++ : totalFail++
  } catch {
    runCheck('analysis-input.json yüklenemedi', false, 'Dosya bulunamadı')
    totalFail++
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Özet
  // ─────────────────────────────────────────────────────────────────────────

  const total = totalPass + totalFail
  console.log(`\n${BOLD}${'═'.repeat(55)}${RESET}`)
  if (totalFail === 0) {
    console.log(`${GREEN}${BOLD}  SONUÇ: TÜM KONTROLLER GEÇTİ  (${totalPass}/${total})${RESET}`)
    console.log(`${GREEN}  Harness doğru çalışıyor — her validator beklenen davranışı gösteriyor.${RESET}`)
  } else {
    console.log(`${RED}${BOLD}  SONUÇ: ${totalFail} KONTROL BAŞARISIZ  (${totalPass}/${total})${RESET}`)
  }
  console.log(`${BOLD}${'═'.repeat(55)}${RESET}\n`)
}

main().catch((err: unknown) => {
  console.error('[demo-harness] Beklenmeyen hata:', err)
  process.exit(1)
})
