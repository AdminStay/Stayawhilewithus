-- Notion activity monitoring (N2; originally drafted 2026-09-30, re-timestamped
-- 2026-10-06 to sort after 20261003120000_add_cleaners): keep who/where from the webhook
-- and a sanitized, enriched summary. Additive only: nullable columns or
-- columns with defaults on the existing notion_page_events table (RLS and
-- grants from 20260917140000/20260917150000 already cover this table).
-- Never stores Notion property or block VALUES.
ALTER TABLE "notion_page_events"
  ADD COLUMN "authors" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "parent_type" TEXT,
  ADD COLUMN "parent_id" TEXT,
  ADD COLUMN "attempt_number" INTEGER,
  ADD COLUMN "details" JSONB,
  ADD COLUMN "enriched_at" TIMESTAMP(3);
