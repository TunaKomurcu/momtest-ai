# MomTest AI

AI-powered customer discovery platform built on [Mom Test](http://momtestbook.com/) principles. Helps product managers design and run customer interviews that reveal real behavior instead of false validation.

---

## What it does

1. **PM Intake** — An AI architect asks up to 8 questions to extract the product idea, target segment, and riskiest assumption from the PM.
2. **Research Brief + Interview Script** — Generates a structured research brief (assumption map, evidence criteria, forbidden questions) and a Mom Test–compliant interview script via LLM streaming.
3. **Participant Interview** — Shareable public link opens a chat interface where the participant is interviewed by an AI agent that never pitches the product. Includes **Vagueness Guard** to detect vague answers and generate follow-up probes.
4. **Evidence Analysis** — Transcripts are analyzed against the Mom Test evidence rubric. Every signal is classified as Strong / Medium / Weak / Negative and an evidence report with a decision recommendation is produced.
5. **Dashboard** — PM can view all projects, briefs, interview history, consolidated signal summaries, and evidence reports. Briefs and scripts can be downloaded as JSON.

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2 |
| Language | TypeScript | 5.9 |
| Database | PostgreSQL via Drizzle ORM | — |
| LLM | OpenAI SDK — OpenAI-compatible (swappable via `openai.yaml`) | 4.x |
| Streaming | Server-Sent Events via native `ReadableStream` | — |
| Styling | Tailwind CSS v4, `tw-animate-css` | 4.x |
| UI Components | Base UI (headless), `class-variance-authority`, `lucide-react` | 1.6 |
| Notifications | Sonner toast | 2.x |
| Config parsing | `js-yaml` | 5.x |
| Runtime | Node.js | 20+ |

---

## Project structure

```
app/
  api/
    intake/[projectId]/       POST   — PM intake conversation
    generate/[projectId]/     POST   — streaming research brief + interview script
    interview/[interviewId]/  POST   — public participant interview (no auth)
    analyze/[interviewId]/    POST   — evidence analysis and report generation
    projects/                 GET    — list all projects
                              POST   — create project
    projects/[projectId]/     DELETE — delete project and cascade
    interviews/[projectId]/   GET    — list interviews for a project
                              POST   — create interview link
    messages/[interviewId]/   GET    — fetch message history
  auth/
    login/                    Redirects to /dashboard (auth removed)
    callback/                 Redirects to /dashboard (auth removed)
  dashboard/                  PM workspace (public, no login required)
  interview/[id]/             Public participant chat page
  report/[interviewId]/       Evidence report viewer

components/
  dashboard/
    dashboard-workspace       Root client layout with sidebar + workspace
    project-sidebar           Project list, create dialog, delete confirm
    project-workspace         Tabbed workspace (Interviews / Briefs / Intake History)
    brief-viewer              Research brief + interview script viewer with JSON download
    intake-chat               PM intake chat (read-only in history mode)
    generate-stream           SSE consumer for brief + script streaming
    interview-manager         Interview link management + per-interview actions
    project-summary-bar       Consolidated signal counts across analyzed interviews
  ui/                         Base UI + shadcn component library

lib/
  db/
    index.ts                  Drizzle client (node-postgres pool)
    schema.ts                 Table definitions (projects, interviews, messages)
  api-helpers/
    intake.ts                 extractResearchBrief, checkIntakeCompletion
    interview.ts              isClosingMessage, serializeInterviewScript, shouldCloseInterview
    analyze.ts                buildSignalScore, buildSignalSummary, buildMarkdownReport
    json.ts                   parseJsonOutput (LLM fence stripping)
    sse.ts                    encodeChunk / decodeChunk
  project-status.ts           deriveProjectStatus state machine
  answer-vagueness-checker.ts Vagueness Guard: heuristic + LLM hybrid vagueness detection
  constants.ts                EVASIVE_PATTERNS, CONCRETENESS_PATTERNS
  typo-tolerant-match.ts      Fuzzy matching for evasive phrases with typos

types/
  database.types.ts           Drizzle InferSelectModel / InferInsertModel types
  index.ts                    Application-level types (API shapes, LLM mappings)

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

### 2. Start PostgreSQL

A `docker-compose.yml` is included for local development:

```bash
docker compose up -d
```

Or point `DATABASE_URL` to any existing PostgreSQL instance.

### 3. Run migrations

```bash
npx drizzle-kit push
```

This applies the schema from `lib/db/schema.ts` to your database.

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/momtest
OPENAI_API_KEY=sk-proj-...
MAKE_WEBHOOK_INTERVIEW_URL=   # optional
MAKE_WEBHOOK_ANALYSIS_URL=    # optional
```

### 5. Configure the LLM provider (optional)

Edit `mom-test-customer-discovery/agents/openai.yaml` to change the model or provider:

```yaml
model:
  provider: "groq"
  name: "llama-3.3-70b-versatile"
  base_url: "https://api.groq.com/openai/v1"
  temperature: 0.7
  max_tokens: 1024
```

### 6. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you land directly on the dashboard, no login required.

---

## Database schema

Three tables managed by Drizzle ORM:

| Table | Purpose |
|---|---|
| `projects` | One per product idea — stores `research_brief` and `interview_script` as JSONB |
| `interviews` | One per participant — stores `signal_score` and `evidence_report` |
| `messages` | Individual chat messages for both intake and participant interviews |

All cascade deletes: removing a project removes all its interviews and messages.

> **Note:** There is no `user_id` column or Row Level Security. All data is accessible without authentication. Auth can be re-added later by introducing a `user_id` column and RLS policies.

---

## Key conventions

- All API routes live under `app/api/` and follow `{ data: T, error: null }` / `{ data: null, error: string }` response shape.
- Public routes (e.g. `/api/interview`) apply a 10 req/min rate limit per IP. Other routes apply 20 req/min.
- Database access uses Drizzle ORM exclusively — never raw SQL strings or inline client instantiation.
- `any` type is forbidden — all query results are typed via `types/database.types.ts` (Drizzle `InferSelectModel`).
- JSONB fields (`research_brief`, `interview_script`, `signal_score`) are typed as `unknown` on the TypeScript side and narrowed at the point of use.
- `proxy.ts` (Next.js 16 replacement for `middleware.ts`) is a passthrough — no session logic.

---

## Deployment

The project is designed for [Vercel](https://vercel.com). Set the environment variables in the Vercel project settings and deploy from the main branch. You will need a hosted PostgreSQL database (Neon, Supabase DB-only, Railway, etc.) — set `DATABASE_URL` accordingly.
