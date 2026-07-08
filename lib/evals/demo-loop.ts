/**
 * demo-loop.ts — Loop'un gerçekten tetiklendiğini gösteren demo
 *
 * Kullanım: npx tsx lib/evals/demo-loop.ts
 *
 * Ne yapar:
 *   Gerçek LLM API'sini çağırır ama ilk yanıtı kasıtlı olarak bozar.
 *   Loop'un bozuk yanıtı yakalayıp retry yaptığını ve düzelttiğini
 *   terminalde adım adım görebilirsin.
 *
 *   3 senaryo çalışır:
 *   1. JSON parse hatası → loop → düzelir
 *   2. Validation hatası (eksik alan) → loop → düzelir
 *   3. İki kez hata → loop → yine düzelir
 */

import { config } from 'dotenv'
import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { join } from 'path'
import { load as yamlLoad } from 'js-yaml'
import { callWithJsonRetry, parseAndClean } from '@/lib/ai-guards/json-retry'
import { validateFullResearchBrief } from '@/lib/ai-guards/brief-validator'
import type { OpenAIAgentConfig, FullResearchBrief } from '@/types/index'

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

function log(msg: string) { console.log(msg) }
function section(title: string) {
  log(`\n${BOLD}${YELLOW}${'─'.repeat(50)}${RESET}`)
  log(`${BOLD}${YELLOW}  ${title}${RESET}`)
  log(`${BOLD}${YELLOW}${'─'.repeat(50)}${RESET}`)
}
function step(n: number, msg: string) { log(`\n${CYAN}[ADIM ${n}]${RESET} ${msg}`) }
function ok(msg: string)   { log(`  ${GREEN}✓${RESET} ${msg}`) }
function bad(msg: string)  { log(`  ${RED}✗${RESET} ${msg}`) }
function dim(msg: string)  { log(`  ${DIM}${msg}${RESET}`) }

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

function loadAgentConfig(): Partial<OpenAIAgentConfig> {
  try {
    const raw = readFileSync(join(process.cwd(), 'mom-test-customer-discovery', 'agents', 'openai.yaml'), 'utf-8')
    return yamlLoad(raw) as Partial<OpenAIAgentConfig>
  } catch { return {} }
}

// ---------------------------------------------------------------------------
// System prompt (kısa — sadece demo için)
// ---------------------------------------------------------------------------

const BRIEF_SYSTEM_PROMPT = `You are a customer discovery architect.
Output ONLY valid JSON with these exact fields:
{
  "productIdea": "one sentence",
  "targetCustomer": "who",
  "coreSituation": "when",
  "currentBelief": "what PM believes",
  "riskiestAssumption": "riskiest assumption",
  "interviewObjective": "what to learn",
  "evidenceNeeded": { "strong": "...", "weak": "...", "negative": "..." },
  "participantCriteria": { "mustHave": ["..."], "avoid": ["..."] },
  "forbiddenQuestions": ["...", "..."],
  "assumptionMap": [
    {"assumption":"...","riskLevel":"high","whatToAskAbout":"...","strongEvidence":"...","weakEvidence":"..."},
    {"assumption":"...","riskLevel":"medium","whatToAskAbout":"...","strongEvidence":"...","weakEvidence":"..."},
    {"assumption":"...","riskLevel":"low","whatToAskAbout":"...","strongEvidence":"...","weakEvidence":"..."},
    {"assumption":"...","riskLevel":"high","whatToAskAbout":"...","strongEvidence":"...","weakEvidence":"..."}
  ]
}
No markdown, no prose, no explanation. Only the JSON object.`

// ---------------------------------------------------------------------------
// Wrapper — ilk N çağrıyı kasıtlı bozar, sonrasında gerçek LLM'e geçer
// ---------------------------------------------------------------------------

function makeInterceptedOpenAI(
  realOpenAI: OpenAI,
  intercepts: Array<{ mode: 'broken_json' | 'missing_field'; label: string }>
): OpenAI {
  let callCount = 0

  return {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          const thisCall = callCount++
          const intercept = intercepts[thisCall]

          if (intercept) {
            log(`\n  ${RED}[INTERCEPTOR]${RESET} Çağrı #${thisCall + 1} kasıtlı olarak bozuluyor: ${intercept.label}`)

            if (intercept.mode === 'broken_json') {
              const fakeBroken = `Sure! Here is the research brief for you:\n{ "productIdea": "broken json without closing brace"`
              log(`  ${DIM}Döndürülen bozuk yanıt: ${fakeBroken.slice(0, 80)}...${RESET}`)
              return {
                choices: [{ message: { content: fakeBroken, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
              }
            }

            if (intercept.mode === 'missing_field') {
              // Parse edilebilir JSON ama assumptionMap boş (min 4 eleman gerekli)
              const fakeIncomplete = JSON.stringify({
                productIdea: 'AI interview analysis tool for B2B SaaS',
                targetCustomer: 'Product managers',
                coreSituation: 'After a discovery interview',
                currentBelief: 'PMs cannot distinguish strong signals',
                riskiestAssumption: 'PMs feel enough pain to pay',
                interviewObjective: 'Confirm the pain is real',
                evidenceNeeded: { strong: 'past bad decision', weak: 'opinion', negative: 'no urgency' },
                participantCriteria: { mustHave: ['Active PM'], avoid: ['non-PM'] },
                forbiddenQuestions: ['Would you use this?', 'Do you like this?'],
                assumptionMap: [
                  { assumption: 'Only one assumption', riskLevel: 'high', whatToAskAbout: 'topic', strongEvidence: 'x', weakEvidence: 'y' },
                ],
                // ^^^ kasıtlı: sadece 1 eleman, min 4 gerekli
              })
              log(`  ${DIM}Döndürülen eksik yanıt: assumptionMap sadece 1 eleman içeriyor (min 4 gerekli)${RESET}`)
              return {
                choices: [{ message: { content: fakeIncomplete, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
              }
            }
          }

          // Gerçek LLM çağrısı
          log(`\n  ${GREEN}[REAL LLM]${RESET} Çağrı #${thisCall + 1} — gerçek API'ye gidiyor...`)
          return realOpenAI.chat.completions.create({ ...params, stream: false })
        },
      },
    },
  } as unknown as OpenAI
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`\n${BOLD}${'═'.repeat(55)}${RESET}`)
  log(`${BOLD}  LOOP DEMO — Retry Mekanizması Canlı Gösterimi${RESET}`)
  log(`${BOLD}${'═'.repeat(55)}${RESET}`)

  if (!process.env.OPENAI_API_KEY) {
    log(`${RED}HATA: OPENAI_API_KEY bulunamadı.${RESET}`)
    process.exit(1)
  }

  const agentConfig = loadAgentConfig()
  const realOpenAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: agentConfig.model?.base_url ?? 'https://api.groq.com/openai/v1',
  })

  const userInput = 'We are building an AI tool that analyzes customer discovery interviews for B2B SaaS product managers.'

  // ─────────────────────────────────────────────────────────────────────────
  // SENARYO 1: JSON parse hatası → retry → düzelir
  // ─────────────────────────────────────────────────────────────────────────

  section('SENARYO 1: JSON Parse Hatası → Retry → Düzelir')

  log('\n  Simülasyon: LLM ilk çağrıda prose + bozuk JSON döndürüyor.')
  log('  Loop bunu yakalamalı, retry yapmalı, gerçek LLM\'den düzgün yanıt almalı.\n')

  const openai1 = makeInterceptedOpenAI(realOpenAI, [
    { mode: 'broken_json', label: 'Prose + kırık JSON (kapanış parantezi yok)' },
    // 2. çağrı interceptor yok → gerçek LLM
  ])

  step(1, 'callWithJsonRetry başlatılıyor...')
  const result1 = await callWithJsonRetry<FullResearchBrief>(
    openai1,
    {
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.3,
      max_tokens: 1500,
      stream: false,
      messages: [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'user', content: userInput },
      ],
    },
    validateFullResearchBrief,
    '[DEMO/senaryo1]',
    2
  )

  step(2, 'Sonuç kontrol ediliyor...')
  if (result1) {
    ok(`Loop düzeltti! Sonuç: productIdea = "${result1.productIdea.slice(0, 60)}..."`)
    ok(`assumptionMap: ${result1.assumptionMap.length} eleman`)
  } else {
    bad('Loop başarısız oldu, null döndü.')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SENARYO 2: Validation hatası → retry → düzelir
  // ─────────────────────────────────────────────────────────────────────────

  section('SENARYO 2: Validation Hatası → Retry → Düzelir')

  log('\n  Simülasyon: LLM geçerli JSON ama eksik alan (assumptionMap 1 eleman) döndürüyor.')
  log('  Validator yakalayacak, loop retry yapacak, gerçek LLM düzeltecek.\n')

  const openai2 = makeInterceptedOpenAI(realOpenAI, [
    { mode: 'missing_field', label: 'assumptionMap sadece 1 eleman (min 4 gerekli)' },
    // 2. çağrı → gerçek LLM
  ])

  step(1, 'callWithJsonRetry başlatılıyor...')
  const result2 = await callWithJsonRetry<FullResearchBrief>(
    openai2,
    {
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.3,
      max_tokens: 1500,
      stream: false,
      messages: [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'user', content: userInput },
      ],
    },
    validateFullResearchBrief,
    '[DEMO/senaryo2]',
    2
  )

  step(2, 'Sonuç kontrol ediliyor...')
  if (result2) {
    ok(`Loop düzeltti! assumptionMap: ${result2.assumptionMap.length} eleman (min 4 gerekli, karşılandı)`)
    ok(`forbiddenQuestions: ${result2.forbiddenQuestions.length} eleman`)
  } else {
    bad('Loop başarısız oldu, null döndü.')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SENARYO 3: İki kez hata → 3. deneme başarılı
  // ─────────────────────────────────────────────────────────────────────────

  section('SENARYO 3: 2 Ardışık Hata → 3. Denemede Başarı')

  log('\n  Simülasyon: İlk 2 çağrı sırayla bozuk JSON + eksik alan.')
  log('  Loop 3. denemede gerçek LLM\'e ulaşıp başarılı olacak.\n')

  const openai3 = makeInterceptedOpenAI(realOpenAI, [
    { mode: 'broken_json',   label: '1. deneme: kırık JSON' },
    { mode: 'missing_field', label: '2. deneme: eksik alan' },
    // 3. çağrı → gerçek LLM
  ])

  step(1, 'callWithJsonRetry başlatılıyor (maxRetries=2)...')
  const result3 = await callWithJsonRetry<FullResearchBrief>(
    openai3,
    {
      model: agentConfig.model?.name ?? 'gemini-flash-latest',
      temperature: 0.3,
      max_tokens: 1500,
      stream: false,
      messages: [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'user', content: userInput },
      ],
    },
    validateFullResearchBrief,
    '[DEMO/senaryo3]',
    2
  )

  step(2, 'Sonuç kontrol ediliyor...')
  if (result3) {
    ok(`3 denemede başarı! productIdea = "${result3.productIdea.slice(0, 60)}..."`)
    ok(`assumptionMap: ${result3.assumptionMap.length} eleman`)
  } else {
    bad('Loop tüm denemeleri tüketti, null döndü.')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Özet
  // ─────────────────────────────────────────────────────────────────────────

  log(`\n${BOLD}${'═'.repeat(55)}${RESET}`)
  const allOk = result1 && result2 && result3
  if (allOk) {
    log(`${GREEN}${BOLD}  DEMO TAMAMLANDI: 3/3 senaryo başarılı${RESET}`)
    log(`${GREEN}  Loop her senaryoda bozuk yanıtı yakalayıp düzeltti.${RESET}`)
  } else {
    log(`${RED}${BOLD}  DEMO: Bazı senaryolar başarısız oldu.${RESET}`)
  }
  log(`${BOLD}${'═'.repeat(55)}${RESET}\n`)
}

main().catch((err: unknown) => {
  console.error('[demo-loop] Beklenmeyen hata:', err)
  process.exit(1)
})
