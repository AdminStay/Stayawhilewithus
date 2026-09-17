-- Supabase Security Phase 1 — enable Row Level Security on every StayWhile
-- `public` table. Does NOT force RLS, does NOT create any policy, does NOT
-- touch any grant. Table owners (the `postgres` role, which Prisma
-- connects as) bypass RLS regardless — this closes anonymous/authenticated
-- Supabase-API exposure without affecting Prisma's own access.
--
-- ⚠️ ALREADY APPLIED TO PRODUCTION manually (2026-09-17, read-only-audited
-- and explicitly approved) BEFORE this migration file existed — see
-- HANDOFF.md "Increment 103". `ENABLE ROW LEVEL SECURITY` is idempotent
-- (safe to re-run on a table that already has it enabled), so applying
-- this migration for real is harmless either way, but Production's own
-- `_prisma_migrations` history should be reconciled via
-- `prisma migrate resolve --applied 20260917140000_enable_rls_public_tables`
-- rather than a redundant real re-run, once that step is separately
-- approved. This file exists now purely so a FRESH environment (a new
-- database, a disaster-recovery rebuild, a future staging environment)
-- inherits the same secure posture automatically via `prisma migrate
-- deploy`, instead of silently recreating the insecure (RLS-disabled)
-- starting state Increment 102 found.

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notion_page_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_executions ENABLE ROW LEVEL SECURITY;
