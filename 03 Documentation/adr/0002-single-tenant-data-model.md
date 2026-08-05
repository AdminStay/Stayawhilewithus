# ADR-0002: Single-tenant data model

## Status

Accepted — 2026-08-04

## Context

Per `CLAUDE.md`, this workspace and platform belong exclusively to StayWhile. The platform centralizes StayWhile's own operations (properties, reservations, staff, guests) — it is not being built to be resold or white-labeled to other property managers at this time.

## Decision

The data model is single-tenant: no `organization_id`/`tenant_id` column exists on any table, and no row-level tenant scoping is applied anywhere in the schema or service layer.

## Consequences

- Every table and query is simpler — no risk of cross-tenant data leaks because there is only one tenant, and no `WHERE organization_id = ?` clause to forget.
- Authorization scoping (see ADR-0004) is by **property**, not by tenant — `UserRole.propertyId` restricts what a given staff member can see/do within StayWhile's own property portfolio, which is an orthogonal concern to multi-tenancy.
- If StayWhile ever needs to onboard other property-management companies as separate tenants on the same platform, this would require a genuine migration: adding a tenant identifier to every table, retrofitting every query and RBAC check, and deciding on a tenant-isolation strategy (shared schema with tenant column vs. schema-per-tenant vs. database-per-tenant). This is treated as a full future project, not something to design around speculatively now — doing so today would add complexity with no present benefit, contradicting "simplicity over complexity."
