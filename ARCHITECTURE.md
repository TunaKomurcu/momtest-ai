# Architecture

This document describes how MomTest AI is structured and how data flows through the system.

---

## Overview

MomTest AI is a Next.js 16 application with four distinct user-facing flows:

```
PM Intake → Brief Generation → Participant Interview → Evidence Analysis
```

Each flow maps to a dedicated API route. All persistent state lives in Supabase. The LLM provider is swappable via `openai.yaml`.

---

## User flows

### Flow 1 — PM Intake

```
PM opens dashboard
  → creates a new project (product_idea saved to DB)
  → IntakeChat sends messages to POST /api/intake/[projectId]
  → API calls LLM with PM Intake system prompt
  → LLM asks up to 8 clarifying questions
  → When LLM produces <research_brief> tag → isComplete = true
  → research_brief saved to projects.research_brief (JSONB)
  → IntakeChat enters read-only mode
```

### Flow 2 — Brief & Script Generation

```
PM clicks "Üret" in dashboard
  → POST /api/generate/[projectId] — authenticated, streaming
  → Server reads intake messages from messages table
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
PM creates interview link in InterviewManager
  → Supabase inserts interview row (status: pending)
  → PM shares /interview/[id] with participant

Participant opens link
  → name entry screen (ParticipantChat phase="name")
  → POST /api/interview/[interviewId] with message="Ready"
    → interview.status set to "ongoing"
    → interview_script fetched and injected into LLM system prompt (invisible to participant)
  → conversation loop: participant sends messages, LLM responds
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
  → POST /api/analyze/[interviewId] — authenticated
  → Server fetches full transcript (all messages with IDs)
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
profiles
  └── projects (user_id → profiles.id)
        ├── research_brief    JSONB  ← FullResearchBrief (assumption map, criteria)
        ├── interview_script  JSONB  ← InterviewScript (goal, rules, questions)
        └── interviews (project_id → projects.id)
              ├── status           TEXT  (pending | ongoing | completed)
              ├── signal_score     JSONB ← SignalScore (strong/medium/weak/negative arrays)
              ├── evidence_report  TEXT  ← Markdown report
              └── messages (interview_id → interviews.id)
                    ├── sender  TEXT  (agent | participant)
                    └── content TEXT

NOTE: intake messages are stored in messages with interview_id = project.id
      (project ID is reused as a virtual interview ID for the intake conversation)
```

All tables use Row Level Security. A user can only access rows where `user_id = auth.uid()` (directly or through FK joins). The `/api/interview` route is public (no auth required) — participants do not need an account.

---

## Component architecture

```
app/dashboard/page.tsx          ← Server component: fetches projects + interviews
  DashboardWorkspace            ← Client root: manages project list state
    ProjectSidebar              ← Project list, create dialog, delete confirm, logout
    ProjectWorkspace            ← Switches layout based on project status
      ├── 2-column (intake/brief_ready)
      │     ├── left: GenerateStream + BriefViewer + InterviewManager
      │     └── right: IntakeChat
      └── tabbed (interviewing/analyzed)
            ├── tab: Mülakatlar → InterviewManager + ProjectSummaryBar
            ├── tab: Araştırma Dökümanları → GenerateStream + BriefViewer
            └── tab: Intake Geçmişi → IntakeChat (read-only)
```

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

## Authentication & session management

Supabase Auth handles authentication. `lib/supabase/server.ts` manages cookie-based session persistence using `@supabase/ssr`. `proxy.ts` (Next.js 16 equivalent of `middleware.ts`) refreshes sessions on every request and redirects unauthenticated users away from protected routes.

---

## Rate limiting

In-memory per-IP rate limiting is applied at the route handler level:

| Route | Limit |
|---|---|
| `/api/interview` (public) | 10 req/min |
| `/api/intake`, `/api/generate`, `/api/analyze` (authenticated) | 20 req/min |

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
