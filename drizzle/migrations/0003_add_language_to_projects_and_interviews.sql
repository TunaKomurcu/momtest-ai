-- Migration: add explicit language column to projects and interviews
-- Replaces per-turn/session language DETECTION (which caused mid-interview
-- language drift) with an explicit, persisted language SELECTION that is
-- authoritative across intake, brief/script generation, interview, and analysis.
--
-- Existing rows default to 'en' (safe, backward-compatible with prior hardcoded
-- English behavior) — update manually for existing Turkish-language projects
-- if needed.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "interviews" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';
