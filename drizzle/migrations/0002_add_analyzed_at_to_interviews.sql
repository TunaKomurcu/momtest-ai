-- Migration: add analyzed_at column to interviews
-- This column was present in the Drizzle schema but missing from the DB table,
-- causing insert failures when creating new interviews.

ALTER TABLE "interviews" ADD COLUMN IF NOT EXISTS "analyzed_at" TIMESTAMP WITH TIME ZONE;
