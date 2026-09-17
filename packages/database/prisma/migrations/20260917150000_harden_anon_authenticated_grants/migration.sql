-- Supabase Security Phase 2 — revoke anon/authenticated's default Supabase
-- table grants on every StayWhile `public` table, and harden `postgres`'s
-- own default privileges so a FUTURE table/sequence/function created by a
-- later migration (which always runs as `postgres`) doesn't silently
-- re-grant the same broad access. Depends on Phase 1 (this repo's prior
-- migration, 20260917140000_enable_rls_public_tables) only in the sense
-- that both are part of the same security remediation — there is no real
-- structural/ordering dependency between them (RLS state and SQL grants
-- are independent Postgres mechanisms), but they're kept as two separate,
-- explicitly ordered migrations because that's what actually happened in
-- Production: two separate approval/execution events, not one.
--
-- Deliberately does NOT touch: service_role (Supabase's own admin key,
-- meant to bypass RLS/grants by design), postgres, schema-level USAGE or
-- CREATE on public, RLS state, FORCE ROW LEVEL SECURITY, any policy, or
-- supabase_admin's own separate default-ACL entries (which govern
-- Supabase's own platform-managed objects, not ours, and are not altered
-- by `FOR ROLE postgres` below).
--
-- ⚠️ ALREADY APPLIED TO PRODUCTION manually (2026-09-17, read-only-audited
-- and explicitly approved) BEFORE this migration file existed — see
-- HANDOFF.md "Increment 107". Every statement below is idempotent (a
-- REVOKE of a privilege that's already absent, or an ALTER DEFAULT
-- PRIVILEGES REVOKE reapplied, is a safe no-op), so applying this for
-- real is harmless either way — but Production's own `_prisma_migrations`
-- history should be reconciled via `prisma migrate resolve --applied
-- 20260917150000_harden_anon_authenticated_grants` rather than a
-- redundant real re-run, once that step is separately approved. This file
-- exists so a FRESH environment (a new database, a disaster-recovery
-- rebuild, a future staging environment) inherits the same hardened
-- posture automatically via `prisma migrate deploy`.

REVOKE ALL PRIVILEGES ON TABLE
  public._prisma_migrations,
  public.ai_actions,
  public.ai_conversations,
  public.ai_messages,
  public.audit_logs,
  public.cleaning_schedules,
  public.guests,
  public.integration_connections,
  public.integration_sync_logs,
  public.maintenance_requests,
  public.message_threads,
  public.messages,
  public.notifications,
  public.notion_page_events,
  public.permissions,
  public.properties,
  public.provider_devices,
  public.reservation_guests,
  public.reservations,
  public.role_permissions,
  public.roles,
  public.smart_device_events,
  public.smart_devices,
  public.tasks,
  public.user_roles,
  public.users,
  public.workflow_executions
FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;
