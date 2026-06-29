# MomTest AI

AI-powered customer discovery platform built on [Mom Test](http://momtestbook.com/) principles. Helps product managers design and run customer interviews that reveal real behavior instead of false validation.

---

## What it does

1. **PM Intake** — An AI architect asks up to 8 questions to extract the product idea, target segment, and riskiest assumption from the PM.
2. **Research Brief + Interview Script** — Generates a structured research brief (assumption map, evidence criteria, forbidden questions) and a Mom Test–compliant interview script via LLM streaming.
3. **Participant Interview** — Shareable public link opens a chat interface where the participant is interviewed by an AI agent that never pitches the product.
4. **Evidence Analysis** — Transcripts are analyzed against the Mom Test evidence rubric. Every signal is classified as Strong / Medium / Weak / Negative and an evidence report with a decision recommendation is produced.
5. **Dashboard** — PM can view all projects, briefs, interview history, consolidated signal summaries, and evidence reports. Briefs and scripts can be downloaded as JSON.

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2 |
| Language | TypeScript | 5.9 |
| Database & Auth | Supabase (PostgreSQL, RLS, Auth, SSR) | 2.x |
| LLM | OpenAI SDK — OpenAI-compatible (swappable via `openai.yaml`) | 4.x |
| Streaming | Server-Sent Events via native `ReadableStream` | — |
| Styling | Tailwind CSS v4, `tw-animate-css` | 4.x |
| UI Components | Base UI (headless), `class-variance-authority`, `lucide-react` | 1.6 |
| Notifications | Sonner toast | 2.x |
| Config parsing | `js-yaml` | 5.x |
| Testing | Vitest + `@vitest/coverage-v8` + MSW | 3.x |
| Runtime | Node.js | 20+ |

---

## Project structure

```
app/
  api/
    intake/[projectId]/       POST  — PM intake conversation
    generate/[projectId]/     POST  — streaming research brief + interview script
    interview/[interviewId]/  POST  — public participant interview (no auth)
    analyze/[interviewId]/    POST  — evidence analysis and report generation
  auth/
    login/                    Login + sign-up page
    callback/                 Supabase OAuth / email confirmation handler
  dashboard/                  Protected PM workspace
  interview/[id]/             Public participant chat page
  report/[interviewId]/       Evidence report viewer

components/
  auth/                       LoginForm (login + signup tabs, email verification)
  dashboard/
    dashboard-workspace       Root client layout with sidebar + workspace
    project-sidebar           Project list, create, delete, logout
    project-workspace         Tabbed workspace (Interviews / Briefs / Intake History)
    brief-viewer              Research brief + interview script viewer with JSON download
    intake-chat               PM intake chat (read-only in history mode)
    generate-stream           SSE consumer for brief + script streaming
    interview-manager         Interview link management + per-interview actions
    project-summary-bar       Consolidated signal counts across analyzed interviews
  ui/                         Base UI + shadcn component library

lib/
  supabase/
    client.ts                 Browser Supabase client
    server.ts                 Server-side Supabase client (cookies)
  api-helpers/
    intake.ts                 extractResearchBrief, checkIntakeCompletion
    interview.ts              isClosingMessage, serializeInterviewScript, shouldCloseInterview
    analyze.ts                buildSignalScore, buildSignalSummary, buildMarkdownReport
    json.ts                   parseJsonOutput (LLM fence stripping)
    sse.ts                    encodeChunk / decodeChunk
  project-status.ts           deriveProjectStatus state machine

types/
  database.types.ts           Supabase table types (Row / Insert / Update)
  index.ts                    Application-level types (API shapes, LLM mappings)

supabase/
  schema.sql                  Full PostgreSQL schema (tables, RLS, indexes, triggers)

tests/
  unit/                       Pure helper unit tests (project-status, api-helpers)
  integration/                API helper + MSW HTTP mock tests
  mom-test/                   Domain tests — Mom Test methodology rules
    intake-flow               PM intake agent behavior
    question-quality          Interview question anti-pattern detection
    evidence-classifier       Signal classification (personas: Maya, Deniz, Arda)
    report-format             Evidence report structure and forbidden phrases

mom-test-customer-discovery/
  agents/openai.yaml          LLM provider config (model, base_url, temperature)
  references/                 Domain reference documents (evidence rubric, question bank)
  SKILL.md                    PM discovery skill definitions (Skills 2, 3, 5, 6)
```

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/your-org/momtest-ai.git
cd momtest-ai
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the **SQL Editor** (Dashboard → SQL Editor → paste → Run)
3. Enable email confirmations: Authentication → Email Templates → confirm the default template is active

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
OPENAI_API_KEY=sk-proj-...
```

### 4. Configure the LLM provider (optional)

Edit `mom-test-customer-discovery/agents/openai.yaml` to change the model or provider:

```yaml
model:
  provider: "openai"          # openai | google | groq | any OpenAI-compatible
  name: "gpt-4o-mini"
  base_url: "https://api.openai.com/v1"
  temperature: 0.7
  max_tokens: 1024
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Database schema

Four tables with RLS enabled:

| Table | Purpose |
|---|---|
| `profiles` | Synced with `auth.users` via trigger |
| `projects` | One per product idea — stores `research_brief` and `interview_script` as JSONB |
| `interviews` | One per participant — stores `transcript`, `signal_score`, `evidence_report` |
| `messages` | Individual chat messages for both intake and participant interviews |

All cascade deletes: removing a project removes all its interviews and messages.

---

## Running tests

```bash
npm test               # run all tests once
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

**389 tests** across three layers:

- `tests/unit/` — pure TypeScript logic, no dependencies
- `tests/integration/` — API helpers + MSW HTTP mocks
- `tests/mom-test/` — Mom Test domain rules (evidence rubric, question patterns, report format)

---

## Key conventions

- All API routes live under `app/api/` and follow `{ data: T, error: null }` / `{ data: null, error: string }` response shape.
- Public routes (e.g. `/api/interview`) apply a 10 req/min rate limit per IP. Authenticated routes apply 20 req/min.
- Supabase clients are never instantiated inline — always use `lib/supabase/client.ts` (browser) or `lib/supabase/server.ts` (server).
- `any` type is forbidden — all Supabase query results are typed via `types/database.types.ts`.
- The `proxy.ts` file (Next.js 16 replacement for `middleware.ts`) handles session refresh and route protection.

---

## Deployment

The project is designed for [Vercel](https://vercel.com). Set the same environment variables in the Vercel project settings and deploy from the main branch.

Make sure `SUPABASE_SERVICE_ROLE_KEY` is marked as a **secret** (not exposed to browser) in your deployment environment.
