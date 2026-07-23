# Changelog

All notable changes to MomTest AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Vagueness Guard** — Hybrid heuristic + LLM system to detect vague answers during participant interviews
- **`isLikelyVagueWithConfidence()`** — Three-category vagueness detection (confidently concrete/vague, ambiguous)
- **`checkAnswerIsVague()`** — Isolated LLM check for ambiguous cases with meaning-only evaluation prompt
- **Typo-tolerant pattern matching** — Fuzzy matching for evasive phrases via `lib/typo-tolerant-match.ts`
- **Probe limit enforcement** — Max 2 probes per question to prevent infinite probing
- **Vagueness logging** — Structured logging format: `[Vagueness] answer=vague, confidence=high/low, source=intake/interview, reason=...`

### Changed
- **PM Intake flow** — Integrated Vagueness Guard with confidence-based conditional LLM calling
- **Participant Interview flow** — Integrated Vagueness Guard with confidence-based conditional LLM calling
- **EVASIVE_PATTERNS usage** — Limited to very short (<12 chars) + clear match combination only
- **Concreteness detection** — Removed length restriction, now purely based on concreteness signals

### Fixed
- **Word list over-reliance** — EVASIVE_PATTERNS no longer standalone decision-maker, only confirmation signal
- **LLM call efficiency** — Reduced unnecessary LLM calls by using high-confidence heuristic decisions

---

## [0.6.0] — 2026-07

### Changed (Breaking)
- **Supabase replaced with Drizzle ORM** — All database access now goes through Drizzle (`lib/db/index.ts`, `lib/db/schema.ts`). `@supabase/supabase-js` and `@supabase/ssr` packages are no longer used.
- **Authentication removed** — There is no login, no session management, and no ownership checks. The dashboard is publicly accessible. `lib/supabase/client.ts` and `lib/supabase/server.ts` are now empty stubs.
- **`user_id` column removed from `projects`** — The schema no longer associates projects with a user. All projects are visible to everyone.
- **Database types rewritten** — `types/database.types.ts` now uses Drizzle `InferSelectModel` / `InferInsertModel` instead of the Supabase `Database` namespace. JSONB fields (`research_brief`, `interview_script`, `signal_score`) are typed as `unknown`.

### Added
- **`GET /api/projects`** — List all projects.
- **`POST /api/projects`** — Create a project (replaces the inline Supabase insert in `NewProjectDialog`).
- **`DELETE /api/projects/[projectId]`** — Delete a project (replaces the inline Supabase delete in `ProjectSidebar`).
- **`GET /api/interviews/[projectId]`** — List interviews for a project (replaces the inline Supabase query in `InterviewManager`).
- **`POST /api/interviews/[projectId]`** — Create an interview link (replaces the inline Supabase insert in `InterviewManager`).
- **`GET /api/messages/[interviewId]`** — Fetch message history (replaces the inline Supabase query in `IntakeChat`).

### Migrated
- `app/api/analyze/[interviewId]/route.ts` — Drizzle queries, auth guard removed.
- `app/dashboard/page.tsx` — Drizzle queries, auth redirect removed, `userEmail` prop removed.
- `app/report/[interviewId]/page.tsx` — Drizzle queries, ownership check removed.
- `app/interview/[id]/page.tsx` — Drizzle queries.
- `components/dashboard/new-project-dialog.tsx` — `POST /api/projects` instead of inline Supabase insert.
- `components/dashboard/intake-chat.tsx` — `GET /api/messages/[projectId]` instead of inline Supabase query.
- `components/dashboard/interview-manager.tsx` — `/api/interviews/[projectId]` GET/POST and `/api/analyze/[interviewId]` instead of inline Supabase queries.
- `components/dashboard/project-sidebar.tsx` — `DELETE /api/projects/[projectId]` instead of inline Supabase delete; auth footer and logout button removed.

### Fixed
- `proxy.ts` — Removed `@supabase/ssr` dependency and all session middleware logic; replaced with a passthrough (`NextResponse.next()`) with an empty matcher.
- `components/dashboard/project-workspace.tsx` — `(project.research_brief ?? project.interview_script) &&` returned `unknown`, causing a `ReactNode` type error; fixed with `!!` cast.
- `app/api/interview/[interviewId]/route.ts` — Truncated file (missing closing parentheses on `JSON.stringify` call and final `return` statement) repaired.

---

## [0.5.0] — 2026-06-18

### Added
- **Sign-up and email verification** — Login page now has Giriş Yap / Kayıt Ol tabs. Sign-up sends a Supabase confirmation email; unverified users are redirected to a verification pending screen with a resend option.
- **Intake history tab** — `interviewing` and `analyzed` projects now have a third workspace tab ("Intake Geçmişi") showing the full read-only PM intake conversation.
- **Research document regeneration** — "Araştırma Dökümanları" tab now includes the GenerateStream component so briefs can be regenerated from any project state.
- **Project deletion** — Each project in the sidebar has a `⋯` menu with a "Projeyi Sil" option, guarded by a confirmation dialog. Cascade deletes remove all related interviews and messages.
- **Consolidated signal summary** (`ProjectSummaryBar`) — displayed above the interview list when at least one interview has been analyzed; shows total Strong / Medium / Weak / Negative signal counts and decision distribution across all interviews.
- **Persistent brief viewer** (`BriefViewer`) — Research Brief and Interview Script are now read from the database and displayed permanently in a tabbed panel with JSON download buttons.
- **Tabbed workspace** — `interviewing` and `analyzed` projects now use a three-tab layout (Mülakatlar / Araştırma Dökümanları / Intake Geçmişi) instead of showing only the interview manager.
- **Unit and integration test suites** — 389 tests across `tests/unit/`, `tests/integration/`, and `tests/mom-test/`. Added Vitest, `@vitest/coverage-v8`, and MSW.
- **Pure helper extraction** (`lib/api-helpers/`) — `intake.ts`, `interview.ts`, `analyze.ts`, `json.ts`, `sse.ts` extracted from route handlers for testability.

### Fixed
- **Evidence analysis overwrote `research_brief`** — `/api/analyze` was replacing `projects.research_brief` with `{ analyzed: true }`, destroying the generated brief. The erroneous `update` call has been removed; project status is now derived solely from `interviews.evidence_report` / `signal_score`.
- **Logout "page could not reload" error** — replaced `router.replace()` + `router.refresh()` with `window.location.href` for a hard navigation that clears all client state cleanly.
- **`DropdownMenuLabel` outside group** — `MenuGroupContext is missing` runtime error fixed by wrapping the label inside `<DropdownMenuGroup>`.
- **`js-yaml` ESM default export** — replaced `import yaml from 'js-yaml'` with `import { load as yamlLoad } from 'js-yaml'` across all four API routes.

---

## [0.4.0] — 2026-06

### Added
- **`/report/[interviewId]` page** — Evidence report with decision banner (color-coded by outcome), signal score cards (clickable to filter evidence quotes), and filterable transcript with inline signal badges.
- **`InterviewManager` component** — Create interview links, copy to clipboard, open in new tab, trigger analysis, view report. Integrated into `ProjectWorkspace` for `brief_ready`, `interviewing`, and `analyzed` states.
- **Participant interview page** (`/interview/[id]`) — Public chat with name entry, conversation, and thank-you screens.
- **`isClosingMessage` false-positive fix** — Added a minimum 3-reply gate before the opening frame can trigger interview closure.
- **Markdown rendering** in message bubbles (`**bold**` and newlines).
- **`proxy.ts`** — Migrated from deprecated `middleware.ts` to `proxy.ts` (Next.js 16 convention); export renamed from `middleware` to `proxy`.
- **`allowedDevOrigins`** added to `next.config.ts` for cross-origin HMR on local network.

---

## [0.3.0] — 2026-05

### Added
- **`/api/analyze/[interviewId]`** — Evidence analysis route; classifies transcript signals against the Mom Test evidence rubric; saves `signal_score` (JSONB) and `evidence_report` (Markdown) to the database.
- **`/api/interview/[interviewId]`** — Public participant interview route with rate limiting (10 req/min), status transitions (`pending → ongoing → completed`), closing detection, and Make.com webhook.
- **LLM provider migration** to OpenAI SDK with configurable `base_url` via `openai.yaml`; supports OpenAI, Groq, Google AI Studio, and any OpenAI-compatible endpoint.

---

## [0.2.0] — 2026-05

### Added
- **`/api/generate/[projectId]`** — Streaming SSE route; two sequential LLM calls produce `FullResearchBrief` (Skill 2 assumption map) and `InterviewScript` (Skill 3 Mom Test–compliant questions); both saved to `projects` JSONB columns.
- **`GenerateStream` component** — Consumes SSE stream and renders research brief and interview script side-by-side with live streaming output.
- **Dashboard UI** — `DashboardWorkspace`, `ProjectSidebar`, `ProjectWorkspace`, `IntakeChat`, `NewProjectDialog`, `StatusBadge` components.
- **`deriveProjectStatus`** — Pure function that computes `intake | brief_ready | interviewing | analyzed` from DB data without a dedicated status column.

---

## [0.1.0] — 2026-04

### Added
- **Project initialization** — Next.js 16 App Router skeleton with Tailwind CSS v4, Base UI, TypeScript 5.
- **Supabase schema** (`supabase/schema.sql`) — `profiles`, `projects`, `interviews`, `messages` tables with RLS policies, indexes, and `updated_at` triggers.
- **`/api/intake/[projectId]`** — PM intake conversation route; LLM asks up to 8 questions and emits `<research_brief>` when complete; saves to `projects.research_brief`.
- **Auth flow** — Supabase email/password login, `/auth/callback` handler for email confirmation and OAuth.
- **`proxy.ts`** — Session refresh and route protection (dashboard + API routes).
- **`lib/supabase/`** — Browser and server Supabase client factories.
- **`types/`** — `database.types.ts` (Supabase table types) and `index.ts` (application-level types).
