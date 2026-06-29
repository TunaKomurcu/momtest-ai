# Changelog

All notable changes to MomTest AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
