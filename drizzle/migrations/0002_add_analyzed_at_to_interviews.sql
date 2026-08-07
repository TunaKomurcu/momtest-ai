ALTER TABLE "interviews"
ADD COLUMN IF NOT EXISTS "analyzed_at" timestamp with time zone;
