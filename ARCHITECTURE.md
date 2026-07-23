# Architecture

This document describes how MomTest AI is structured and how data flows through the system.

---

## Overview

MomTest AI is a Next.js 16 application with four distinct user-facing flows:

```
PM Intake → Brief Generation → Participant Interview → Evidence Analysis
```

Each flow maps to a dedicated API route. All persistent state lives in PostgreSQL via Drizzle ORM. The LLM provider is swappable via `openai.yaml`. There is no authentication — the dashboard is publicly accessible.

---

## User flows

### Flow 1 — PM Intake

```
PM opens dashboard
  → creates a new project via POST /api/projects (product_idea saved to DB)
  → IntakeChat fetches history via GET /api/messages/[projectId]
  → sends messages to POST /api/intake/[projectId]
  → API calls LLM with PM Intake system prompt
  → LLM asks up to 8 clarifying questions
  → When LLM produces <research_brief> tag → isComplete = true
  → research_brief saved to projects.research_brief (JSONB)
  → IntakeChat enters read-only mode
```

### Flow 2 — Brief & Script Generation

```
PM clicks "Üret" in dashboard
  → POST /api/generate/[projectId] — streaming
  → Server reads intake messages from messages table via Drizzle
  → LLM call 1: produces FullResearchBrief (assumption map, evidence criteria)
    → SSE chunks: stage="research_brief"
    → parsed JSON saved to projects.research_brief
  → LLM call 2: produces InterviewScript (8-10 Mom Test–compliant questions)
    → SSE chunks: stage="interview_script"
    → parsed JSON saved to projects.interview_script
  → SSE done chunk: { researchBriefSaved, interviewScriptSaved }
  → GenerateStream component renders both outputs live
```

### Flow 3 — Participant Interview

```
PM creates interview link via POST /api/interviews/[projectId]
  → Drizzle inserts interview row (status: pending)
  → PM shares /interview/[id] with participant

Participant opens link
  → server page fetches interview status via Drizzle
  → name entry screen (ParticipantChat phase="name")
  → POST /api/interview/[interviewId] with message="Ready"
    → interview.status set to "ongoing"
    → interview_script fetched and injected into LLM system prompt (invisible to participant)
  → conversation loop: participant sends messages, LLM responds
    → Vagueness Guard checks each answer:
        - Confidently concrete (HIGH) → No probe
        - Confidently vague (HIGH) → Generate probe
        - Ambiguous (LOW) → LLM check → Probe if vague
        - Max 2 probes per question
  → closing conditions:
      - 10 meaningful replies (≥5 words each), OR
      - LLM sends closing phrase after ≥3 replies
  → isComplete=true → interview.status="completed"
  → thank-you screen
  → MAKE_WEBHOOK_INTERVIEW_URL fires (fire-and-forget)
```

### Flow 4 — Evidence Analysis

```
PM clicks "Analiz Et" for a completed interview
  → POST /api/analyze/[interviewId]
  → Server fetches full transcript via Drizzle (all messages with IDs)
  → Transcript formatted: "[message_id] Role: content"
  → LLM classifies every participant signal:
      Strong (past behavior, workaround, spend)
      Medium (plausible but unconfirmed)
      Weak (praise, hypotheticals, opinions)
      Negative (no pain, no urgency, no workaround)
  → LLM produces decision: continue / test commitment / change segment / stop / build prototype
  → interviews.signal_score saved (JSONB)
  → interviews.evidence_report saved (Markdown)
  → MAKE_WEBHOOK_ANALYSIS_URL fires (fire-and-forget)
  → PM views report at /report/[interviewId]
```

---

## Data model

```
projects
  ├── research_brief    JSONB  ← FullResearchBrief (assumption map, criteria)
  ├── interview_script  JSONB  ← InterviewScript (goal, rules, questions)
  └── interviews (project_id → projects.id, CASCADE DELETE)
        ├── status           TEXT  (pending | ongoing | completed)
        ├── signal_score     JSONB ← SignalScore (strong/medium/weak/negative arrays)
        ├── evidence_report  TEXT  ← Markdown report
        └── messages (interview_id → interviews.id, CASCADE DELETE)
              ├── sender  TEXT  (agent | participant)
              └── content TEXT

NOTE: intake messages are stored in messages with interview_id = project.id
      (project ID is reused as a virtual interview ID for the intake conversation)
```

Schema is defined in `lib/db/schema.ts` using Drizzle's `pgTable` builder and applied via `npx drizzle-kit push`. There are no RLS policies — all rows are accessible without authentication.

---

## API surface

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/projects` | — | List all projects |
| POST | `/api/projects` | — | Create project |
| DELETE | `/api/projects/[projectId]` | — | Delete project (cascade) |
| GET | `/api/interviews/[projectId]` | — | List interviews for a project |
| POST | `/api/interviews/[projectId]` | — | Create interview link |
| GET | `/api/messages/[interviewId]` | — | Fetch message history |
| POST | `/api/intake/[projectId]` | — | PM intake conversation turn |
| POST | `/api/generate/[projectId]` | — | Stream research brief + script |
| POST | `/api/interview/[interviewId]` | — | Participant interview turn (public) |
| POST | `/api/analyze/[interviewId]` | — | Analyze completed interview |

---

## Vagueness Guard architecture

The Vagueness Guard is a hybrid heuristic + LLM system that detects vague answers during participant interviews:

```
User Answer → isLikelyVagueWithConfidence() →
  ├─ Confidently Concrete (HIGH) → No LLM, No Probe
  ├─ Confidently Vague (HIGH) → No LLM, Probe  
  └─ Ambiguous (LOW) → checkAnswerIsVague() (LLM) → Probe Decision
```

**Three-category logic:**
- **Confidently Concrete:** Has concreteness signals (numbers, dates, time expressions) → `vague: false, confidence: 'high'`
- **Confidently Vague:** Very short (<12 chars) + evasive pattern match → `vague: true, confidence: 'high'`
- **Ambiguous:** Everything else → `vague: true, confidence: 'low'` → Isolated LLM check

**Probe limit:** Max 2 probes per question (`MAX_PROBES_PER_QUESTION = 2`)

**Implementation:** `lib/answer-vagueness-checker.ts` with typo-tolerant pattern matching via `lib/typo-tolerant-match.ts`

---

## Component architecture

```
app/dashboard/page.tsx          ← Server component: fetches projects + interviews via Drizzle
  DashboardWorkspace            ← Client root: manages project list state
    ProjectSidebar              ← Project list, create dialog, delete confirm
    ProjectWorkspace            ← Switches layout based on project status
      ├── 2-column (intake/brief_ready)
      │     ├── left: GenerateStream + BriefViewer + InterviewManager
      │     └── right: IntakeChat
      └── tabbed (interviewing/analyzed)
            ├── tab: Mülakatlar → InterviewManager + ProjectSummaryBar
            ├── tab: Araştırma Dökümanları → GenerateStream + BriefViewer
            └── tab: Intake Geçmişi → IntakeChat (read-only)
```

Client components communicate with the backend exclusively through the REST API endpoints above — no direct database access from the browser.

---

## Database layer

All database access goes through the Drizzle client exported from `lib/db/index.ts`:

```typescript
import { db } from '@/lib/db/index'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const rows = await db
  .select()
  .from(projects)
  .where(eq(projects.id, projectId))
```

JSONB columns (`research_brief`, `interview_script`, `signal_score`) are typed as `unknown` in TypeScript (Drizzle's `jsonb` inference). They are narrowed at the point of use with type guards before rendering.

---

## LLM integration

All four API routes use the OpenAI SDK configured with a swappable provider:

```typescript
new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: agentConfig.model?.base_url,  // from openai.yaml
})
```

`mom-test-customer-discovery/agents/openai.yaml` controls the active model. The SDK's OpenAI-compatible interface works with OpenAI, Groq, Google AI Studio, and any other provider that implements the `/v1/chat/completions` endpoint.

---

## Authentication

Authentication has been removed. There is no login page, no session management, and no ownership checks. `proxy.ts` is a passthrough middleware with an empty `matcher` — it does not protect any routes.

To re-introduce auth, the recommended path is:
1. Add a `user_id` column to the `projects` table
2. Introduce a session mechanism (e.g. JWT cookie, NextAuth, or Supabase Auth)
3. Filter queries by `user_id` in each route handler
4. Restore route protection in `proxy.ts`

---

## Rate limiting

In-memory per-IP rate limiting is applied at the route handler level:

| Route | Limit |
|---|---|
| `/api/interview` (public participant endpoint) | 10 req/min |
| All other routes | 20 req/min |

---

## Webhook pattern

Make.com webhooks follow fire-and-forget semantics — failures are logged but never propagate to the API response. URLs are read from environment variables and checked before calling.

```typescript
if (webhookUrl) {
  void (async () => {
    try { await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) }) }
    catch (err) { console.error('[Route] webhook failed:', err) }
  })()
}
```
