# StayWhile Operations Platform

## Session Handoff & Continuity Log

> Update this file at the end of every development session. Read it before starting the next one. It is the project's working memory across conversations.

---

# ⚠️ Workspace Isolation — Read First

**This workspace belongs exclusively to StayWhile.** Per `CLAUDE.md`: never reference, import, reuse, or expose information from another client workspace, and never reuse StayWhile-specific code, data, or documentation in another client's project. If a future session (or the audit methodology developed here) is reused elsewhere, only the _process/template_ travels — never this workspace's actual data, credentials, architecture specifics, or file contents. No other client's workspace should ever be read from or written to during a StayWhile session, and vice versa.

---

# ⚠️ Standing Architecture Requirement — Dynamic, Dashboard-Configurable Integrations (read before touching ANY integration)

**Set 2026-08-19 by Kenny, via the user — a hard architecture requirement, not a preference.** Applies to every current and future device/data integration: August, Cielo, Nest, Honeywell/Resideo, Ecobee, and (flagged for the same treatment, not yet actioned) OwnerRez/Notion property associations.

- **Production device↔property mappings must NOT be hard-coded in source/env config.** `AUGUST_PROPERTY_MAP` and `CIELO_PROPERTY_MAP` (both real, live, currently working — see Increments 19–21) are **legacy/bootstrap behavior that needs to migrate to database-backed, dashboard-managed configuration** — they are not being ripped out today, and they are not "wrong" for having gotten August/Cielo live, but they are not the target end state and must not be extended.
- **Do NOT create `NEST_PROPERTY_MAP`, `HONEYWELL_PROPERTY_MAP`, `ECOBEE_PROPERTY_MAP`, or any similarly-shaped hard-coded env-var mapping for a new provider.** This directly supersedes Increment 27's original recommendation (§"Exact code/schema changes recommended", item 4) to extend the exact `*_PROPERTY_MAP` pattern to new providers — that recommendation is now wrong and should not be followed.
- **Target end state**: admins can, from the dashboard alone, with no code change or redeploy — discover devices a connected provider account can see, map/unmap them to properties, change an existing mapping, enable/disable an integration or an individual device, control sync settings (on/off, frequency), and see sync/error status. This is a real schema + UI body of work (likely a `SmartDeviceMapping`/config table plus admin UI), **not yet designed or built** — do not assume any of it exists.
- **Device mapping changes must be RBAC-controlled and auditable** — same standard as every other write path in this app (`assertPermission` + `recordAudit`, per `packages/auth`/`platform/audit` conventions already used everywhere else).
- **No automatic name-based device↔property matching, ever.** An admin must explicitly confirm every mapping — this is the same standing rule already in force for August/Cielo/OwnerRez/Notion (see `feedback_notion_ownerrez_read_only_safety` memory and every prior increment's mapping work), now explicitly generalized to apply to the _mechanism_ (a confirmation UI), not just to this session's manual chat-based confirmations.
- **Why provider registrations (Honeywell/Resideo developer account, Ecobee SmartBuildings request) are happening at all despite this**: they are for obtaining official, secure **API authorization** — a prerequisite to discovering devices at all, dynamically, through the provider's own API. They are explicitly **not** an indication that any device/property pairing will be hard-coded. The eventual real architecture is: provider authorization (OAuth/API key, however each provider requires it) → dynamic device discovery via that provider's API → admin reviews discovered devices in the dashboard → admin explicitly confirms each mapping → mapping is stored in the database, editable/revocable from the dashboard going forward.
- **Sequencing note**: this requirement governs the _target_ architecture. It does not retroactively block anything already live (August/Cielo keep working exactly as they do today) and does not block the in-progress provider-authorization steps for Honeywell/Ecobee (getting API access is a separate, still-needed prerequisite regardless of how mapping is eventually stored). It does mean: when real Nest/Honeywell/Ecobee sync code is eventually written, it must NOT copy the `*_PROPERTY_MAP` env-var pattern — that design conversation (schema + admin UI) needs to happen first, as its own piece of work.

See also the dedicated cross-session memory `project_dynamic_integration_config` for this requirement, and `project_thermostat_provider_expansion` for the per-provider status this interacts with.

---

# 🔖 CURRENT STATE — 2026-08-26 (READ THIS FIRST — supersedes the 2026-08-24 pivot below)

**Authoritative current state as of `## Increment 58` (2026-08-26), the latest increment in this file.** The "PRIORITY PIVOT — 2026-08-24" section immediately below is kept for history — several of the items it lists as pending are now complete. Read this summary first; where it conflicts with anything below (including that section), this summary governs. Full detail for every line below is in `## Increment 58` at the bottom of this file.

1. **OwnerRez pagination / full portfolio retrieval** — ✅ **COMPLETE, Production-verified.** Real portfolio is 58 total properties (38 active, 20 inactive); pagination and the undocumented `active=true` default are both fixed. See Increments 54/55.
2. **Notion read / listing / search** — ✅ **COMPLETE, Production-verified.** 35 real "View of Listings" records load with name/keyword/region search, strictly read-only. See Increments 53/56/57.
3. **OwnerRez Phase A — read-only match report** — ✅ **COMPLETE, Production-verified.** 0 properties linked; no Confirm/Create/Apply control exists anywhere in the deployed code. See Increment 58.
4. **Six OwnerRez candidate mappings** (Aqua Palm, Bahamas, Bonjour AMI, Island Tides, Ocean Pearl, Sandy Nudes) — **awaiting explicit human confirmation, one at a time.** Nothing linked yet. See Increment 58.
5. **Miramar Bliss** — **unresolved, genuinely ambiguous** (3 OwnerRez candidates, none preferred or defaulted). Requires stronger evidence than name similarity before any decision. See Increment 58.
6. **Phase B — one-at-a-time "Confirm Link" write capability** — **not yet enabled.** To be designed/built inside the isolated `ownerrez-property-sync` worktree only, after the six candidates above are explicitly approved.
7. **Old write-capable `ownerrez-property-sync` worktree** (commit `46c4d6e`) — **remains isolated**: not merged to `main`, not deployed, not activated.
8. **n8n, Nest, August, Cielo** — untouched, remain later priorities behind everything above.

---

# 🔖 [HISTORICAL — superseded by "CURRENT STATE — 2026-08-26" above] PRIORITY PIVOT — 2026-08-24

**New active priority, set 2026-08-24 by the client, via the user.** OwnerRez + Notion must become genuinely production-verified BEFORE any further Nest/August/Cielo work resumes. This is a business-driven reordering, not a technical blocker on the device work — the device-control pivot below (2026-08-21) is paused, not abandoned.

**Priority order from now on (expanded 2026-08-24, see `## Increment 39`'s "New standing priority order" for the full statement):**

1. **OwnerRez property source of truth** — admin-review matching page + property-sync service. **Built and committed in the isolated `worktree-ownerrez-property-sync` worktree (commit `46c4d6e`) — not merged to `main`, not deployed, no real Production match run yet.** See Increments 40/41.
2. **OwnerRez reservations** — Guest/Reservation sync
3. **Notion read/search** — query-capable search method + service + dashboard UI
4. **Notion change/deletion notifications** — polling-based diff first; webhooks only after Notion API capability is confirmed
5. **Nest** → finish verification/control
6. **August** → finish verification/control/PIN capabilities
7. **Cielo** → finish telemetry and control verification

Full audit findings for all of the above are in `## Increment 39` below. Read-only findings only — nothing has been implemented yet for OwnerRez or Notion beyond what already existed before this pivot.

**Device-work pendings, preserved exactly, resume in this order after OwnerRez+Notion reach production-verified status:**

- **Nest**: Production reads working; 33 devices discovered, all correctly Unmapped except one. **Aqua Palm - Living room** is the only device mapped/enabled (deliberate single test), showing real telemetry. **Unresolved**: a real, reproduced-in-a-fresh-incognito-session permission discrepancy — RBAC data says `ryskris0@gmail.com` has effective `thermostats:manage = YES`, but the Production UI still renders "View only — no permission to control this device" for Aqua Palm. A minimal, server-log-only diagnostic (commit `da8ac61`) is deployed and awaiting a fresh test + Vercel Function Log check — see `## Increment 38`'s "OPEN ISSUE" for the full trace and exact log-reading instructions. **No physical Nest command has ever been sent.** Do not enable any of the other 32 devices.
- **August**: Read-only monitoring is live and real (7 `SmartDevice` rows from genuine API syncs). Full capability audit complete this session (`## Increment 39`) — no lock/unlock/PIN code exists anywhere in the codebase (not stubbed, never written); PIN create/edit/delete isn't available at all in the reference library (`yalexs`) this integration is built from. The "44 locks" figure from Increment 36 was never persisted — confirmed to have come from a zero-write diagnostic script's terminal output; 37 of 44 are silently discarded on every sync because `AUGUST_PROPERTY_MAP` only lists 4 properties. No `ProviderDevice`-based discovery exists for August (unlike Nest's Phase A-D). Do not attempt any lock/unlock/PIN work until this gap is deliberately closed.
- **Cielo**: 3 real devices visible in Production (Bahamas Living Room, Island Tides Man Cave, Sandy Nudes Garage), but temperature/mode/humidity are blank for all three — `CieloClient.listDevices()` only ever returns name/online status, this is a known real gap, not yet investigated. Control is architecturally blocked regardless (WebSocket-only, no REST path, incompatible with this serverless app) — see `## Increment 37`/checkpoint below for the original finding.

---

# 🔖 Continuation Checkpoint — 2026-08-21

**Read this section before anything else in this file.** It is a self-contained snapshot of the current project state so a new session doesn't need to read all 37 increments below to continue safely. Full historical detail for anything summarized here is in `## Increment 33` through `## Increment 37`.

## ⚠️ URGENT PRIORITY PIVOT — 2026-08-21 (read this first, before the OwnerRez section below)

**Client urgently needs device controls testable — this now supersedes OwnerRez as the active work, but OwnerRez is explicitly NOT abandoned.** OwnerRez implementation is **paused at the current safe checkpoint** (audit + revised field-ownership policy complete, zero writes made, zero code beyond the `is_active`→`active` fix and its tests/README note). Do not resume OwnerRez production-write work until the client says so.

New priority order while this pivot is active:

1. **Nest → fully operational** on `/thermostats` — **corrected 2026-08-21**: Nest is NOT currently connected in any durable sense; `NestClient` is a 100% stub and the "33 devices" figure was never persisted (see device-capability audit below). Real work starts from near-zero on the client-code side, though real OAuth credentials already exist.
2. **Thermostat controls** (`/thermostats` becomes an operational control center, Cielo + Nest, provider-aware capability gating) — **Cielo control found architecturally blocked** (WebSocket-only, no REST control path, incompatible with this serverless app) — see below.
3. **Lock/PIN write capability audit + Access Codes area** for August/Yale (`/locks` stays monitoring-only; new area needed for PIN management) — **44-lock fleet, do not assume uniform capabilities across models.**
4. Everything is **audit/capability-matrix first** — no real device command (lock/unlock/setpoint/PIN create-edit-delete) until the specific provider+device-model write capability is independently verified and the client explicitly authorizes it, per the existing standing rule below.
5. OwnerRez resumes after this pass, from exactly the checkpoint recorded in "OwnerRez audit — findings" and "OwnerRez — revised field-ownership policy" below.

## Device capability audit — 2026-08-21 (read-only, nothing implemented, no device command sent)

Full detail delivered to the user in-chat as a capability matrix; condensed here for continuity. Classification: VERIFIED SUPPORTED / VERIFIED UNSUPPORTED / NEEDS AUTH OR TEST / NOT AVAILABLE.

- **Nest** (`packages/integrations/src/nest/client.ts` — 100% stub, zero test file, `NestCredentials` type shape wrong for real OAuth). Real credential names present in `.env.local`: `NEST_CLIENT_ID`/`_SECRET`/`_PROJECT_ID`/`_REFRESH_TOKEN` (Google Device Access registration + OAuth + PCM authorization already genuinely completed 2026-08-19, per Increment 31 — only the client/data layer is missing, not the Google-side setup). SDM traits confirmed via Google's official docs: `Connectivity`/`Temperature`/`Humidity`/`ThermostatHvac`/`Info`/`Settings` = read-only telemetry (VERIFIED SUPPORTED as reads, NEEDS AUTH OR TEST to confirm per-device presence); `ThermostatMode.SetMode` (HEAT/COOL/HEATCOOL/OFF), `ThermostatTemperatureSetpoint.SetHeat/SetCool/SetRange` (Celsius, blocked in Eco mode), `ThermostatEco.SetMode`, `Fan.SetTimer` = documented write commands (VERIFIED SUPPORTED at the API level, NEEDS AUTH OR TEST per actual device — **StayWhile's real 33-device trait list is completely unknown and unrecoverable**, must re-discover before any control UI ships).
- **Cielo** (`packages/integrations/src/cielo/client.ts` — real read client: login/listDevices/healthCheck/validateCredentials all genuine HTTP; only `receiveWebhook` stubbed). Control (power/temp/mode/fan): **NOT AVAILABLE** in this architecture — confirmed via the `bodyscape/cielo_home` reference integration this client is explicitly built from: every control command is dispatched over a persistent WebSocket (`wss.smartcielo.com`), no REST equivalent exists anywhere in the reference source. This is a serverless (Vercel functions) app — cannot host that connection without a separate long-running worker, a real infrastructure decision, not a coding task.
- **August/Yale** (`packages/integrations/src/august/client.ts` — real for list/detail/sync; `yale/client.ts` is a pure unused stub — "Yale" accounts actually route through `AugustClient`'s brand config, most sharing August's own API). Verified-real endpoints (reverse-engineered via the `yalexs` reference library — August has no public developer API — cross-checked against its actual source, not guessed): lock status (`GET /locks/{id}/status`, VERIFIED SUPPORTED, partially implemented already), remote lock (`POST /remoteoperate/{id}/lock`, VERIFIED SUPPORTED, **not implemented**), remote unlock (same pattern, `.../unlock`), unlatch (`.../unlatch`, device-dependent), PIN read (`GET /locks/{id}/pins` — returns full plaintext PIN + guest name, VERIFIED SUPPORTED, **not implemented**, despite this file's own earlier incorrect claim otherwise), per-device capability query (`GET /devices/capabilities?serialNumber=...`, VERIFIED SUPPORTED, **not implemented, and current types don't even model `serialNumber`**). **PIN create/edit/delete: NOT AVAILABLE** — no such endpoint exists anywhere in `yalexs`'s source (confirmed by enumerating every endpoint constant and method); would need official API access (no public program exists) or fresh reverse-engineering, both out of scope for this pass.
- **RBAC/audit infrastructure — reuse, don't reinvent**: `assertPermission(actor, key, { propertyId })` (`packages/auth/src/rbac.ts`) already supports property-scoped permission checks via `UserRole.propertyId` — exactly what "property/device ownership verification" needs, zero new security system required. Permission catalog (`packages/auth/src/permissions.ts` + `seed.ts`) uses plain string resources, no enum — adding a separate `access_codes` resource (per the client's requirement that access-code permissions be distinct from ordinary `smart_devices:*`) needs no schema migration, just a catalog + reseed update.
- **Schema**: no migration needed for thermostat capability flags (reuse `SmartDevice.metadata` JSON, same pattern already used for battery level). A real migration **is** needed only if/when PIN write capability is ever confirmed (a new `AccessCode`-style table, since no such model exists today) — **not being built now**, since no verified write endpoint exists to back it (matches the standing "no speculative provider implementation" rule).

## Nest Phases A–D — ✅ COMPLETE 2026-08-21, local dev only, nothing applied to production

**Status for a fresh session picking this up**: implementation, review-fix pass, and re-verification are all done. Everything below is real and tested. The only remaining gates before this goes live are explicitly client-approval ones, not engineering ones: (1) confirm `NEST_*` present in Vercel Production (never attempted — same Vercel-tooling limitation documented in the Vercel-status section above), (2) apply the two pending migrations to production, (3) deploy, (4) send the first real command — client has explicitly reserved approval of step 4 for a separate, later go-ahead. Do not do any of these four without the user explicitly asking.

Supersedes the "100% stub" note above — `NestClient` is now real end-to-end: OAuth refresh flow, `listDevices()`, `getDevice(id)`, 5 write commands (`setHeatSetpoint`/`setCoolSetpoint`/`setHeatCoolRange`/`setThermostatMode`/`setFanTimer`, each a documented `sdm.devices.commands.*` ExecuteCommand), all covered by mocked tests only — **no real write command has ever been sent**, per explicit instruction.

- **`ProviderDevice` staging table** (migration `20260820194930_add_provider_device`) — Discovered→Unmapped→admin-mapped→enabled flow, fully built and exercised against real data: a real local discovery run found 33 real thermostats, all correctly Unmapped, zero automatic `SmartDevice`/property-mapping creation anywhere.
- **Trait sanitization is field-level, not just trait-level** (`packages/integrations/src/nest/capabilities.ts`'s `ALLOWED_TRAIT_FIELDS`) — every field name verified against Google's own trait docs; empirically confirmed against the real 33-device account that nothing gets dropped (the allowlist exactly matches real data) and no OAuth token/secret/PII can reach persisted storage (single choke point, no bypass, verified by grep).
- **`capabilities.ts` split out of `client.ts`** — a real build-breaking bug found and fixed: importing capability-computation functions into a `"use client"` component (`NestThermostatControls.tsx`) dragged in `NestClient`'s `HttpClient`/OAuth code, which transitively pulls `node:crypto` via `core/webhook-signature.ts` — webpack can't bundle that for the browser. Fixed by moving every pure function (`sanitizeTraits`/`parseNestDevice`/`computeNestDeviceCapabilities`/`validateNestCommand`/`getSupportedNestControls`) into `capabilities.ts` (zero network/Node imports), exposed as a new package export `@stayw/integrations/nest/capabilities`. `client.ts` re-exports the same functions for server-side callers, so no existing import broke.
- **New migration** `20260820205728_add_smart_device_command_lock` — added `SmartDevice.commandInProgressAt` (nullable `DateTime`), needed for real duplicate-command prevention (durable, since this is serverless — no in-memory lock survives across invocations).

### Review-fix pass 2026-08-21 — real gaps found in client review, all fixed and re-verified

- **Locking bug fixed**: the original design checked `commandInProgressAt` from the _pre-transaction_ fetched row, not a fresh read inside the lock — a real race where two near-simultaneous requests could both pass the guard. Fixed: the advisory lock (`hashtext('device_command')`) now gates a fresh `tx.smartDevice.findUniqueOrThrow()` read-check-write, all inside the same transaction. `STALE_COMMAND_THRESHOLD_MS` raised 2min → 5min after recalculating the real worst case (now up to 4 sequential HTTP calls per command — token refresh, capability-refresh GET, command POST, confirmation GET — not 1).
- **Capability snapshot is no longer trusted stale.** Added `NestClient.getDevice(id)` (`GET /enterprises/{project}/devices/{id}`, confirmed via Google's docs). `sendNestThermostatCommand()` now calls this immediately before validating — the stored `ProviderDevice.rawMetadata` snapshot is never what gates a real command anymore, only what a _fresh_ read says right now. Also persists that fresh read back to `ProviderDevice.rawMetadata` as a side benefit.
- **No more optimistic metadata updates.** After a successful command, the service calls `getDevice()` _again_ to read Nest's actual confirmed state, and that — never a guessed "the setpoint is probably now X" value — is what's written to `SmartDevice.metadata`. `applyCommandToMetadata()` (the old guessing function) was deleted entirely.
- **Temperature validation hardened**: `validateNestCommand()` now rejects non-finite values (NaN/Infinity) and enforces Google's own documented SetRange rule ("cool value must be greater than heat value") server-side, not just at the zod/UI layer. Confirmed via Google's docs: **no min/max Celsius range or deadband is documented** — not inventing one; the only UI-facing sanity bound (40–90°F) stays at the schema boundary in Fahrenheit, the unit admins actually use, rather than duplicating a second Celsius number here.
- **Property-existence check added**: a soft-deleted property now blocks a command (`smartDevice.property?.deletedAt`), closing the "property exists" link in the ProviderDevice→SmartDevice→Property→enabled chain.
- **RBAC narrowed**: new dedicated `thermostats` permission resource (added to `packages/auth/src/permissions.ts` + `seed.ts`'s `RESOURCES`, reseeded locally — 80 permissions now, up from 75) replaces the earlier reuse of `smart_devices:manage`. Physical thermostat commands now require `thermostats:manage` specifically, so mapping/sync access (`smart_devices:update`) never implicitly grants device control, and this establishes the pattern for locks/access-codes to get their own resources later rather than sharing one bucket. Only `admin` has it (via the `*` wildcard) — not extended to any other role.
- **Audit entries now include `provider: "NEST"` explicitly**, and a fresh-capability-check rejection (stored snapshot said "supported," live read said otherwise) now gets its own `REJECTED` audit result, not silently dropped.
- **UI**: `/thermostats` unchanged in structure — `NestThermostatControls.tsx` renders only what `getSupportedNestControls()` (same function the server enforces with) says the specific device supports; verified against the real fleet's one asymmetric device ("Mahalo - Upstair": Cool/Fan only, no Heat). No client-side optimistic state anywhere — the page re-renders from the server's confirmed data via `revalidatePath` after a successful command.
- **Tests**: 400 total across both packages, all passing (107 integrations + 293 website). `nest-commands.service.test.ts` now has 21 scenarios, including the newly required ones: concurrent duplicate rejection, in-lock fresh-read duplicate rejection, stale-marker self-heal, marker cleared on both success and thrown-error paths, NaN/Infinity rejection, range-ordering rejection, stale-snapshot-vs-fresh-read divergence (two variants: capability and Eco), and confirmation that a successful command's stored metadata comes from a second real fetch, not the requested value.
- **Still open before this can go live**: Vercel Production presence of the 4 `NEST_*` vars remains **unconfirmed**. No migration has been applied to production. No real Nest command has ever been sent.

## OwnerRez — revised field-ownership policy (2026-08-21, plan-only, nothing written)

Corrects the OwnerRez audit's original "once linked, re-syncs don't touch descriptive fields" stance — client explicitly rejected that: OwnerRez must stay the **continuously synced, authoritative source** for its own factual property fields, not just a one-time import.

- **OwnerRez-owned, continuously synced, null-safe per field** (a field is only overwritten when a given pull actually returns a non-null value for it — absence in one pull leaves the existing StayWhile value untouched, never nulled): `ownerRezPropertyId`, `name`, address fields, lat/long, `bedroomCount`, `bathroomCount`, `maxOccupancy`, `propertyType` (only when the specific OwnerRez type has an explicit human-approved mapping — otherwise skipped, never forced to `OTHER` on an existing row; `OTHER` is a creation-time default only), and a **new, separate** OwnerRez active/inactive provider signal (see schema note below).
- **StayWhile/admin-owned, never overwritten by sync**: `id` (UUID), `internalCode`, `status` (`PropertyStatus`), `deletedAt`, plus region/category/device-mappings/operational-enable-disable/RBAC/admin-notes/workflow fields (none of these exist as `Property` columns today, so no live conflict).
- **Tentative resolutions for previously-open items, per client direction 2026-08-21**: `name` (not `external_name`) is the dashboard/internal name unless real-data comparison gives a reason to switch; `bathroomCount` = `bathrooms_full + bathrooms_half × 0.5`; **do not invent `timezone`** if OwnerRez doesn't actually return one for a property (leave it unset/untouched rather than guessing) — this reverses the earlier draft's assumption that timezone was safely OwnerRez-owned/synced by default.
- **This revises the earlier "no schema migration needed" conclusion.** Representing OwnerRez's active/inactive state as genuinely separate from `PropertyStatus` (client's explicit requirement — never conflate provider signal with StayWhile operational status, never auto-deactivate/delete from it) needs its own storage. Proposed, additive, nullable, not yet written:
  ```prisma
  ownerRezActive     Boolean?  @map("owner_rez_active")
  ownerRezLastSeenAt DateTime? @map("owner_rez_last_seen_at")
  ```
- **Continuous sync requires `getProperty(id)` per linked property** (not implemented yet), not just `listProperties()` — the list endpoint only has `id`/`name`/`key`/`active`; the full field set above needs the detail endpoint (`GET /properties/{id}`, confirmed via OwnerRez's own docs to return address/bedrooms/bathrooms/max_guests/time_zone/property_type/lat-long).
- Non-destructive rules unchanged: `active: false` or missing-from-a-pull → flag for review only, never auto-delete/deactivate; no name-only auto-linking; `ownerRezPropertyId` is the confirmed stable external identifier; no write-back to OwnerRez ever.
- **Still blocked on real data**: waiting on the user to paste back (1) a read-only SQL SELECT against the production `properties` table and (2) output from `packages/integrations/scripts/ownerrez-property-inventory.ts` (self-deleting, hidden-token, corrected `active` field) — neither has been received yet, so the actual bucketed match report has not been produced, and the `active` field fix has only been verified against OwnerRez's docs, not yet against a real response.

## Completed and deployed as of 2026-08-20/21

All of the following are shipped, verified (`lint`/`typecheck`/tests/`build` all green each time), and deployed to production (`stayawhilewithus-website.vercel.app`, health-checked via `/api/health` + `/sign-in` returning 200 after each deploy):

| Commit    | What                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `52890d9` | Sync Now fix: connectionId-scoped, race-safe (two-key Postgres advisory lock), stale-RUNNING self-heal, clear UI states                                                                                                                                                                                                                                                                    |
| `bc37897` | Fixed real data-loss bug: `pruneStaleDevices()` was hard-deleting `SmartDevice` rows a provider temporarily stopped returning — removed the delete entirely (both August and Cielo). Confirmed this had already deleted 2 real Cielo rows (Ocean Pearl, Miramar Bliss thermostats) before the fix landed — recovery options were reported, nothing has been restored, no decision made yet |
| `13cea96` | Fixed false-Offline classification for August locks lacking a `Bridge` object — added tri-state `UNKNOWN` to `SmartDeviceStatus` (additive migration, `ALTER TYPE ... ADD VALUE`)                                                                                                                                                                                                          |
| `8dbebae` | Exposed the read-only `/thermostats` page under Locks in the sidebar                                                                                                                                                                                                                                                                                                                       |
| `0f2ffc7` | Fixed Thermostats "Last synced" to read `updatedAt` (not `lastSeenAt`) and added a separate "Last telemetry" column, matching Locks' existing pattern                                                                                                                                                                                                                                      |

## August Locks — current state

- **44 locks discovered total: 7 original + 37 newly discovered** (Michelle added more locks to the authorized account specifically to stress-test connectivity logic against a bigger fleet).
- **Verified connectivity logic** (`deriveConnectivity()` in `packages/integrations/src/august/client.ts`): tri-state `ONLINE` / `OFFLINE` / `UNKNOWN` — `Bridge` object absent → `UNKNOWN` (never `OFFLINE`, this was the bug); `Bridge` present + no status + operative → `ONLINE`; `Bridge` present + `status.current === "online"` → `ONLINE`; else `OFFLINE`. Validated empirically against the full 44-lock fleet, not just the original 7 — **no further connectivity-logic change needed**, explicit user decision.
- **Telemetry/stale-device behavior**: `isTelemetryStale()` flags any device whose `telemetryUpdatedAt` is >24h old (threshold derived from real observed data — normal cadence is 2–4h, one genuine outlier was ~46h). Stale telemetry is its own "Attention needed" signal, separate from connectivity — never counted as Offline, never hidden.
- **New devices must NOT be manually hard-coded into `AUGUST_PROPERTY_MAP`.** All 37 newly discovered locks are deliberately left unmapped/discovered-only — no `SmartDevice` rows created for them yet. This is the standing architecture requirement (see the banner near the top of this file) — hard-coded env-var mappings are legacy/bootstrap only, not to be extended.
- **`ProviderDevice`/admin-mapping requirement**: designed extensively (staging table for discovered devices independent of `SmartDevice`, `integrationConnectionId`-scoped, `onDelete: Restrict`, admin-owned fields never touched by sync) but **not yet built**. Blocked behind OwnerRez property sync landing first — see priority order below.
- **Michelle's requirement for eventual lock access-code (PIN) management**: recorded, not started. **No unsafe lock/write controls (lock/unlock, PIN create/update/delete) should be implemented until the actual August API write capability is independently verified.** **CORRECTION 2026-08-21**: the earlier "read access to the `pins` array is confirmed" note was wrong — `client.ts` does not currently request or parse PIN data at all (confirmed by direct code audit; `smart-devices.service.ts` has an explicit comment that PIN/guest data is deliberately excluded from `metadata` even though it's adjacent in August's raw response). Full endpoint-level capability audit (lock/unlock/unlatch/pins-read/create/edit/delete, cross-referenced against the `yalexs` reference library) captured in the 2026-08-21 device-capability audit below. Standing rule, applies to every provider, not just August.

## Thermostats — current state

- `/thermostats` page + sidebar navigation (under Locks) — live, read-only, real `SmartDevice` data only, no fabricated values.
- **Cielo**: real HTTP client, returns `{id, name, online}` only — no temperature/target/mode/humidity/telemetry-timestamp data available from this provider today. Fields the UI can't get from Cielo honestly render "—", never invented.
- **Timestamp fix shipped** (`0f2ffc7`, see table above).
- **Honeywell/Resideo**: developer/API registration submitted, **awaiting approval** — external blocker, not a coding task right now.
- **Ecobee SmartBuildings**: registration/API access **pending** — external blocker (account/API approval, possibly payment), not a coding task right now.
- **Nest**: ~~connected~~ **CORRECTION 2026-08-21 — this was wrong.** `packages/integrations/src/nest/client.ts` is a 100% structural stub (every method throws `NotImplementedError`), confirmed by direct code audit. The "33 devices discovered" result came from a one-off, uncommitted script (`apps/website/_tmp-nest-oauth-discover.mjs`, confirmed deleted) that bypassed `NestClient` entirely and was **never persisted anywhere** — zero `SmartDevice` rows, zero saved trait data. Real OAuth credentials (`NEST_CLIENT_ID`/`_SECRET`/`_PROJECT_ID`/`_REFRESH_TOKEN`) are genuinely present in `.env.local` (names confirmed, values not read), so the Google-side registration work is real and durable — only the client code and device data are not. `NestCredentials` in `types.ts` is also the wrong shape (`{apiKey}` instead of the real 4-value OAuth set). Full SDM trait/command table (from Google's official docs) captured in the 2026-08-21 device-capability audit below.
- **Eventual thermostat management/control** (setpoint changes, mode changes): recorded as a future requirement — **audit completed 2026-08-21** (see device-capability-audit section below), implementation not started, gated behind the safety checklist there.
- **Cielo control — architecturally blocked, not just unimplemented (found 2026-08-21)**: Cielo's only real control surface (power/temp/mode/fan) is a persistent WebSocket (`wss.smartcielo.com`, confirmed via the `bodyscape/cielo_home` reference integration this client is built from) — no REST equivalent exists. This app is serverless (Vercel functions), which can't host a persistent WS connection. Enabling Cielo control needs a separate infrastructure decision (e.g. a long-running worker), not just a new client method.

## OwnerRez audit — findings (Increment 37, read-only, nothing implemented)

- **Real integration confirmed**: `OwnerrezClient` makes genuine HTTP calls (Basic Auth) for `connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`/`listProperties`/`listBookings`/`getGuest`/`sync("INBOUND")`. Only `receiveWebhook()` is stubbed (undocumented payload shape).
- **20 active properties** confirmed live against the real account (checked 2026-08-20, single page, no pagination needed).
- **Endpoints implemented**: `GET /properties`, `GET /bookings` (+ `since_utc`), `GET /guests/{id}`.
- **Bookings currently reach the dashboard** (5-item read-only "upcoming" preview) — **property data does not reach the dashboard at all**. Nothing OwnerRez-sourced is ever written to the database.
- **`Property.ownerRezPropertyId` already exists in the schema and is completely unused** — zero reads or writes anywhere in the codebase outside its own definition.
- **No schema/migration is currently required** — that column is ready to receive confirmed mappings as-is.
- **Matching findings**: OwnerRez's real field set (`id`, `key`, `internal_code`, `name`, full address, `bedrooms`, `bathrooms*`, `max_guests`, `property_type`, `time_zone`, lat/long, etc.) maps closely to StayWhile's `Property` model. Checked against the **local dev DB only** (no production DB connection this session): of 7 real (non-demo) local `Property` rows, only 2 are exact name/internal_code matches (Ocean Pearl, Bonjour AMI), 1 is close-but-not-exact (Miramar Bliss), 4 have no OwnerRez counterpart at all — **17 of the 20 real OwnerRez properties have no matching StayWhile row in local dev.** This is exactly why matching must stay human-confirmed, never automatic.
- **No automatic matching or writes have been performed** — this was audit-only. No `ownerRezPropertyId` value has been set on any row.
- **Intended end state**: OwnerRez becomes the **authoritative read-only property source** for the dashboard — StayWhile never writes back to OwnerRez, properties are no longer created one-by-one by hand once this lands.

## Vercel status

- **OwnerRez Production credentials still need verification** — whether `OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` exist (names only, never values) in Vercel Production is **unconfirmed**.
- **Vercel CLI authorization/isolation issue, unresolved**: this session's Vercel CLI has no stored auth token (`~/Library/Application Support/com.vercel.cli/config.json` has no `token` key) and no `.vercel/project.json` is linked in this repo. Every attempt to run `vercel whoami`/`vercel env ls` hangs on an interactive browser login that could not be completed from this session — genuinely blocked, not yet resolved.
- **2026-08-21 — OwnerRez Production credentials confirmed PRESENT.** User added `OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` (rotated token) to Vercel Production directly via the dashboard and redeployed. A read-only diagnostic script (`packages/integrations/scripts/ownerrez-prod-check.ts`, prompted interactively for credentials, self-deleted after a successful run) confirmed: credentials valid, 20 real properties returned. **Bug found and fixed**: `OwnerrezProperty.is_active` was wrong — the real field is `active` (confirmed via OwnerRez's own OpenAPI spec `active` query filter + the `active` field on the sibling `listing_sites` resource, and empirically: `is_active` deserialized to `undefined` on every real property). Fixed in `types.ts`/`client.test.ts`/`README.md`. Also confirmed via OwnerRez docs: `GET /properties/{id}` (not yet implemented in `client.ts`) returns much richer data than the list endpoint — address, bedrooms, bathrooms, max_guests, time_zone, property_type — useful for prefilling new-property creation later.
- **OwnerRez property-portfolio-sync implementation plan proposed 2026-08-21, not yet built, no user approval to write yet**: no schema migration needed (`Property.ownerRezPropertyId` unique nullable column, `PropertyStatus.ONBOARDING`, `IntegrationProvider.OWNERREZ` all already exist). Plan: live-computed (no staging table) 5-bucket comparison (already-linked / exact match / possible match / OwnerRez-only / StayWhile-only) surfaced on a new admin-only `/integrations/ownerrez/properties` page; every link/create action explicit, `assertPermission`+`recordAudit`-gated, new properties created at `ONBOARDING` status (never auto-`ACTIVE`), never auto-deletes/deactivates a StayWhile row from a single OwnerRez pull. New files planned: `ownerrez-property-matching.service.ts`, new schemas, new actions, `OwnerRezPropertyMatchReview.tsx`, new route — none written yet. Waiting on the user to paste back (1) a read-only SQL SELECT against the production `properties` table (Supabase SQL editor) and (2) output from `packages/integrations/scripts/ownerrez-property-inventory.ts` (same self-deleting/hidden-token pattern) before the real match report can be produced.
- **2026-08-21 re-check (still unresolved, static file inspection only, no CLI/network calls)**: confirmed again — no `.vercel/` directory or `vercel.json` anywhere in the repo, no `.vercel` entry in `.gitignore`, and `~/Library/Application Support/com.vercel.cli/config.json` still holds only a telemetry flag (no `token`/`team` key). The **project name** this repo must link to (`stayawhilewithus-website`) is documented here, but the **Vercel team/account (org) name is not recorded anywhere locally** — it has never been written down in this repo or in the local CLI config. A user-initiated `vercel login` in a separate terminal this session did not help: the Claude Code Bash tool runs in a sandbox that cannot read the macOS Keychain entry Vercel CLI 58 stores the session in (a `security find-generic-password` lookup was denied by the sandbox classifier), so CLI identity cannot currently be confirmed from inside a Claude Code session at all — either the user must run `vercel whoami`/`vercel project ls`/`vercel env ls production` themselves and paste output back, or supply a team-scoped `VERCEL_TOKEN` some other way. **Before any link/login is attempted, the user must also state the exact Vercel team/account name that owns `stayawhilewithus-website`**, since nothing local can confirm it.
- **⚠️ IMPORTANT — this machine is used for multiple clients.** StayWhile's Vercel account/project must remain strictly isolated from every other client's Vercel account/project.
  - **Never inspect, link, modify, deploy, or access another client's Vercel project while working in this repo.**
  - **Before using the Vercel CLI for anything**, verify (1) which account/team it's authenticated to, and (2) that the linked project is specifically `stayawhilewithus-website` — **in that order, before any other Vercel command runs.**
  - Once (1) and (2) are both confirmed, only check environment variable **names** (never values) — never modify a variable, never deploy, as part of this check.

## Second client meeting — priorities (preserved as explicit client requirements)

- **Homepage**: August lock summary (connectivity + low battery front and center), thermostat status summary, daily check-ins/check-outs, Rescheduled Cleanings moved higher up alongside the morning operational items (already shipped, see commit `086c577`). **ADR and Revenue stay in the sidebar and OFF the homepage for now.**
- **Fully connect OwnerRez** — real property portfolio → StayWhile database/dashboard (see plan below).
- **Fully connect Notion**:
  - Dashboard keyword search of authorized Notion content, real results only, no demo data.
  - Surface/use Notion information through the dashboard (not just "Connected" status).
  - Automated monthly Notion backup (currently done manually by the team) — needs design: what's backed up, where it's stored, timestamp/version naming, retention, failure reporting, how the schedule runs while n8n availability is unresolved.
  - Notify/flag when relevant Notion pages are altered, archived, or deleted — **verify actual Notion API capability first**, don't promise real-time events the API doesn't support.

## Pending provider/API blockers (external, not coding tasks)

- **Honeywell/Resideo**: developer/API registration awaiting approval.
- **Ecobee SmartBuildings**: registration/API process awaiting verification/approval (possibly payment).
- **August**: account now exposes the expanded 44-lock inventory — no blocker, just more data to eventually map.
- **n8n**: remains a separate background-automation issue (availability unresolved) — **must not block direct dashboard integrations** (OwnerRez, Notion) which don't depend on it.

## Exact next priority order (superseded 2026-08-21 — see URGENT PRIORITY PIVOT at the top of this checkpoint)

**This list is paused, not discarded** — resume from step 2 once the device-control pivot above is done and the client says to continue.

1. ~~Safely verify OwnerRez environment-variable presence in Vercel Production~~ — **done 2026-08-21**, see OwnerRez section above.
2. **Implement the approved OwnerRez property integration**: real provider data, explicit admin-reviewed mapping UI, no guessed matches, preserve existing `Property` IDs where a match is explicitly confirmed, prevent duplicates, surface unmatched properties (both directions) for admin review, continuously synced per the revised field-ownership policy above. Read-only against OwnerRez — never write back to it. **Currently blocked on real data (see OwnerRez section) and now also paused behind the device-control pivot.**
3. **Fully connect Notion** per the second-meeting requirements above.
4. **`ProviderDevice`/admin-mapping** for discovered devices (the 37 unmapped August locks, the 33 discovered Nest thermostats) and remaining smart-device work — **this overlaps directly with the device-control pivot's Nest/lock work; check for duplicate effort before building `ProviderDevice` twice.**
5. Continue remaining second-meeting dashboard priorities afterward.

## Uncommitted worktree state (as of 2026-08-21)

Run `git status` to confirm current state before doing anything. As of this checkpoint:

- **This session's own work**: `HANDOFF.md` (this checkpoint) — everything else this session touched (`ThermostatsList.tsx`, the Sync Now / data-loss / UNKNOWN-status / Thermostats-exposure work) is already committed and pushed (see commit table above).
- **Pre-existing, NOT from this session, do not assume it's related to current work**: `.gitignore`, `apps/website/app/(dashboard)/layout.tsx`, `apps/website/app/(dashboard)/users/page.tsx`, `apps/website/src/domains/users/*` (README, actions, UserList, schema, service + test), `apps/website/src/platform/auth/get-current-user.{ts,test.ts}`, `apps/website/src/platform/identity/sync-clerk-user.{ts,test.ts}`, `apps/website/src/platform/errors.ts`, `apps/website/src/platform/layout/nav-config.ts`, `packages/integrations/src/notion/README.md`, `packages/integrations/src/ownerrez/README.md`, `packages/ui/src/components/Sidebar.tsx` — plus untracked new files: `apps/website/src/domains/users/components/{InviteTeamMemberForm,PendingInvitationsList,RolePermissionsList}.tsx`, `apps/website/src/platform/identity/invite-clerk-user.{ts,test.ts}`. This looks like in-progress team-invite/roles UI work from an earlier session — **do not commit, discard, or build on top of it without first asking the user what state it's in.**

## Standing do-not-do rules (apply across every future session)

- **No guessed property/device mappings, ever** — every mapping requires explicit admin confirmation, no name-based or address-based inference no matter how obvious it looks.
- **No fake/demo data presented as production data** — if a field isn't available from a real provider, show a neutral placeholder ("—"), never invent a value.
- **No hard-coding newly discovered devices** into any `*_PROPERTY_MAP`-style env var — that pattern is legacy/bootstrap only and must not be extended.
- **No secret values in the repo or in HANDOFF.md** — env var names only, never values, never in any doc or commit.
- **No production writes (database or provider) unless explicitly approved** — read-only by default for all new integration work.
- **No cross-client account access** — this machine holds multiple clients' credentials/Vercel accounts; verify StayWhile identity before every Vercel action, never touch another client's project.
- **No device-control actions** (lock/unlock, PIN management, thermostat setpoint/mode changes) **until the specific provider's write capability is independently verified and explicitly authorized** — read-only for all providers until further notice.

---

# Project Status

## Current Phase

Phase 1 (Architecture & Foundation) is functionally complete. The same-phase **architectural refinement** (Domain-Driven Design reorganization + AI platform layer + Integration SDK) is now **✅ fully complete** as of the 2026-08-06 session — see "AI Platform Layer & Refinement Completion" below. The **technology/integration audit** remains explicitly deprioritized (not cancelled) per the user's earlier instruction. **n8n MCP connection** is connected, verified working, and the instance has been inspected (empty, safe to build on).

**Status:** The paused refinement work is done, verified (`lint typecheck test build` all green), and fully committed to git (local `main`, not pushed) — five commits total from the 2026-08-06 session covering tooling/config, original app code, original docs, the refinement completion code, and the refinement completion docs. Nothing is uncommitted as of end of session. Ready to move to the next priority: credential setup, n8n workflow building, or OwnerRez integration, per user direction.

### Update — 2026-08-06, later same-day session

The above remains accurate as a historical record of that session's end state. Since then, in a **new session**:

- **Increment 1** of `IMPLEMENTATION_PLAN.md` (core ops domains: Properties → Guests → Reservations → Tasks → Cleaning → Maintenance → Notifications → Communications → Dashboard) is now the active phase, superseding "next priority: credential setup, n8n workflow building, or OwnerRez integration" above — the user redirected to this instead. Properties, Guests, Reservations were already done; **Tasks domain shipped this session** (see "Increment 1 Progress" below).
- **n8n MCP connection is no longer live** as of this session — see the dated update under "n8n MCP Connection" below. The "connected, verified working" status above was accurate for the 2026-08-06 morning session; it no longer holds and must be re-checked every session, not assumed from this doc.
- New, previously-undocumented MCP connections (`Slack`, `Asana`, `IFTTT`) were observed this session — see "MCP Connections — 2026-08-06 later session" below.

### Update — 2026-08-07 session

A full new session. User set a mandatory **Continuous Build Mode**: keep implementing without stopping for permission as long as unblocked work exists; credential absence only blocks the literal API-call boundary, not the surrounding UI/service/schema/db/test layers; only stop for a credential that can't be mocked, a login, spending money, a destructive production action, or a genuine safety/design blocker. Also established durable infra-isolation, reuse-before-create, and connection-verification-order policies (all saved to this assistant's cross-session memory, not just this doc).

**Increment 1 — now fully complete** (all 9 domains: Properties, Guests, Reservations, Tasks, Cleaning, Maintenance, Notifications, Communications, Dashboard).

**Increment 1.5 — all 7 previously-deferred extensions shipped**: task reassignment, cleaning cancel/missed, maintenance task-linking/assignment, communications thread close/archive, guest update/soft-delete, reservation status updates, property status update/soft-delete.

**Increment 2 — 5 real, credential-gated adapters built** (actual SDK/API calls behind each provider's interface, safely no-op without a credential, not stubs): `AnthropicClaudeClient` (`@anthropic-ai/sdk`), `OwnerrezClient` (v2 REST, Basic Auth), `SlackClient` (Web API + real `v0=` webhook signature verification), `NotionClient`, `AsanaClient`. 7 more integrations were deliberately left as documented stubs, each with its own specific reason in its package README (not silently skipped) — Gmail/Ecobee need an OAuth token-storage design; Nest requires a mandatory $5 Google registration fee; Google Voice has no public API at all (flagged as a likely scope error in the original plan, worth a decision from the user); Yale/August/Cielo are physical lock/HVAC control where this session's confidence in the current exact API contract was too low to risk fabricating device-control code.

**Increment 3 — Dashboard finish + 3 new domains**: AI domain (`/ai` — ops-assistant conversation UI + AI-action approval queue, built fully end-to-end even without `ANTHROPIC_API_KEY`: a real `SYSTEM`-role message persists explaining the gap instead of a 500), Integrations domain (`/integrations` — connection-status catalog for all 12 providers, idempotently seeds `IntegrationConnection` rows since none existed before, deliberately no "test connection" button since that would mean an unauthenticated live network call), Audit domain (`/audit` — audit log + `WorkflowExecution`/"automations" history, since no domain in the original 13-domain DDD inventory owns that model).

**Increment 4 — `@stayw/ai` platform completion**: user directed finishing the entire AI platform package as production-ready infrastructure (not placeholders) while still crediential-blocked. Shipped: structured logging (`logging/`, console default limited to `warn`/`error` per this repo's lint policy), retries with exponential backoff (`orchestrator/retry.ts`, deliberately excludes `NotImplementedError` — see the bug note below), real streaming (`completeStream()` on `AnthropicClaudeClient`, not yet wired into the Next.js UI), short-term memory/conversation windowing (`memory/window.ts`), a real multi-step agentic tool-use loop replacing the old single-completion `runOrchestratorTurn` (executes tools via the Tool Registry including its approval gate, loops to a safety cap, stops early on pending-approval or the cap), an evaluation framework (`evaluation/` — runs against any `ClaudeClient` including test doubles), and human handoff (`handoff/escalate.ts`, wired into the AI domain both automatically on hitting the loop's iteration cap and manually via a new "Escalate to human" button). `ClaudeClient.complete()`'s return type changed from a bare string to structured content blocks + stop reason (a deliberate breaking change, safe since only this session's own code depended on the old shape). `sendAiMessage` now actually passes tools into the loop, which is what finally makes `registerPropertiesAiTools()` get called for real (previously defined but never invoked from anywhere).

**Real bug found by the test suite's timing, not by inspection**: the first retry-wrapped version of the Claude call retried `NotImplementedError` (missing API key) three times with backoff — ~750ms wasted per call for an error that could never resolve itself. Fixed by excluding it from the retry predicate.

**Verification**: full monorepo `lint typecheck test build` forced fresh (`turbo run ... --force`, no cache) after every single feature landed across this entire session, not just at the end — always 0 errors. Final count: **211 tests** across the monorepo (`website` 99, `@stayw/ai` 67, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 5 — `@stayw/ai` modularization (supersedes the class names in Increment 4's paragraph above)**: user pushed back on the Orchestrator containing business logic and on the Claude-branded interface — a real gap, not just a preference. `orchestrator/run-turn.ts` became `orchestrator/orchestrator.ts`, now a genuinely thin coordinator: it sequences Context Builder → Prompt Management → Conversation Management → Memory Management → a retry-wrapped Model Provider call → **Planner** → Tool Execution Engine (if needed) → Planner again → loop or return, with every decision point delegated to a named module instead of living as inline conditionals. New `planner/` module (`planNextStep`/`planAfterToolExecution`/`planEscalation`) — pure decision logic, no I/O. `tools/registry.ts` (pure catalog) split from a new `tools/execution-engine.ts` (runs a tool + enforces the approval gate) — the registry alone can no longer be mistaken for something that can execute. All Claude-branded types moved to a new `provider/` module and renamed to be provider-agnostic: `ClaudeClient` → `ModelProvider`, `ClaudeMessage`/`ClaudeContentBlock`/`ClaudeCompletionInput`/`ClaudeCompletionResult`/`ClaudeStopReason`/`ClaudeStreamEvent` → `ModelMessage`/`ModelContentBlock`/`CompletionInput`/`CompletionResult`/`StopReason`/`StreamEvent`, `AnthropicClaudeClient` → `ClaudeProviderAdapter`, `NotImplementedClaudeClient` → `NotConfiguredModelProvider`, `createClaudeClient` → `createModelProvider`. `provider/claude-provider.ts` is now the **only** file in the package that knows Anthropic's actual request/response shape — a second vendor means one new adapter file, not a platform rewrite. New telemetry module (`logging/telemetry.ts` — opt-in counters/durations, `createTelemetry`/`timed()`) fills out "Logging & Telemetry" as one explicit responsibility. `apps/website` needed **zero** changes — confirmed by grepping for `Claude` across it before starting; it only ever consumed function-level exports, never the renamed types. Same test scenarios still pass, now split between `orchestrator/orchestrator.test.ts` (end-to-end coordination) and `planner/planner.test.ts` (decision logic in isolation) — this was a structural refactor, not a behavior change. Full monorepo verification forced fresh again — 25/25 tasks, 0 errors, **229 tests** total (`website` 99, `@stayw/ai` 85, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 6 — `@stayw/ai` provider architecture completion**: user asked to finish the provider architecture before any further features — "a reusable AI runtime, not a Claude wrapper," with every vendor-specific implementation confined to `provider/` and everything else depending only on `ModelProvider`. Audited first (grepped the whole package for `claude`/`anthropic`/`@anthropic-ai/sdk`) rather than assuming more work was needed: Increment 5's rename had already confined all real vendor code correctly — the only leaks were prose comments (now scrubbed) and one test's sample model-name string. The actual gap was that `createModelProvider()` was a hardcoded two-branch function, not a real selection mechanism. Fixed with `provider/registry.ts` (`registerModelProviderFactory`/`getModelProviderFactory`/`listModelProviderFactories`), mirroring the Tool Registry/Prompt Management registry pattern already used elsewhere in this same package. `claude-provider.ts` now self-registers (`{ name: "claude", isConfigured, create }`) and is the only file reading `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`; `create-provider.ts` no longer imports `ClaudeProviderAdapter` at all — it selects purely by name via `AI_MODEL_PROVIDER` (new env var, defaults to `"claude"`, added to `.env.example`). Verified with a test that registers a fake `"test-vendor"` factory and confirms selection works without any Claude-specific code path. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **235 tests** total (`website` 99, `@stayw/ai` 91, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 7 — `@stayw/ai` provider subsystem finished, then a deliberate stop to architecture work**: user asked for the provider subsystem to be completed as a whole unit (interfaces, registry, factory, adapters, tests, exports, docs) and then explicitly to stop refactoring `@stayw/ai` and resume feature work unless a real limitation turns up. The gap: Increment 6's registry had exactly one adapter (Claude) registered through it, which doesn't actually prove `ModelProvider` generalizes — it could still have been Claude-shaped underneath a generic name and nobody would know. Added a second real adapter, `provider/openai-provider.ts`'s `OpenAiProviderAdapter` (official `openai` SDK), specifically because OpenAI's tool-calling shape is structurally different from Anthropic's (separate `tool_calls` array + separate `role:"tool"` messages, vs. Anthropic's mixed content blocks in one message) — getting both to map cleanly onto `ModelContentBlock[]` is the actual proof, not just another renamed adapter. Checked first that no OpenAI credential exists anywhere in the repo (reuse-before-create policy) before adding the dependency — writing the adapter needs no account, just won't run without `OPENAI_API_KEY`. `create-provider.ts` gained one `import "./openai-provider";` line and otherwise didn't change — still zero vendor class references in the selection logic. `index.ts` now exports the registry functions and `ModelProviderFactory` type too (previously registry-internal). 14 new tests (11 adapter + 3 multi-provider-coexistence). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **249 tests** total (`website` 99, `@stayw/ai` 105, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**This closes the `@stayw/ai` architecture phase per explicit user instruction.** The provider subsystem is now production-ready: `ModelProvider` interface, `provider/registry.ts`, `createModelProvider()` factory, two real adapters (Claude + OpenAI) plus the `NotConfiguredModelProvider` fallback, 34 provider-level tests, full exports, and `packages/ai/README.md` documents all of it under a "Provider subsystem" section. Next `@stayw/ai` session should default to feature work (Context Engine providers, streaming wired into the Next.js UI, Knowledge Retrieval's vector store, a third provider only if a concrete need shows up) — not more restructuring.

**Increment 8 — correction: Increment 7 overstepped, OpenAI adapter removed, Claude finished instead**: user corrected directly — "Do not implement additional model providers solely to prove the abstraction... only implement providers that are currently required by the StayWhile platform... Favor shipping the StayWhile platform over demonstrating architectural extensibility." Building a real `OpenAiProviderAdapter` to validate the registry pattern was the wrong move regardless of how well-executed it was; StayWhile doesn't use OpenAI. Deleted `provider/openai-provider.ts` + its test, removed the `openai` SDK dependency, reverted `create-provider.ts`/`index.ts`/`.env.example` to Claude-only. Replaced the "two real vendors coexist" test suite with an equivalent that registers **fake** in-test factories instead of asserting against a real second vendor — proves the same registry dispatch mechanism without shipping unused vendor code, which is the actually-correct way to demonstrate extensibility (also true of Increment 6's original fake-`"test-vendor"` tests, which already proved this before Increment 7 added a real second vendor at all). Saved a standing memory (`feedback_no_speculative_provider_implementations`) so this class of overstep doesn't recur — distinct from the adjacent, still-valid principle that _currently-required_ credential-gated integrations (OwnerRez, Slack, etc. from earlier increments) should still get real adapters built ahead of the credential.

Used the correction as the occasion to actually finish the Claude adapter rather than just reverting: `maxTokens` is now configurable (constructor option + `ANTHROPIC_MAX_TOKENS` env var, default raised from 1024 to a more realistic 4096 for ops-assistant replies), and both `complete()`/`completeStream()` now log (`logger.error`) and rethrow on API failure instead of failing with zero observability. 4 new tests for that. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **242 tests** total (`website` 99, `@stayw/ai` 98, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 9 — AI runtime feature work: real tools for guests, reservations, tasks, cleaning**: user declared the provider layer "stable" (Claude provider, registry, factory, tests, docs all complete — 5 explicit criteria) and directed a stop to further `provider/` work absent a real new requirement, with an instruction to resume higher-level AI runtime feature work immediately. Re-verified rather than assuming: reran `packages/ai`'s provider test suite fresh (24/24 passing) and `tsc --noEmit` (clean) before treating the layer as frozen; updated the standing `feedback_no_speculative_provider_implementations` memory to record this as a durable instruction. Picked the next slice from `@stayw/ai/README.md`'s own "not built yet" list rather than inventing new scope: the ops-assistant conversation could only ever call one tool, `properties.list` — `CONVERSATION_TOOL_NAMES` in `apps/website/src/domains/ai/services/ai.service.ts` had exactly one entry. Extended the same proven pattern (`domains/properties/ai-tools.ts`) to the other four Increment-1 domains: new `domains/guests/ai-tools.ts` (`guests.list`), `domains/reservations/ai-tools.ts` (`reservations.list`), `domains/tasks/ai-tools.ts` (`tasks.list`), `domains/cleaning/ai-tools.ts` (`cleaning.list`) — each a thin, read-only (`requiresApproval: false`) wrapper around that domain's existing `list*(actor)` service call, identical shape to the Properties original, plus a matching `ai-tools.test.ts` for each (8 new tests). `ai.service.ts` now registers all 5 domains' tools at module load and passes all 5 names into the orchestrator loop; `ai.service.test.ts` gained mocks for the 4 new domain boundaries. `domains/ai/README.md` updated to describe all 5 tools and the "how to add a sixth" recipe. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **250 tests** total (`website` 107, `@stayw/ai` 98, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 10 — AI Assistant fully wired into the application**: user set a hard split — product features only from here, no more AI architecture, with a concrete priority list: finish tool registration for every domain, expose real business operations, then wire the AI Assistant page (orchestrator connection, tool calls, persistence, tool execution history, streaming, approval flow) before touching OwnerRez or n8n. Shipped:

- **17 tools across 9 domains** (was 5 tools/5 domains): every domain from Increment 1 now has a `domains/<domain>/ai-tools.ts`. Read tools (`requiresApproval: false`) for everything; write tools (`requiresApproval: true`) for the 7 domains where a real single-argument mutation exists (`properties.updateStatus`, `guests.update`, `reservations.updateStatus`, `tasks.complete`, `cleaning.complete`, `communications.sendMessage`, `maintenance.resolve`). Integrations and audit deliberately stayed read-only — connecting/disconnecting an integration is an infra action, and the audit log is append-only.
- **Closed a real, previously-undetected gap**: approving an `AiAction` only ever flipped its status to `APPROVED` — `markActionExecuted`/`markActionFailed` had existed in `@stayw/ai` since Increment 4/5 with **zero callers anywhere in the app**. `approveAiAction` now actually looks the tool up (`getTool`) and runs its handler with the approving human's identity, transitioning to `EXECUTED`/`EXECUTION_FAILED` and auditing either outcome. Without this, the approval queue this session just gave the assistant 7 new write tools for would have been decorative.
- **Tool execution history now persists and renders**: `AiMessage.toolCalls` (a `Json?` schema column) existed but the orchestrator never wrote to it. One additive change to `orchestrator.ts` (both `appendMessage` calls for the assistant's reply now attach `{ calls: allToolCalls }`) plus a `ConversationView` rendering pass — no orchestrator control-flow change.
- **Streaming, scoped honestly**: new `app/api/ai/messages/route.ts` + `ChatComposer.tsx` client component stream the real, already-computed final answer in chunks. This is explicitly _not_ token-level generation from Claude — that needs `StreamEvent` to carry `tool_use` blocks, which it doesn't yet, and extending it is a provider-layer change this session isn't making (provider layer stays frozen per the prior increment's standing instruction). Documented clearly in both `packages/ai/README.md` and the domain README so this isn't mistaken for real model streaming later.
- 33 new/changed tests (2 in `@stayw/ai`, 31 in `website`).

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **276 tests** total (`website` 132, `@stayw/ai` 99, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4). `next build` succeeded including the new API route (static generation of all 19 routes). Interactive browser check of `/ai` wasn't possible — `next dev` 404s on every dashboard route right now, including untouched ones (`/properties`, `/`) — confirmed pre-existing (Clerk placeholder keys in this dev environment), not a regression from this session's work.

**Increment 11 — closed a real gap in approval execution, added a genuine end-to-end test**: user asked to complete the AI Assistant vertical slice in order (register tools → persist tool calls → complete approval workflow → **execute approved tools through the orchestrator** → stream → verify end-to-end), explicitly deprioritizing "just register more tools." Auditing item 4 against Increment 10 found `approveAiAction` was calling `getTool()` + `tool.handler()` directly — bypassing the Tool Execution Engine's own stated invariant that it's "the only path allowed to actually run a tool handler." Fixed with one small, justified addition: `executeApprovedTool()` in `tools/execution-engine.ts` (same registry lookup + Zod validation as `executeTool`, skips straight to the handler — `executeTool` itself can't be reused post-approval, it would just propose a second `AiAction`). `approveAiAction` now calls this instead. Added the genuine end-to-end test the user asked for: `packages/ai/src/orchestrator/orchestrator.e2e.test.ts` runs the real Orchestrator, Planner, Tool Registry, Tool Execution Engine, and Action Approval Framework together (only `@stayw/database` mocked) through one full prompt → tool selection → pending-approval → approve → execute → persisted-history chain, plus the no-approval-needed path in the same file. 5 more tests beyond that (`executeApprovedTool` coverage, updated `approveAiAction` mocks). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **281 tests** total (`website` 132, `@stayw/ai` 104, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

Earlier in this session, user also asked to verify no cross-client contamination had occurred (unfamiliar project name "Vuvuzela" mentioned) — verified for real (grepped the whole tree, zero hits; confirmed `package.json` name and every `@stayw/*` workspace package) and confirmed clean: everything in this repo is StayWhile's own work.

**Increment 12 — closed the response loop, resolved-actions view, streamed tool events**: user's next priority list after green tests — persist tool calls/results, stream intermediate tool events, complete the approval UX, verify the full prompt → approval → execution → response cycle, and explicitly hold off on more tools until this works end to end. The real gap this surfaced: execution (Increment 11) worked, but nothing ever reported the outcome back into the conversation an action came from — approving something in the queue gave no visible confirmation in the thread itself, only an audit-log row nobody would normally look at. Fixed:

- `approveAiAction`/`rejectAiAction` now `appendMessage` a `SYSTEM` note into the action's conversation on every outcome — executed (with the real result, same `{ calls: [...] }` shape the Orchestrator writes, so it renders through the existing tool-call UI for free), execution failed (with the real error), or rejected (with the reason). Skipped when `AiAction.conversationId` is null rather than guessed.
- New `listRecentResolvedActions` (`@stayw/ai`) / `listRecentAiActions` (domain) / `RecentActionsList` (UI) — `PendingActionsList` only ever shows `PENDING` rows, so a resolved action previously just vanished with zero confirmation anywhere on the page. Now the last 20 resolved actions show their real outcome.
- `sendAiMessage` now returns `toolCalls` (always computed, just wasn't returned), and `app/api/ai/messages/route.ts` streams one `tool_call` SSE event per call _before_ the text chunks; `ChatComposer` renders each as it arrives. Same honesty standard as the Increment 10 text streaming: real, already-computed events sequenced for delivery, not live generation — documented in the route's comment, still blocked on `StreamEvent` not carrying `tool_use` blocks for anything closer to true interleaved streaming (a provider-layer change deliberately not made).
- Website-level "full cycle" test chaining `sendAiMessage` → `approveAiAction` in one test, alongside the package-level `orchestrator.e2e.test.ts` from Increment 11 — both ends of the stack now have an explicit end-to-end proof, not just per-function unit tests.

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **287 tests** total (`website` 136, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 13 — client-readiness verification surfaced a real bug, not just missing credentials**: user asked for a Client Readiness Verification with evidence. Investigated directly rather than assuming: decoded `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (base64 → `placeholder.clerk.accounts.dev$`, not a real Clerk domain), confirmed `CLERK_SECRET_KEY` contains the literal string `placeholder_not_real_do_not_use`, and queried the local dev database directly with `psql` for real row counts. That surfaced a genuine bug: `packages/database/prisma/seed.ts` creates the bootstrap admin `User` row with a placeholder `clerkUserId` (`seed_pending_clerk_link`); `User.email` is `@unique`; and `getCurrentUser()`'s JIT-provisioning path only ever checked for an existing row by `clerkUserId`, never by `email` — so the moment real Clerk keys are configured, the _first_ real sign-in for `admin@stayawhilewithus.com` would crash on a unique-constraint violation instead of linking to the seeded admin role. Fixed by having JIT-provisioning check for an existing row by email first and _claim_ it (update its `clerkUserId`) rather than blindly creating a second row — the seeded row's `UserRole` assignments carry over automatically since it's the same row (5 new tests, `get-current-user.test.ts`, previously untested). Also added demo business data to the seed (`seedDemoData()` — 2 properties, 2 guests, 2 reservations, 2 cleaning schedules with their backing tasks, 1 maintenance request, all clearly fictional) so list pages aren't empty for a walkthrough — actually run against the local dev DB twice to confirm idempotency (stable row counts, no duplicates), not just typechecked. Added an `ANTHROPIC_API_KEY=""` scaffold to `.env.local` after confirming (via this repo's own `N8N_DISCOVERY.md`) that the credential already exists in StayWhile's n8n workspace — no new credential created; n8n MCP isn't connected this session, so the value has to come from the user directly rather than being pulled programmatically. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **292 tests** total (`website` 141, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Client Readiness Verification (answered in full in this session's chat log)** — short version: a real client cannot log in today (Clerk keys are placeholders, confirmed by direct inspection), no staging/production URL exists (local dev only, `http://localhost:3000`), and there was a real bug in the seed-to-real-login path that's now fixed. Shortest remaining path to a demo: real Clerk keys (external, StayWhile's own account) — once those land, the identity-linking fix and demo data in this increment mean sign-in should work correctly on the first try instead of crashing.

**Increment 14 — demo readiness**: user changed the goal from "more features" to "hand a client a URL and credentials, they experience a real product." Priorities in order: auth, demo data, a lively dashboard, the AI workflow only (no new tools), then a walkthrough report.

- **Auth**: real login is still blocked on a Clerk credential decision only the user can make — no existing StayWhile Clerk instance is documented anywhere in this repo (unlike the Anthropic n8n credential, which was), so this needs a reuse-vs-create decision per the Integration Rule, not something to guess at. Everything checkable without it was re-verified green (the Increment 13 seed-linking fix, RBAC's own test suite).
- **Demo data**: `packages/database/prisma/seed.ts` now seeds 2 properties, 2 guests, 3 reservations (one arriving today, one departing today, one upcoming), 2 cleaning schedules, 1 maintenance request, 1 task due today, 3 notifications, 1 message thread, 1 AI conversation. **Flagged, not built**: "Units/Rooms" has no model in the schema at all — `Property` is the rentable unit; raised for a decision instead of inventing a new domain concept.
- **Real bug found and fixed**: seed dates were landing on the _previous_ calendar day in Postgres — this environment's local timezone (UTC+8) is ahead of UTC, and Prisma serializes `@db.Date` columns via the Date object's UTC representation, so local midnight truncated to the wrong day. Caught by querying seeded rows directly with `psql` against `current_date`, not by inspection. Fixed in both the seed script and `dashboard.service.ts` by constructing dates from UTC Y/M/D components consistently. Also cleaned up 2 duplicate rows this session's own earlier seed iteration had orphaned (a title-format change) — direct deletion of this session's own test artifacts, not real data.
- **Dashboard**: now shows occupancy %, arrivals today, departures today, cleaning today, tasks due today, open maintenance, named arrival/departure lists, and recent AI activity (last 5 conversations) — not just static totals. 1 new test.
- **AI Assistant**: unchanged, already complete, re-verified green, no new tools per instruction.

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **293 tests** total (`website` 142, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4). Seed re-run against the real local dev database (not just typechecked) after every change to confirm idempotency.

**Increment 15 — closed a second duplicate-user path before Clerk goes live**: user confirmed a StayWhile Clerk application already exists (do not create another) and asked for the exact env vars needed. Before answering, audited the rest of the Clerk integration rather than answering from `.env.example` alone — found the identical bug class Increment 13 fixed in `getCurrentUser()`, in a second, independent place: the Clerk webhook sync handler (`apps/website/src/platform/identity/sync-clerk-user.ts`) upserted on `clerkUserId` only, so a real webhook event for an email that already has a row (the seeded placeholder admin) would throw on `User.email`'s unique constraint instead of linking to it — and webhooks can arrive before a user's first page load, so this wasn't just a duplicate of the earlier fix, it was a second live risk. Fixed with the same claim-by-email pattern, 7 new tests (`sync-clerk-user.test.ts`, previously untested). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **300 tests** total (`website` 149, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Required Clerk env vars** (from `apps/website/env.ts`'s Zod schema — the authoritative source, not `.env.example` alone) — answered in full in chat; short version: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` from the existing StayWhile Clerk app's API Keys page (required, real values), `CLERK_WEBHOOK_SIGNING_SECRET` (required by the schema to be non-empty, but doesn't need to be a _real_ webhook secret for a pure local demo — nothing will call `http://localhost:3000/api/webhooks/clerk` from the internet without a tunnel; the JIT-provisioning fallback in `getCurrentUser()` handles login either way), `NEXT_PUBLIC_CLERK_SIGN_IN_URL`/`NEXT_PUBLIC_CLERK_SIGN_UP_URL` already correctly set to `/sign-in`/`/sign-up` in `.env.local`, no change needed.

**Increment 16 — closed the last empty screen, diagnosed the dev-mode 404 precisely**: user confirmed the Clerk fix was done and set a hard stop on further auth work unless testing finds a real bug — full focus on demo readiness. `.env.local` still has placeholder Clerk keys as of this pass (checked directly, not assumed), so login/admin-linkage/page-load verification stays blocked on the user pasting real values in. Everything else: found `audit_logs` was genuinely empty (the seed script bypasses the service layer `recordAudit()` normally writes through) and backfilled 5 entries in the same shape real actions would produce, idempotent; confirmed `integration_connections` only _looked_ empty — it self-seeds the full 12-provider catalog on every page read, verified by reading that code rather than "fixing" a non-issue. Also pinned down exactly why dev mode 404s right now: response headers show `x-clerk-auth-reason: protect-rewrite, dev-browser-missing` — Clerk's normal dev-browser bootstrap redirect, failing because the placeholder key points at a domain that doesn't exist. Confirmed mechanism, not assumption — strong evidence this resolves the moment real keys are in place. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, 300 tests (unchanged — pure seed-script + diagnosis work, no new website code paths this pass).

**Demo Readiness Report** — see this session's chat log for the full report in the user's requested format (login status / URLs / credentials / working modules / blockers). Short version: every seedable table has real demo data now; the only remaining blocker to a full walkthrough is the user pasting real Clerk keys into `apps/website/.env.local` — once that happens, login/admin-linkage/every-page-load should be verifiable immediately (code-side fixes are already in place and tested).

**Increment 17 — full dashboard verification, first commit of the session**: user shifted to "Demo Readiness Mode" — commit the seed work, stop expanding demo data, run a complete per-route check, report status. Committed `packages/database/prisma/seed.ts` (`c594282`) — the first commit landed this entire session. Verified every dashboard module by calling its real service functions (including two real writes) against the real local dev database as the real seeded admin, via a throwaway script deleted immediately after use — the strongest check possible without real Clerk keys, since a literal browser walkthrough still isn't available. All 14 read paths and both write paths succeeded. Also confirmed nav-to-route parity (12 links, 12 pages, exact match) and found **no "Settings" module exists anywhere** — flagged, not built, since it was never part of this app's original domain set. Full checklist and Client Demo Readiness Report delivered in chat.

**Git status**: one commit landed this session (`c594282`, the seed script). Everything else — 17 increments of domain/AI/dashboard/auth work — is still uncommitted. Recommend a small number of logically-grouped commits next (e.g. one for the AI platform work, one for dashboard/demo-readiness, one for the auth fixes), not one giant commit.

**MCP connections**: not re-checked this session (no MCP-dependent work was attempted or needed — every credential-gated integration stayed at the code-adapter stage, never actually connecting to a live external service). Re-verify `claude mcp list` fresh next session per the standing rule, same as always.

**Increment 18 — real Clerk keys landed; first live sign-in crashed every module page, root-caused and fixed**: user reported real Clerk keys are now in `.env.local`, sign-in works, and `/` (dashboard) loads, but every module (`/properties`, `/guests`, etc.) errors. No browser tool was available this session (declined), and curl cannot complete Clerk dev-instance's JS-based `__clerk_db_jwt` handshake, so live HTTP reproduction wasn't possible — root-caused instead via direct DB inspection + code trace, then verified via the DB and full monorepo build/test.

- **Root cause**: `users` table had two rows — the seeded bootstrap admin (`admin@stayawhilewithus.com`, real global `admin` `UserRole`) and a brand-new row JIT-provisioned by `getCurrentUser()` for the real Clerk sign-in, `ryskris0@gmail.com` (different email than the seed expects, so the Increment 13/15 claim-by-email logic correctly didn't match it to the seeded row — this was a genuinely new user, not a bug in that logic). The new row had **zero `UserRole` assignments**, so `assertPermission()` (first line of every domain service's read/write functions) threw `ForbiddenError` for every module. The dashboard page alone was unaffected because `dashboard.service.ts`'s `safeList()` helper explicitly catches `ForbiddenError` and degrades to `[]` per-domain (a deliberate "best-effort summary" design, not a bug) — every other page calls its service directly with no such catch, so the error propagated uncaught into Next's default error overlay.
- **Fix 1 (data)**: granted the real signed-in user (`ryskris0@gmail.com`, id `a42d34fb-e84f-431d-a1c8-7efa63d5337f`) the same global `admin` `UserRole` the seeded admin has. Verified by re-deriving effective permissions directly via SQL join (`user_roles`→`role_permissions`→`permissions`): 79 rows for both users now, exact parity.
- **Fix 2 (code, hardening)**: added `apps/website/app/(dashboard)/error.tsx` — previously no error boundary existed anywhere under the dashboard route group, so any uncaught error (this one, or any future one) rendered Next's raw dev/prod error page instead of an explanation. Now shows a plain "Access denied — ask an administrator to grant you access" message. This does not replace Fix 1; it just stops the _next_ new real sign-in from crashing the same way.
- **Flagged, not built**: there is still no UI or admin flow for granting a role to a new real sign-in — every future first-time real user will hit `ForbiddenError` on every module (now shown gracefully instead of crashing) until someone manually runs the same SQL this session did. This is the same gap Increment 17 already flagged as "no Settings module exists"; this session is direct proof it's a live-blocking gap, not just a hypothetical one.
- **Verification**: full monorepo `lint typecheck test build` forced fresh — 25/25 tasks, 0 errors, production build includes all 12 dashboard routes in the manifest. Confirmed all 11 module `page.tsx` files use the exact same `getCurrentUser()` → service-call pattern (uniform code path, so this one fix applies identically everywhere) — full list checked directly, not sampled. **Could not perform a literal browser click-through** (no browser tool this session); recommend the user do one manual pass to visually confirm, though the evidence (uniform code path + DB permission parity + green build) is as strong as this session's tooling allows.

**Increment 19 — 2026-08-12: client dashboard requirements delivered, real August + Cielo integrations built and Cielo proven live**: user ran a client meeting and returned with an exact, specific dashboard spec, then separately asked for August and Cielo to become real (not stub) integrations. Both are now substantially done. Full detail below; short version: **the dashboard now matches every requirement from the meeting, Cielo is proven live end-to-end except for one external blocker (no real Property records to map devices to), and August is code-complete but pending a human 2FA step only the client can do.**

### The exact client dashboard requirements (from the meeting)

The client's four homepage requirements, verbatim in spirit:

1. **August locks** — separate summary (not folded into a generic "device health" number), online/offline count, low-battery indication, and an "offline + low battery" combined state must be visually distinguishable from "offline" alone or "low battery" alone. Demo/seed data must never be presented as live.
2. **Thermostats** — separate summary from locks, offline status clearly shown, same demo-vs-live honesty rule.
3. **Check-ins / check-outs** — today's arrivals/departures, **plus what's happening on upcoming days** (not just today). Dates must never shift by a day due to timezone handling.
4. **Rescheduled cleanings** — must show that a cleaning was rescheduled, with original date → new date, easy for an ops person to notice without digging into the Cleaning page.

Plus: Notion and OwnerRez should show real data if credentials exist, and an honest "not connected" message otherwise — never fabricated data. **ADR and Revenue must NOT be on the main dashboard** — they stay reachable via the Reservations page/sidebar only. No unrelated redesign; make the requested information obvious, accurate, and demo-ready, not prettier.

### Dashboard: what's built, and what's live vs. demo right now

- `apps/website/src/domains/dashboard/components/DashboardSummary.tsx` and `.../services/dashboard.service.ts` (both currently **untracked** — new this engagement, never committed) now implement all four requirements:
  - Locks and Thermostats are two separate `Metric` tiles in the KPI strip (not merged).
  - Every offline/low-battery device is itemized in "Needs Attention" with wording that distinguishes **Offline** / **Low battery** / **Offline + low battery** (fixed a real bug along the way: a low-battery-but-online device was showing the maintenance-request badge text "Open" — now shows "Low battery"; also fixed a second bug where a device that was both offline and low-battery only ever reported "Offline," silently hiding the battery fact).
  - "Coming Up" section shows upcoming (not-today) check-ins/check-outs within a 6-day window, alongside the existing "Today's Arrivals & Departures."
  - **Timezone bug fixed**: dates on `@db.Date` columns (check-in/out, cleaning dates) were briefly rendered through a local-timezone `toLocaleString()` that could show the wrong calendar day depending on server timezone. Fixed with a dedicated `formatUtcDate()` helper used everywhere a `@db.Date` field renders (rescheduled-cleaning dates, upcoming check-in/out dates).
  - "Rescheduled Cleanings" section shows property + original date → new date + status, positioned in the primary (left) column.
  - Notion/OwnerRez sections show real data when configured, an honest "Not connected — set X to enable" message otherwise. **Neither is configured in this local dev environment as of today** — no `NOTION_API_KEY`/`OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` in `.env.local`.
  - ADR/Revenue confirmed absent from the main dashboard; live on `apps/website/app/(dashboard)/reservations/page.tsx`, reachable via the persistent "Reservations" sidebar item.
  - **Demo-vs-live labeling is per-device-row, not per-provider**: `isDemoSmartDevice()` (`smart-devices.service.ts`) checks whether a `SmartDevice` row's `externalDeviceId` starts with `"demo-"` — the only thing `seedDemoSmartDevices()` ever prefixes that way, so a real August lock ID or Cielo MAC address can never collide with it. This was a deliberate redesign away from an earlier per-_provider_ flag (`PROVIDER_CLIENT_STATUS`), because flipping a provider to "real" the moment its client code exists — independent of whether any given environment's rows actually came from a real sync — would have mislabeled lingering demo rows as live. Verified via dedicated tests.
  - Rescheduled-cleaning backend: `CleaningSchedule.originalScheduledDate` (nullable `@db.Date`, migration `20260811153801_add_cleaning_reschedule_tracking`), `rescheduleCleaningSchedule()` service (sets `originalScheduledDate` only on the _first_ reschedule, no-ops with no DB write if the new date equals the current one — a real bug found and fixed), inline reschedule form on `/cleaning`.

**Right now, in this exact database**: August locks = 4 demo rows (all `demo-`-prefixed, correctly labeled "Demo data" on the dashboard) — no live August data yet. Cielo thermostats = **0 rows** — the 2 demo Cielo rows were auto-pruned once real `CIELO_USERNAME`/`CIELO_PASSWORD` were detected in the environment during a seed run (this is the honesty safeguard working correctly, not a bug: `seedDemoSmartDevices()` only seeds a provider's demo rows while its real credentials are absent, and deletes any leftover demo rows the moment real credentials appear). So the dashboard's Cielo tile currently and correctly shows "0/0 — None connected" — no demo data, no live data yet either.

### August: real integration built, proven only up to the credential boundary

`packages/integrations/src/august/` (client.ts, types.ts, README.md, `scripts/login.ts`, `scripts/check.ts`) — all real, verified against `snjoetw/py-august`'s actual source (not guessed), read-only (no lock/unlock implemented, intentionally). `apps/website/src/domains/smart-devices/services/smart-devices.service.ts`'s `syncAugustDevices()` calls it and upserts into `SmartDevice`, gated on `AUGUST_PROPERTY_MAP` (a required env var mapping August `houseId` → StayWhile `Property.id` — there is no verified automatic way to look this up, so it's explicit config, not guessed). A "Sync now" button is wired into `/integrations` for AUGUST.

**Blocked, and correctly not bypassed**: August's login needs a one-time interactive step — password, then a 6-digit verification code sent to the account's email/phone. This literally cannot be completed by an AI assistant: it requires live keyboard input into a running local process, which chat tooling has no channel for. **Kenny needs to provide the verification code**, and the user (not the assistant) runs the login script in their own terminal. This is understood and was not attempted to be bypassed or faked.

**Exact command to resume, once Kenny's code is available:**

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts
```

Then, to verify it worked (real, read-only — validates credentials, lists real locks, prints name/houseId/online-offline/battery, never the token):

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts
```

### Cielo: proven live end-to-end, blocked on one external fact (not credentials)

`packages/integrations/src/cielo/` — same shape as August. **Corrected a real research error from earlier in this engagement**: an initial pass concluded Cielo had two separate incompatible products/APIs ("Breez Edge" vs. "MRCOOL SmartHVAC"). Re-reading the _current_ source of the reference integration (`bodyscape/cielo_home`, actively maintained, 2025-dated) showed this was wrong — it's one unified backend (`api.smartcielo.com` / `home.cielowigle.com`) serving both brand names. **This is now empirically confirmed, not just theorized**: the real account's login succeeded against exactly this backend.

**Live verification actually performed today** (read-only `validateCredentials()` + `listDevices()`, real credentials, no control actions):

- Login: **succeeded**.
- 6 real devices retrieved:

  | Device                  | MAC          | Status  |
  | ----------------------- | ------------ | ------- |
  | Island Tides - Man cave | D8BFC0FE8756 | ONLINE  |
  | Bahamas - Living Room   | D0EF7624CCD4 | OFFLINE |
  | Ocean Pearl - SPA Room  | B48A0AF68C2A | OFFLINE |
  | 7206 - Office           | C45BBEC42260 | ONLINE  |
  | Miramar Blis - MIL      | 781C3CBADB1C | OFFLINE |
  | Sandy Nudes - Garage    | 781C3CB9ED6C | ONLINE  |

- The real `syncCieloDevices()` function (not a mock — the exact code the "Sync now" button calls) was then actually run against the real database: **result `{ synced: 0, skippedExternalIds: [all 6 MACs] }`**. Zero writes happened.

**The actual blocker**: this database's only two `Property` rows are `internal_code` `DEMO-001`/`DEMO-002` ("Cabin on the Ridge," Estes Park CO; "Downtown Loft," Denver CO) — explicitly fictional demo data. None of the 6 real device names/locations above have any defensible match against them (checked name, `internal_code`, city, state — zero overlap, different region entirely). Per explicit instruction, no mapping was guessed. `CIELO_PROPERTY_MAP` is still `"{}"`.

**Exact next step for Cielo**: either (a) the client's real properties for these 6 locations get created in StayWhile (via the app's normal Property-creation flow) and their IDs given to fill in `CIELO_PROPERTY_MAP`, or (b) the client confirms an explicit correspondence if one of these actually should map to an existing property under a different name. The moment `CIELO_PROPERTY_MAP` has real entries, re-running the sync (same command pattern as the check script, or clicking "Sync now" on `/integrations`) will write real `SmartDevice` rows and they'll appear on the dashboard automatically — `isDemoSmartDevice()` will correctly never flag them as demo, since real MAC addresses can't match the `"demo-"` prefix.

### Environment variables configured (names only — no values here, ever)

In `apps/website/.env.local` (gitignored, confirmed not tracked by git):

- `CIELO_USERNAME`, `CIELO_PASSWORD` — **set**, real, verified working via live login today.
- `CIELO_PROPERTY_MAP` — set to `"{}"` (empty — the actual blocker above).
- `AUGUST_IDENTIFIER`, `AUGUST_INSTALL_ID`, `AUGUST_ACCESS_TOKEN` — **empty**, pending Kenny's code + the user running the login script.
- `AUGUST_PROPERTY_MAP` — set to `"{}"` placeholder (irrelevant until August has a token).
- `NOTION_API_KEY`, `OWNERREZ_USERNAME`, `OWNERREZ_API_TOKEN` — **not set** (unchanged from earlier sessions; Notion/OwnerRez dashboard sections correctly show "Not connected").

### Client isolation — reconfirmed clean this session

No global shell environment variables, no global `.npmrc`/pnpm config, nothing outside this repo's directory tree was read or written at any point. One formatting bug in the user's own saved Cielo credentials (extra stray quote) was fixed via a pattern-based `sed` substitution that never required displaying the actual value. One temporary diagnostic script (used twice, to run the real `syncCieloDevices()` outside the Next/Clerk request cycle) was created inside `apps/website/`, run, and deleted immediately both times — not committed, not left behind.

### Notion / OwnerRez status (unchanged this session, restated for continuity)

Both have real, credential-gated clients (`packages/integrations/src/notion/`, `.../ownerrez/`) built in an earlier session — genuine HTTP calls, no fabricated data, `IntegrationHighlights<T>` discriminated union (`configured: false` vs. `ok: true/false`). Neither has credentials in this local environment right now, so both dashboard sections honestly show "Not connected." No code changes needed here — just credentials, whenever the client wants to provide them.

### Verification (forced fresh, today)

Full monorepo `lint typecheck test build` — **25/25 tasks, 0 errors**. **368 tests total**: `website` 194, `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4. Production build succeeds (19 routes). Dev server restarted and healthy after every change today.

**Still not committed to git**: everything from this session (dashboard domain files, smart-devices services, August/Cielo real clients + scripts, integrations service additions) is still working-tree changes, same as the large uncommitted body of work already noted elsewhere in this file. `git status` shows the real current state — check it fresh, don't assume from this doc.

## Increment 20 — 2026-08-14: August proven live end-to-end — real properties, real sync, proven idempotent

Continuation of Increment 19's one remaining August blocker (Kenny's 2FA code). The code was hit with three real, successive failures before it actually worked — each root-caused against the actively-maintained `Yale-Libs/yalexs` library rather than guessed at:

1. **404 on every request** — the integration had been ported from `snjoetw/py-august`, unpushed since 2022-01-31. August had since rotated its app-identification values server-side: stale API key, a six-year-old User-Agent, and two now-required headers (`x-august-branding`, `x-august-country`) that were never sent. Fixed by re-porting against `yalexs` (pushed as recently as 2026-08-10).
2. **403 Forbidden, both brands tried** — `yalexs` defines two non-OAuth brands (`august`, `yale_access`) sharing one API key/host, differing only in the `x-august-branding` value (accounts get silently migrated between them by Yale). `login.ts` was fixed to try both automatically against one password entry.
3. **403 with a definitive body, `{"code":"Forbidden","message":"API key is not valid"}`, both brands** — confirmed via real-world reports in `Yale-Libs/yalexs` issues [#99](https://github.com/Yale-Libs/yalexs/issues/99) and [#150](https://github.com/Yale-Libs/yalexs/issues/150) to mean a brand/host/key mismatch, not bad credentials. `yalexs/const.py` actually defines **four** brands, not two — `yale_august` and `yale_global` each have their own API key, and `yale_global` uses an entirely different host (`api.aaecosystem.com`). All four now live in one shared table (`packages/integrations/src/august/types.ts`'s `AUGUST_BRAND_CONFIGS`), used by both `client.ts` and `scripts/login.ts` so they can't drift apart again.

**Real login then succeeded** — matched brand: **`yale_august`** (a Yale-migrated account; yalexs's own enum flags this brand as normally OAuth-only, but the plain password + 2FA-code flow worked anyway). Token valid until 2026-09-12.

**Real device retrieval** (`check.ts`, read-only): 8 real locks across 4 real houses. The user relayed Michelle's full 36-property StayWhile name list plus complete address/type/bed/bath/occupancy/timezone detail for the 4 properties matching those houses. Reconciled without guessing — confirmed aliases: "Bonjour" → **Bonjour AMI**; Island Tides, Miramar Bliss, Aqua Palm unchanged. Two ambiguous locks were resolved by explicit user confirmation, not inferred: "Mother In Law - Door" is Miramar Bliss's second lock; the unbranded "Front Door" (Island Tides, -100% battery — August's "no sensor" reading) is the WiFi bridge/hub, not a real lock.

**4 real `Property` rows created** (leaving `DEMO-001`/`DEMO-002` untouched — confirmed via identical `updatedAt` before/after):

| Property      | Internal code   | id                                     | Real August houseId                    |
| ------------- | --------------- | -------------------------------------- | -------------------------------------- |
| Island Tides  | `ISLAND-TIDES`  | `4baac99a-b3f7-4f5b-8031-afcedae24a00` | `1ee6ffaf-6fe7-42e1-9d4a-bc9e66a677c5` |
| Bonjour AMI   | `BONJOUR-AMI`   | `5c3cdde7-ff8f-47c9-92a0-6b6e61c1b86b` | `81b55799-18f6-48c2-88ec-a8272b5b3b65` |
| Miramar Bliss | `MIRAMAR-BLISS` | `f7d046c6-e089-41e5-893a-620e5e127c18` | `834a41d3-a673-43e8-a2ea-9d50ab5c6d75` |
| Aqua Palm     | `AQUA-PALM`     | `b3177e87-4266-4e99-a2c2-12f264513e48` | `c98c1d75-cc3e-4315-be7a-16d6d37a97c8` |

`AUGUST_PROPERTY_MAP` in `.env.local` now holds all four real houseId→propertyId pairs.

**New: `AUGUST_EXCLUDED_LOCK_IDS`** — env-driven denylist (`smart-devices.service.ts`), holding exactly one confirmed non-lock device (`76CD40D8711A4ABB98D150B4E5612E48`, the Island Tides bridge). Deliberately a per-device confirmed list, not a blanket "skip anything with a weird battery reading" heuristic — a real lock's genuine battery-sensor failure should still surface on the dashboard, not silently disappear.

**Real sync run twice to prove idempotency**: both runs returned `{ synced: 7, skippedExternalIds: [] }`. The second run was verified against the first at the row level — same 7 `SmartDevice` row **IDs** both times (proving the upsert updated existing rows rather than inserting duplicates), zero duplicate `externalDeviceId`s, excluded device still absent (0 rows). Real, live battery/status data for all 7 locks — see the resulting table below.

| Lock                       | Property      | Status  | Battery |
| -------------------------- | ------------- | ------- | ------- |
| Island Tides - Front Door  | Island Tides  | OFFLINE | 97%     |
| Island Tides - Man Cave    | Island Tides  | OFFLINE | 69%     |
| Bonjour - Front Door       | Bonjour AMI   | ONLINE  | 98%     |
| Bonjour - In Law           | Bonjour AMI   | ONLINE  | 87%     |
| Miramar Bliss - Front Door | Miramar Bliss | OFFLINE | 76%     |
| Mother In Law - Door       | Miramar Bliss | OFFLINE | 78%     |
| Aqua Palm - Front Door     | Aqua Palm     | ONLINE  | 99%     |

**New: `updatePropertyOccupancy`** (schema + service + server action + inline `/properties` UI control, mirroring the existing `updatePropertyStatus` pattern) — added because Michelle noted `maxOccupancy` can change with bed-arrangement changes. Structurally independent of the August mapping: `AUGUST_PROPERTY_MAP` is keyed by the property's `id`, which never changes when `maxOccupancy` does. 2 new RBAC tests cover it.

**Verification, forced fresh**: `pnpm turbo run lint typecheck test build --force` — **25/25 tasks, 0 errors**. **370 tests total**: `website` 196 (up from 194 — the 2 new occupancy tests), `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4. Production build succeeds (19 routes).

**Client isolation reconfirmed**: only `apps/website/.env.local` and this repo's local dev database were touched. No other client's files, credentials, or environments were read or written at any point. Two temporary one-off scripts (property creation + sync, and the second idempotency-proving sync) were created inside `apps/website/`, run, and deleted immediately both times — not committed, not left behind, same pattern as prior sessions' throwaway diagnostic scripts.

**Result: August is now live end-to-end** — real login → real property records → real lock/property mapping → real sync → proven idempotent, all backed by real device data. **No further August work is needed** unless the client adds more properties or locks later (same code path handles it: re-run `check.ts` for new houseIds, extend `AUGUST_PROPERTY_MAP`, re-run the sync).

**Right now, in this exact database**: August locks = 7 real rows across 4 real properties (`ISLAND-TIDES`, `BONJOUR-AMI`, `MIRAMAR-BLISS`, `AQUA-PALM`), correctly labeled live (not demo) — real August lock IDs never match the `"demo-"` prefix `isDemoSmartDevice()` checks for.

**A note for whoever picks up Cielo next, not acted on this session**: two of the six Cielo devices found in Increment 19 — "Island Tides - Man cave" and "Miramar Blis - MIL" — share property names with two of the properties just created here for August (Island Tides, Miramar Bliss). Worth checking whether these are literally the same physical properties before assuming Cielo still needs 6 brand-new ones. This session did not touch Cielo, `CIELO_PROPERTY_MAP`, or any Cielo code — this is only an observation for the next session to verify, not a decision or mapping made here.

## Increment 21 — 2026-08-15: Cielo proven live end-to-end — real properties, real mapping, real sync, proven idempotent

Continuation of Increment 20's flagged Cielo question. The client (via the user, sourced from Michelle) confirmed the property mapping directly — nothing here was guessed:

- **Island Tides** and **Miramar Bliss** — the same physical properties already created for August in Increment 20. Reused their existing `Property.id`s, no new rows.
- **Bahamas**, **Ocean Pearl**, **Sandy Nudes** — 3 new, real properties. Full address/type/bed/bath/occupancy/timezone came from Michelle's list, relayed by the user and used exactly as given (no invented values):

  | Property    | Internal code | id                                     | Address                                         | Type  | Bed/Bath | Max occ. | Timezone         |
  | ----------- | ------------- | -------------------------------------- | ----------------------------------------------- | ----- | -------- | -------- | ---------------- |
  | Bahamas     | `BAHAMAS`     | `87b19371-2828-44ef-8220-0ad4d5f6a361` | 4411 22nd Ave W, Bradenton, FL 34209            | House | 4 / 2    | 12       | America/New_York |
  | Ocean Pearl | `OCEAN-PEARL` | `7b0755a1-9e28-4356-aefb-27e231b233e1` | 2330 Kings Point Dr, Largo, FL 33774            | House | 6 / 4.5  | 14       | America/New_York |
  | Sandy Nudes | `SANDY-NUDES` | `c6ed7ec8-ce8b-43ef-8a66-9284b1d08c77` | 204 W Hibiscus St, South Padre Island, TX 78597 | House | 5 / 3    | 14       | America/Chicago  |

  Created via a temporary Prisma script (same throwaway-script pattern as Increment 20's property creation), run once and deleted immediately — not committed, not left behind.

- **7206 deliberately excluded, not mapped**: Kenny confirmed this device ("7206 - Office", MAC `C45BBEC42260`) is his and Jenny's personal residence and must not appear on the dashboard. Unlike August's `AUGUST_EXCLUDED_LOCK_IDS` (needed because an excluded device shared a houseId with real locks that still had to sync), Cielo's sync already skips any device whose MAC isn't a key in `CIELO_PROPERTY_MAP` — so simply never adding `C45BBEC42260` to the map was sufficient. No new exclusion mechanism was built; verified the skip actually happens (see below) rather than assumed.

**`CIELO_PROPERTY_MAP`** in `apps/website/.env.local` now holds exactly 5 entries (the 5 mapped MACs above); `C45BBEC42260` is absent. `CIELO_USERNAME`/`CIELO_PASSWORD` were not touched — same credentials verified live in Increment 19/20.

**Real sync run twice to prove idempotency**, via a temporary script (same reasoning as Increment 20's: `smart-devices.service.ts` transitively imports `"server-only"`, which unconditionally throws outside Next's request cycle — the script re-implements `syncCieloDevices()`'s exact logic, calling the real `CieloClient` and the real `prisma.smartDevice` table, not a mock). Script created, run twice, deleted immediately after — not committed.

- Both runs: `{ synced: 5, skippedExternalIds: ["C45BBEC42260"] }`.
- Row-level check between runs: **identical 5 `SmartDevice` row IDs both times** — the upsert updated existing rows, not duplicates. Zero duplicate `externalDeviceId`s across the whole table.
- Verified via direct query: all 5 rows correctly joined to their intended property (`BAHAMAS`, `ISLAND-TIDES`, `MIRAMAR-BLISS`, `OCEAN-PEARL`, `SANDY-NUDES`); `C45BBEC42260` present in zero `SmartDevice` rows.
- August confirmed untouched throughout: still exactly 7 `SmartDevice` rows, same row IDs, no code in `packages/integrations/src/august/` or `smart-devices.service.ts`'s August path was modified.
- `DEMO-001`/`DEMO-002` confirmed untouched: `updated_at` unchanged (2026-08-07) before and after this session's writes.

| Device                  | Property      | Status  |
| ----------------------- | ------------- | ------- |
| Island Tides - Man cave | Island Tides  | ONLINE  |
| Bahamas - Living Room   | Bahamas       | OFFLINE |
| Ocean Pearl - SPA Room  | Ocean Pearl   | OFFLINE |
| Miramar Blis - MIL      | Miramar Bliss | OFFLINE |
| Sandy Nudes - Garage    | Sandy Nudes   | ONLINE  |

**Right now, in this exact database**: 9 `Property` rows total (6 real: `ISLAND-TIDES`, `BONJOUR-AMI`, `MIRAMAR-BLISS`, `AQUA-PALM`, `BAHAMAS`, `OCEAN-PEARL`, `SANDY-NUDES` — that's 7, plus 2 demo: `DEMO-001`, `DEMO-002`). `SmartDevice`: 7 `AUGUST` + 5 `CIELO` = 12 total, zero demo rows, zero duplicates. Real MAC addresses never match `isDemoSmartDevice()`'s `"demo-"` prefix check, so all 5 Cielo rows correctly render as live on the dashboard, not demo.

**Verification, forced fresh**: `pnpm turbo run lint typecheck test build --force` — **25/25 tasks, 0 errors**, only pre-existing `import/order` lint warnings (same known pattern from every prior increment). **370 tests total, unchanged from Increment 20** (`website` 196, `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4) — expected, since this was a data/config change verified by direct database inspection and live sync runs, not new application code needing new tests. Production build succeeds (19 routes).

**Client isolation reconfirmed**: only `apps/website/.env.local` (one line, `CIELO_PROPERTY_MAP`) and this repo's local dev database were touched. No August credentials, code, or data were modified. No other client's files, credentials, or environments were read or written. Two temporary scripts (property creation, sync) were created inside `packages/database/`, run, and deleted immediately — not committed, not left behind, same pattern as Increment 20.

**Result: Cielo is now live end-to-end**, matching August's status. **No further Cielo work is needed** unless the client adds more thermostats later (same resume path as August: re-run `packages/integrations/src/cielo/scripts/check.ts` for new devices, extend `CIELO_PROPERTY_MAP`, re-run the sync).

**Still not committed to git**: this session made no tracked-file changes other than this `HANDOFF.md` update (the 3 Property rows and `SmartDevice` rows live only in the database; `CIELO_PROPERTY_MAP`'s new value lives only in gitignored `apps/website/.env.local`). The large body of prior uncommitted work (Increments 1–20) is still exactly as uncommitted as `git status` showed at the start of this session — untouched by this session, still worth grouping into logical commits whenever the user is ready.

**Exact next step if picking this up later**: nothing is blocked. Both August and Cielo are fully live. Reasonable next priorities, in no particular order: (a) commit the large uncommitted body of work in logical groups, (b) OwnerRez/Notion credential setup if the client wants those dashboard sections live, (c) revisit Increment 18's flagged gap — no UI/admin flow exists yet for granting a role to a new real Clerk sign-in.

## Increment 22 — 2026-08-15 (same day, continued session): Team/Users admin feature, OwnerRez + Notion credentials verified live (read-only), sign-out button, dashboard requirements re-audited

Continuation of the same 2026-08-15 session, after Increment 21. Four threads of work, all still uncommitted at the end of this increment.

### Team & Role Management — closes Increment 18/20's flagged gap

User asked for an admin-only Team/Users section, built as a new `apps/website/src/domains/users/` domain following the established DDD vertical-slice pattern. Uses only pre-existing permission keys (`users:read/create/delete`, `roles:read/manage`) — the permission catalog, `packages/database/prisma/seed.ts`'s role seeds, and every other role's grants are **unchanged**. As seeded, only `admin` (`permissionKeys: "*"`) holds any of these, so the feature is admin-only by construction, enforced server-side via `assertPermission` as the first line of every service function (not by hiding the nav link).

- **View users + their role assignments**, **assign/revoke a role** (global or property-scoped, idempotent — re-assigning an already-held role is a no-op, mirrors `packages/database/scripts/grant-role.ts`'s existing behavior, which remains as a valid emergency/manual fallback).
- **Invite a team member**: sends a real Clerk invitation (`platform/identity/invite-clerk-user.ts`, using Clerk's actual `invitations.createInvitation`/`getInvitationList`/`revokeInvitation` API, verified against the installed SDK's real types before writing). Deliberately creates **no local `User` row** — the invitee's row (and any role) only comes into existence the normal way once they actually accept and sign in. Inviting an email that already has a `User` row (case-insensitively) is rejected rather than sending a duplicate.
- **Deactivate/remove a team member**: sets `User.status = "DEACTIVATED"` only (never `deletedAt`) — the row, its `UserRole` assignments, and every `AuditLog` row referencing it stay intact, so the person stays visible with a "Deactivated" badge instead of disappearing.
- **Last-global-admin protection**: both `revokeUserRole` and `deactivateTeamMember` refuse to remove the last remaining global `admin` assignment in the system (`ConflictError`), so the app can't accidentally lock itself out of role management through the UI.
- **Roles & permissions reference table** (`RolePermissionsList.tsx`): shows each role's actual granted permissions grouped by resource, sourced from a deeper `include` on `listAssignableRoles` — read-only display data, no write path, no schema change. The `admin` role renders as "Unrestricted — all permissions" rather than enumerating ~75 keys.
- **A real access-control gap found and fixed**: `User.status` was never actually checked anywhere — a "deactivated" user's existing session would have sailed through every `assertPermission` call unaffected. Fixed in `platform/auth/get-current-user.ts`: it now throws a new `AccountDeactivatedError` (`platform/errors.ts`) for any non-`ACTIVE` or soft-deleted row, before any permission check runs — enforced uniformly across every route/Server Action in the app, not just this new domain.
- **A second real gap found and fixed, directly requested by the user**: `User.email`'s database unique constraint is case-sensitive, so nothing stopped `Admin@x.com` and `admin@x.com` from becoming two rows. Fixed by normalizing email to lowercase at every write site and switching the claim-by-email lookup from `findUnique` (exact match) to `findFirst` with `mode: "insensitive"`, in both `get-current-user.ts` (JIT provisioning) and `platform/identity/sync-clerk-user.ts` (the Clerk webhook handler) — same fix, same reasoning, both places independently create/claim `User` rows.
- **`admin@stayawhilewithus.com` verified, not created**: queried the local dev DB directly (read-only) — the seeded bootstrap row already exists, status `ACTIVE`, already holding the global `admin` role. Its `clerkUserId` is still the seed placeholder (never claimed by a real sign-in yet) — correctly so, per the explicit instruction not to fabricate a user ahead of a real Clerk sign-in. The moment that email signs in for real (any casing), the case-insensitive claim-by-email fix above links this exact row and its admin role carries over automatically. **No database write was made for this.**
- Verification, forced fresh: **25/25 tasks, 0 errors**, **234/234 `website` tests** (up from 213 — new: 30 in `users.service.test.ts`, 9 in `get-current-user.test.ts`, 8 in `sync-clerk-user.test.ts`, 3 in `invite-clerk-user.test.ts`).

### OwnerRez + Notion: credentials configured and verified live, read-only

User provided both credential sets; added as empty placeholders first (`OWNERREZ_USERNAME`, `OWNERREZ_API_TOKEN`, `NOTION_API_KEY` in `apps/website/.env.local`, gitignored), then the user filled them in directly (never pasted into chat). A presence check (`validateCredentials()` on both `OwnerrezClient`/`NotionClient`, real read-only calls) initially returned two 401s — root-caused (not assumed) to a formatting bug: all three new `.env.local` lines were missing their closing `"`, confirmed via a redacted quote-balance check, not by ever printing the values. Fixed with a blind `sed` line-append (by line number only, values never read or printed) and re-verified: **both credentials are valid.**

A follow-up **read-only discovery pass** (throwaway script, real `GET`-only calls, run once, deleted immediately, never committed) found:

- **OwnerRez**: 20 real properties, recent bookings (19 active, 1 canceled in the last 365 days) — real account, cross-references cleanly against properties already confirmed real via August/Cielo (Island Tides, Miramar Bliss, Aqua Palm, Sandy Nudes all appear).
- **Notion**: 100+ accessible pages/databases (search API reported more beyond the first page — not fully enumerated), mostly a nested page hierarchy (regional grouping pages → individual property sub-pages) rather than flat databases, plus 4 real databases with retrieved schemas (`View of Listings` is the closest thing to a structured property table: Address/Bedrooms/Bathrooms/Airbnb+VRBO links/Guidebook).
- **No property mapping was inferred or attempted.** Property names differ across systems in ways that aren't safely automatable (e.g. OwnerRez `Miramar-Bliss` vs. a Notion page titled `🏡 Miramar Bliss` vs. StayWhile's own `internalCode` `MIRAMAR-BLISS`) — flagged explicitly as needing the user's/Michelle's/Kenny's confirmation, same standard already used for `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP`.

**A hard safety rule was added at the user's explicit direction**, recorded in both `packages/integrations/src/notion/README.md` and `packages/integrations/src/ownerrez/README.md` (dated 2026-08-15) and in a new standing cross-session memory (`feedback_notion_ownerrez_read_only_safety`): **Notion is a strictly read-only source of truth for Kenny & Jenny's existing information — never create/update/overwrite/rename/archive/delete/append to any existing Notion content, any conflict must be reported to the user, never auto-resolved by writing back.** OwnerRez remains read-only unless the user explicitly authorizes a specific write. No inferred mappings, ever. Before any sync/write implementation for either integration, the exact reads/mappings/writes must be shown to the user for approval first. This applies only to this client's own configured credentials.

The dashboard's existing Notion/OwnerRez sections (`getNotionHighlights`/`getOwnerRezHighlights` in `apps/website/src/domains/integrations/services/integrations.service.ts`, built in Increment 19 before real credentials existed) were **not modified this session** — they already only call read endpoints, already never write anywhere, and will now show real data automatically now that the credentials are valid, with zero code change required.

### Dashboard requirements re-audited against Michelle/Kenny's spec — all confirmed already implemented

Read `dashboard.service.ts` and `DashboardSummary.tsx` in full plus two read-only DB checks (device counts, rescheduled-cleaning count) rather than trusting prior notes. Result — everything already built in Increment 19, still correct today:

| Requirement                                         | Status                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| August lock summary + offline/low-battery alerts    | **Confirmed done** — separate `Locks` KPI tile; "Needs Attention" itemizes `Offline` / `Low battery (X%)` / `Offline + low battery` distinctly. Live data confirmed: **7 real August locks, 0 demo rows**.                                 |
| Thermostat summary + offline alerts                 | **Confirmed done** — separate `Thermostats` tile, same itemization. Live data confirmed: **5 real Cielo thermostats, 0 demo rows**.                                                                                                        |
| Daily check-ins/check-outs                          | **Confirmed done, unchanged** — "Check-ins today"/"Departures today" metrics + "Today's Arrivals & Departures" section.                                                                                                                    |
| Rescheduled cleanings on homepage                   | **Confirmed done** — "Rescheduled Cleanings" section renders whenever any exist; **1 row currently in the DB**, actively showing.                                                                                                          |
| ADR/Revenue off homepage, sidebar/Reservations only | **Confirmed done, unchanged** — absent from `DashboardSummary.tsx`; still live only on `/reservations`, reachable via the persistent sidebar item.                                                                                         |
| OwnerRez/Notion read-only dashboard visibility      | **Confirmed done** for what's safely buildable without a mapping decision (see above) — real data now flows automatically since credentials are valid; no property attribution, no writes, matching the explicit no-inferred-mapping rule. |

No application code was changed as a result of this audit — everything asked for was already correct.

### Sign-out

Added a dedicated, always-visible "Sign out" icon button to the dashboard sidebar footer (`apps/website/app/(dashboard)/layout.tsx`), using Clerk's own `<SignOutButton redirectUrl="/sign-in">` (real prop verified against the installed `@clerk/clerk-react` SDK types before use, not guessed) wrapping a labeled icon button, sitting next to the existing `UserButton` (whose own built-in sign-out menu item is untouched — this adds a second, more discoverable path, not a replacement). `redirectUrl="/sign-in"` is set directly on the button so the return-to-login-screen behavior doesn't depend on middleware fallback chains. Touches nothing in `packages/auth`'s RBAC layer — pure Clerk session action. Verification, scoped to `website`, forced fresh: **6/6 tasks, 0 errors, 234/234 tests** (unchanged count — this file has no dedicated test, matching this codebase's convention of not unit-testing layout/chrome components; typecheck+build exercise the new import/JSX).

### Dev server

Started for this project on **port 3001**, not 3000 — port 3000 was found already occupied by a **different client's** dev server (Client B / Cabin Collective, confirmed via the process's own working directory before touching anything, then left completely alone). `GET /api/health` confirmed the server itself boots and serves correctly; `GET /` 404s under `curl` for the same known, pre-existing Clerk dev-browser-handshake reason documented in earlier increments (not a regression) — full visual confirmation of the dashboard needs a real browser, which wasn't available this session (Chrome extension declined).

### Client isolation, reconfirmed

One real lapse this session, disclosed in full to the user at the time: a single dependency-lookup command was scoped wrong (`find /` instead of scoped to this repo's own `node_modules`) while verifying the Clerk invitations API — caught and corrected within the same turn, never read its output, no file content outside this repo was ever read/written at any point this session. Every other command, including the port-3000 investigation above, was read-only and repo/process-scoped before any action was taken.

### Git status at the end of this increment

**Nothing has been committed or pushed this session** (`main` still exactly at `d041f2e`, same as it's been since the Users/Roles feature was pushed earlier in the day). The working tree has 20 uncommitted files, all additive, all reviewed:

- Modified (15): `apps/website/app/(dashboard)/layout.tsx` (sign-out), `apps/website/app/(dashboard)/users/page.tsx`, `apps/website/src/domains/users/{README.md, actions.ts, components/UserList.tsx, schemas/users.schema.ts, services/users.service.ts, services/users.service.test.ts}`, `apps/website/src/platform/{errors.ts, auth/get-current-user.ts, auth/get-current-user.test.ts, identity/sync-clerk-user.ts, identity/sync-clerk-user.test.ts}`, `packages/integrations/src/{notion,ownerrez}/README.md`.
- New (5): `apps/website/src/domains/users/components/{InviteTeamMemberForm.tsx, PendingInvitationsList.tsx, RolePermissionsList.tsx}`, `apps/website/src/platform/identity/{invite-clerk-user.ts, invite-clerk-user.test.ts}`.

**Explicitly not touched this session**: `packages/database/prisma/schema.prisma`, `packages/database/prisma/seed.ts`, `packages/auth/src/permissions.ts` (no schema/migration/permission-catalog changes anywhere in this increment), `packages/integrations/src/august/`, `packages/integrations/src/cielo/`, `apps/website/src/domains/smart-devices/` (August/Cielo untouched, as instructed), and the actual `notion/client.ts`/`ownerrez/client.ts` write surfaces (no sync/write code exists for either — by design, pending the user's explicit approval of exact reads/mappings/writes).

### Current status (superseded by Increment 23 below): WAITING FOR CLIENT FEEDBACK

User has asked Michelle and Kenny to test the dashboard and the sign-out flow before anything further happens. **The next step is to wait for that feedback** — no new feature work, no property mappings, no sync implementation, no external-system writes, unless the user explicitly requests it in the meantime.

---

## Increment 23 — 2026-08-17: production cutover (Supabase migration + Vercel + Clerk testing-phase gate)

User asked to move the dashboard off `localhost` onto a real, testable production URL, without yet purchasing `stayawhilewithus-dashboard.com` (confirmed unregistered via WHOIS). Deliberately chose Vercel's existing free `.vercel.app` alias and the existing Clerk **Development** instance for a testing phase, deferring the custom domain and a Clerk **Production** instance (which Clerk's own docs confirm requires DNS control over a domain the user owns — not possible on a shared `vercel.app` subdomain) to a later phase.

### Database: migrated to the existing StayWhile Supabase project (not a new one)

Per ADR-0003, Supabase is production's intended database. User confirmed a StayWhile Supabase project already exists (workspace **StayWhileWithUs**, project **AdminStay's Project**) — investigated it directly (read-only) rather than assuming: confirmed empty (no `_prisma_migrations` table, zero rows in `information_schema.tables`) before touching anything. Ran a 3-phase migration, each phase explicitly approved before executing:

- **Phase 1 — schema**: `prisma migrate deploy` against Supabase. All 3 existing migrations applied (`20260804150049_init`, `20260805172538_add_ai_action_approval_framework`, `20260811153801_add_cleaning_reschedule_tracking`), 25 tables created, verified empty immediately after.
- **Phase 2 — export**: filtered, explicit-column `\copy` export from local `staywhile_dev` into a new gitignored `.migration-exports/` directory (verified ignored via `git check-ignore` before any file was written; `.gitignore` gained one new line, `/.migration-exports/`). Only the approved production dataset was exported, with every original UUID preserved (no re-seed, no regeneration): 75 permissions, 6 roles, 118 role_permissions, 1 user (`admin@stayawhilewithus.com` only), 1 user_role (its global `admin` assignment), 7 real properties (excluding `DEMO-001`/`DEMO-002`), 12 real smart devices (7 August + 5 Cielo).
- **Phase 3 — import**: same fixed CSV snapshot imported into Supabase in FK-dependency order. Verified row-for-row afterward: counts matched exactly (75/6/118/1/1/7/12), `admin@stayawhilewithus.com` is `ACTIVE` with the global `admin` role, 0 `DEMO-%` properties, 0 rows for the 7206 device or the excluded August bridge, all 12 smart devices resolve to one of the 7 real properties (0 orphans), every non-approved operational table (`guests`, `reservations`, `tasks`, `cleaning_schedules`, `maintenance_requests`, `messages`, `notifications`, `audit_logs`, `ai_*`, `integration_*`, `workflow_executions`) confirmed still empty, and local `staywhile_dev`'s own counts confirmed unchanged throughout (nothing was ever written back to local).

**Explicitly and deliberately not migrated**: `ryskris0@gmail.com` (stays dev-only, per user decision), `DEMO-001`/`DEMO-002` and everything that existed only because of them (100% of local `reservations`/`guests`/`tasks`/`cleaning_schedules`/`maintenance_requests`/`message_threads` were confirmed demo-only before this decision, via FK linkage, not assumed), and all local `audit_logs` (production's audit trail starts clean at cutover).

**New credential file**: `.env.supabase-migration.local` (repo root, gitignored) holds `STAYWHILE_SUPABASE_DATABASE_URL` (transaction pooler, port 6543) and `STAYWHILE_SUPABASE_DIRECT_URL` (session pooler, port 5432) — real, verified-working values, kept separate from the app's own `DATABASE_URL`/`DIRECT_URL` so they can never be picked up accidentally. Values were never printed/logged this session; two formatting bugs (missing closing quote, same class as the earlier Cielo credential bug) were fixed via blind line-append, same technique as before.

**Real infra finding**: this machine's home Wi-Fi silently drops outbound TCP to Supabase's Postgres ports (5432 and 6543) — confirmed via bounded DNS+TCP diagnostics (DNS resolves; neither port connects). A phone hotspot connection reaches both fine. Anyone doing further direct DB work against this Supabase project from this location needs to be off that Wi-Fi (hotspot or a fixed network config) — not a Supabase or credential problem.

### Vercel: pointed at Supabase, same existing project and URL

User reversed an earlier plan to rename the Vercel project — kept the existing project name (`stayawhilewithus-website`) and its existing free alias `https://stayawhilewithus-website.vercel.app` rather than purchasing a domain or renaming. Confirmed (via GitHub's Deployments API, deployment SHAs matching local commit history) this is the correct, already-connected StayWhile Vercel project, with a working Supabase integration already installed at the Vercel-team level whose project reference the user manually confirmed matches the migrated Supabase project.

Applied by the user directly via the Vercel dashboard (no Vercel API/CLI credential was ever available or used this session — an accidental `vercel whoami` early on triggered an interactive OAuth device flow that was deliberately left incomplete, never logged in): `DATABASE_URL` → Supabase transaction pooler, `DIRECT_URL` → Supabase session pooler, `NEXT_PUBLIC_APP_URL` → `https://stayawhilewithus-website.vercel.app`. Redeployed. Verified read-only afterward: `/sign-in` returns `200`; Supabase independently re-confirmed (over the hotspot) to hold exactly 7 properties/0 demo/12 smart devices/admin `ACTIVE` with global admin role. Note for future sessions: a manual "Redeploy" from Vercel's own dashboard does not create a new entry in GitHub's Deployments API (no new git push occurred) — a missing new deployment record there is expected and is not evidence the GitHub↔Vercel integration broke.

### Clerk: testing-phase plan handed to user, application not yet confirmed

Decision: keep the existing Clerk **Development** instance (`adjusted-seahorse-68`) — no second Clerk app. Checklist given to the user (dashboard-only changes, no Clerk API/CLI access was used or available for these specific settings):

1. Disable the **Password** authentication strategy (email-code first factor is already enabled and required — no change needed there).
2. Set sign-up mode to **Restricted** (was `"public"`).
3. Add `https://stayawhilewithus-website.vercel.app` as an allowed origin (was unset/`null`).
4. Add a webhook at `https://stayawhilewithus-website.vercel.app/api/webhooks/clerk`, subscribed to exactly `user.created`/`user.updated`/`user.deleted` (confirmed these are the only 3 events `apps/website/src/platform/identity/sync-clerk-user.ts` actually handles — read from the code, not guessed).
5. Copy the webhook's signing secret into Vercel's `CLERK_WEBHOOK_SIGNING_SECRET` (Production), redeploy.

**As of this note, it is not yet confirmed whether the user has applied this checklist.** Do not assume it's done in a future session — check.

### Explicit acceptance gate for this testing phase (standing instruction — read this before doing anything further)

The dashboard may only be declared **"Ready for Michelle and Kenny to test"** after every one of these is verified — and anything requiring a real browser/inbox (email-code login, logout) must be manually confirmed by the user, never assumed or claimed passed on the assistant's behalf:

- `https://stayawhilewithus-website.vercel.app/sign-in` loads
- Email one-time-code login works (**manual, user-confirmed**)
- `admin@stayawhilewithus.com` has unrestricted global admin access
- 7 real properties are visible
- 12 real smart devices are visible
- No `DEMO` properties appear
- Logout works (**manual, user-confirmed**)
- OwnerRez remains read-only
- Notion remains read-only
- No other client's environment (Supabase/Vercel/Clerk/database/local server) was inspected, modified, stopped, connected, or affected

**Until every item above is verified, and the user has explicitly said the gate is satisfied, do not say anything is "ready."** Once it is: the exact required phrase is **"Ready for Michelle and Kenny to test."** After that phrase is said, **stop** — do not start new feature work, property mappings, OwnerRez/Notion sync, write functionality, Supabase data changes, or further Vercel/Clerk changes, and do not act on any assumption about what Michelle or Kenny will want — wait for the user to relay their actual feedback first.

### Isolation, reconfirmed throughout this session

Every step was scoped to the one confirmed StayWhile Supabase project, the one confirmed StayWhile Vercel project, and the one confirmed StayWhile Clerk Development instance. A dedicated repo-scoped environment-isolation audit was run before any migration work (local DB name/source, shell env override risk, repo-local mechanisms that could point at a shared database) — nothing found. No other client's Supabase, Vercel, Clerk, database, repository, or running local server was inspected, connected to, or modified at any point.

---

## Increment 24 — 2026-08-18: two real production bugs found and fixed via live testing, admin@stayawhilewithus.com invited, ryskris0@gmail.com set up as second global admin, Locks drill-down page added

Continuation of Increment 23's cutover, driven by actually testing the live production login rather than assuming the earlier work was sufficient — both bugs below were only found because real sign-in attempts were made, not by code review.

### Bug 1 — Prisma query engine missing from the Vercel serverless bundle (fixed, committed, deployed)

First real production sign-in attempt (`ryskris0@gmail.com`) crashed with Next.js's generic "Application error" page. Vercel's own runtime logs (checked by the user, not assumed) showed the real cause: `PrismaClientInitializationError: ... could not locate the Query Engine for runtime "rhel-openssl-3.0.x"`. Root-caused precisely: `apps/website/package.json` depends only on `@stayw/database` (a sibling workspace package), never on `@prisma/client` directly — with pnpm's non-hoisted `node_modules`, Next.js's build-time file tracer failed to detect and bundle the Prisma-generated native query engine binary, which lives deep in the root `.pnpm` virtual store. Reproduced locally before touching anything (a clean build's `.next/server` output had zero references to the engine binary in any `.nft.json` trace file, and the binary itself was physically absent) — then fixed with Prisma's own documented minimal fix: added `@prisma/nextjs-monorepo-workaround-plugin` (pinned to `6.19.3`, the exact resolved `prisma`/`@prisma/client` version confirmed from `pnpm-lock.yaml`, matching Vercel's own error output — not the outdated `^6.1.0` range in `package.json`) as a devDependency of `apps/website`, and wired `PrismaPlugin()` into `next.config.js`'s server-side webpack config. One incidental fix: this repo's `no-require-imports` ESLint rule fired on Prisma's own documented `require()` usage in the CommonJS `next.config.js` — resolved with a single targeted inline disable comment, not a rule change. Verified before deploying: same before/after trace-file check, now showing the engine binary referenced in 22+ `.nft.json` files and physically present in `.next/server/chunks/`. Full monorepo `lint typecheck test build --force` green, 25/25. Committed as a single 3-file commit (`next.config.js`, `package.json`, `pnpm-lock.yaml` only — every other pre-existing uncommitted file deliberately excluded), pushed to `main`, auto-deployed by Vercel. Confirmed fixed by a real second sign-in attempt succeeding.

### Bug 2 — Prisma + Supabase transaction-pooler prepared-statement conflict (fixed, Vercel env only, no code change)

Retrying the RBAC bootstrap (`packages/database/scripts/grant-role.ts` against production Supabase) failed with Postgres error `42P05: prepared statement "s0" already exists` — the well-documented Prisma-vs-Supavisor-transaction-mode-pooler incompatibility (Prisma's prepared statements aren't supported by pgbouncer transaction mode without `?pgbouncer=true`). Confirmed nothing had been written before fixing (full read-only recheck of `users`/`user_roles`/`properties`/`smart_devices` counts, all unchanged). Fixed by appending `?pgbouncer=true&connection_limit=1` to the **`DATABASE_URL`** value only (transaction pooler, port 6543) in Vercel's Production env and in `.env.supabase-migration.local`'s `STAYWHILE_SUPABASE_DATABASE_URL` — `DIRECT_URL` (session pooler, port 5432) deliberately left untouched, since it doesn't hit this issue. Verified with a real read-only Prisma query through the qualified URL before retrying anything. `grant-role.ts` retry succeeded on the first attempt afterward.

### Admin accounts

- **`admin@stayawhilewithus.com`**: real Clerk invitation sent (via the Backend API, mirroring the app's own `createClerkInvitation()` call exactly). Not yet accepted as of this note — check current state before assuming otherwise.
- **`ryskris0@gmail.com`** (the user's own personal testing account, already had a real Clerk identity from earlier local-dev sessions): signed in for real through the production app's normal email-code flow (no invitation needed — Clerk's Restricted/invite-only mode only gates new sign-_up_, not sign-_in_ for an existing account, confirmed against Clerk's own docs before relying on this). JIT-provisioned exactly one Supabase `User` row, zero duplicates. Initially had zero RBAC roles (expected — authentication and authorization are deliberately separate in this app); granted the existing global `admin` role via `grant-role.ts` (Bug 2 above blocked the first attempt) — verified afterward: exactly one global `admin` `UserRole`, `property_id` null, `status ACTIVE`. `admin@stayawhilewithus.com`'s own row/role confirmed untouched throughout both admin-setup threads.

### New: `/locks` drill-down page

User requested a dedicated Locks page for the client-testing/feedback phase, in addition to (not replacing) the existing homepage August-lock summary. Added `apps/website/app/(dashboard)/locks/page.tsx` + `apps/website/src/domains/smart-devices/components/LocksList.tsx`, using the **exact same** `listSmartDevices()` service call and `isLowBattery`/`getBatteryLevel`/`isDemoSmartDevice` helpers the homepage already uses — no second data source, no change to August sync/mapping logic, no new RBAC permission (reuses the existing `smart_devices:read` check already inside `listSmartDevices()`). Nav item added under Operations, after Properties (`packages/ui/src/components/Sidebar.tsx` gained a `lock` icon key; `apps/website/src/platform/layout/nav-config.ts` gained the route). Shows summary metrics (Total/Online/Offline/Low battery) + a per-lock table (Property, Lock name, Status, Battery %, Offline/Low-battery/Both warning badges, Provider, Last synced) — `lastSeenAt` rendered as `—` when null (offline locks), no invented fallback timestamp. Verified against real production data: exactly 7 real August locks, 0 demo rows, matches the homepage's own device counts exactly. Homepage (`DashboardSummary.tsx`/`dashboard.service.ts`) deliberately untouched — confirmed via `git status` showing zero modifications to either file — so the original client-requested homepage sections (August lock summary with offline/low-battery/both distinction, Thermostats summary, Today's Arrivals & Departures, Coming Up, Rescheduled Cleanings, Notion/OwnerRez read-only visibility, ADR/Revenue kept off the homepage) are all still exactly as they were. Full monorepo verification green, 25/25. **Not committed/pushed — waiting for user approval.**

### Standing acceptance gate — still not cleared as of this note

The dashboard still cannot be declared "Ready for Michelle and Kenny to test" — `admin@stayawhilewithus.com` hasn't completed its own invitation/login yet, and a full click-through (real email-code login + logout, both user-confirmed, not assumed) hasn't happened since the two bug fixes above landed. See Increment 23's full gate checklist — it still applies unchanged. Do not say the "ready" phrase until every item on it passes.

**Update, same session**: the `/locks` page above was subsequently committed (`5110dfc`) and pushed to `main`, auto-deployed by Vercel, and re-verified — 7 real August locks, 0 demo, matching Supabase directly. No longer "pending approval."

---

## Increment 25 — 2026-08-18 (same day, continued): Integration Sync Controls — client requirement captured, architecture proposed, nothing implemented

New client requirement, relayed by the user: Michelle/Kenny want dashboard data to stay updated automatically, plus a manual "Sync Now" they can trigger anytime, for August, Cielo, OwnerRez, and Notion. Explicitly investigation/planning only this pass — no code written.

**Real discovery, not assumed**: manual sync already exists and works today for August/Cielo — `/integrations`'s `syncAugustDevicesAction()`/`syncCieloDevicesAction()` already call the real sync functions and log outcomes via `recordIntegrationSync()` (updates `IntegrationConnection.lastSyncedAt` on success, logs `IntegrationSyncLog` either way, already shows "Last synced {time}" in the UI). OwnerRez/Notion have no equivalent — both are pure live-read-on-page-render (`getOwnerRezHighlights()`/`getNotionHighlights()`) with no sync/log/button concept at all.

**n8n status, re-checked this session**: MCP not connected (only IFTTT/Slack; n8n needs re-registration, same recurring pattern noted every session in this doc). Per `N8N_DISCOVERY.md` (last live-verified 2026-08-06, not re-confirmed live this pass) and this app's own code, n8n has zero real workflows and — critically — **zero August/Cielo/OwnerRez/Notion credentials**; those only exist in this app's own env vars. n8n cannot run these syncs itself today without credential duplication.

**Two real, concrete gaps found in the existing manual-sync pattern** (relevant to any future implementation):

1. No duplicate-sync prevention — `IntegrationSyncLog.status`'s schema already has a `RUNNING` value and defaults to it, but current code never actually writes a `RUNNING` row at sync start, only `SUCCEEDED`/`FAILED` after the fact. Two rapid clicks (or two people) can run the same sync concurrently today.
2. `AuthContext` (`packages/auth/src/rbac.ts`) is strictly `{ userId: string }`, tied to a real signed-in `User` — there is no "system" actor. A scheduled/automatic sync (no human clicking) cannot call `assertPermission()` the way manual sync does; it needs a different trust model (recommended: HMAC-signature verification, mirroring the already-existing `/api/webhooks/n8n` inbound route, not an RBAC bypass).

**Proposed architecture** (full detail + reasoning given to the user in chat, not duplicated in full here):

- n8n as scheduler/clock only (native Schedule Trigger → calls a new authenticated inbound app endpoint); app does the actual sync with credentials it already has, reusing existing sync functions. **Flagged as a real open decision, not chosen unilaterally**: Vercel Cron could do the same job without n8n at all, since n8n is otherwise unused — user needs to pick.
- New `IntegrationConnection` columns: `autoSyncEnabled Boolean @default(false)`, `syncFrequencyMinutes Int?` — additive migration, not yet written.
- Duplicate-prevention: write `RUNNING` at sync start, check for an existing `RUNNING` row before starting another.
- Failure handling: extend the existing August/Cielo failure pattern (log `FAILED`, don't touch `lastSyncedAt`, notify admins reusing the `triggerWorkflow()`-failure notification pattern) to OwnerRez/Notion and scheduled runs.
- Permissions: **no new permission needed** — `integrations:update`/`smart_devices:update` already exist and already cover exactly this (confirmed both `admin` and `ops_manager` already hold them in `seed.ts`).
- Rate limits/frequency choices: **not documented anywhere in this repo** (checked all 4 providers' READMEs) — genuine external research needed before picking any interval; explicitly not guessed at, per the user's own instruction.
- UI: `/integrations` gains ON/OFF + frequency controls and Sync Now for OwnerRez/Notion; `/locks` gains a Sync Now button + Last synced line (wiring to the already-existing August sync action). A future Thermostats detail page is out of scope for now (only the homepage tile + `/locks`-equivalent don't exist yet for Cielo) — flagged, not built.

**Explicitly not touched**: OwnerRez/Notion remain strictly read-only (no write path proposed or added), August/Cielo's write capability isn't expanded, no schema/permission change has actually been made yet (the migration above is proposed, not applied), current Michelle/Kenny acceptance-gate priorities are unaffected by this planning work.

**Waiting on the user** to approve the proposed architecture (and decide the n8n-vs-Vercel-Cron scheduling question) before any implementation begins.

### Update — same day: sync-control research finalized; Michelle's production-access blocker found and resolved

Real research replaced the earlier placeholder intervals: **Notion** (official ~3 req/s, [developers.notion.com/reference/request-limits](https://developers.notion.com/reference/request-limits)), **OwnerRez** (official 300 req/5min, [ownerrez.com/support/articles/api-rate-limiting](https://www.ownerrez.com/support/articles/api-rate-limiting)), **Cielo** (no official limit; community reference integration defaults to ~120s), **August** (no official limit, real evidence of throttling under aggressive polling — [home-assistant/core#31472](https://github.com/home-assistant/core/issues/31472)). Proposed minimums: OwnerRez 5min < Cielo 10min < Notion 15min < August 30min (most-permissive to most-conservative, driven by the evidence above, not a single universal interval).

**Vercel confirmed Hobby plan** — its Cron only supports once-per-day scheduling ([vercel.com/docs/cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)), ruling out Vercel Cron for this feature entirely. Architecture revised: **n8n is the scheduler instead**, via a fixed-cadence Schedule Trigger ("heartbeat") calling a new HMAC-signed inbound route (`/api/webhooks/n8n-sync`, reusing the existing `N8N_INBOUND_WEBHOOK_SHARED_SECRET`/`verifySignature()` — no new crypto), which itself decides which providers are actually due based on their stored `syncFrequencyMinutes`/`lastSyncedAt` — admin frequency changes take effect without touching n8n. **New unknown found, not yet resolved**: n8n Cloud plans have their own execution-count budgets (e.g. Starter ≈2,500/month) which could make a naive 5-minute heartbeat too expensive — **the actual n8n Cloud plan/quota for this account needs the user's confirmation** before the exact heartbeat interval is finalized, same diligence as the Vercel plan check.

System-actor design (a real, dedicated `sync_service` User row + minimal role, never reachable via normal Clerk sign-in, tagged `actorType: "SYSTEM"` in audit logs) and the duplicate-run guard (partial unique index on `IntegrationSyncLog` limiting one `RUNNING` row per connection) carry forward unchanged from the Vercel-Cron version of the plan — only the trigger/authentication mechanism changed.

**Separately, a real production blocker was found and fixed**: Michelle reported never receiving the `admin@stayawhilewithus.com` Clerk invitation and hit "New sign-ups are restricted" after trying to self-register directly (expected behavior for Restricted mode without an invitation link — not a bug). Investigated live before acting: no Clerk User existed yet for that email, the original invitation (`inv_3I3EEePCy8i4Yuvm8tKzMBUiEyp`) was still `pending`/not expired but evidently never delivered or found, and the Supabase row was confirmed fully intact (`ACTIVE`, global `admin`, no property restriction) throughout. Resolved via Clerk's own officially-documented resend pattern (revoke the stale invitation, create a fresh one — verified this is the documented mechanism before using it, per [createInvitation() — Clerk Docs](https://clerk.com/docs/reference/backend/invitations/create-invitation)'s `ignore_existing` behavior). New invitation `inv_3I3dZpH0IlKwlw0Av3W1qzJd5B2` is pending as of this note. Verified after: still zero Clerk users for this email, still exactly one pending invitation, sign-up mode still `restricted` — nothing else touched. **Michelle still needs to check her inbox (including spam) for the new email and use the link in it directly, not the sign-in page** — this is not yet fully resolved until she completes that step and a real login/logout/login round trip is verified.

**This blocker is explicitly part of the Michelle/Kenny acceptance gate** — the gate cannot pass while `admin@stayawhilewithus.com` itself can't log in. Not resolved yet as of this note; check current state before assuming otherwise. **Update, same day**: the resend is complete (Clerk-side); **the gate stays open until Michelle confirms she received the new invitation and successfully activated/logged in** — do not assume this is done without that confirmation.

**n8n scheduling explicitly paused**: n8n Cloud trial expired; Michelle/Kenny informed of the required $24/month upgrade. Do not build or activate production n8n scheduling until they confirm the upgrade — continue non-n8n-dependent work in the meantime (this is what the increment below does).

---

## Increment 26 — 2026-08-18 (same day, continued): Michelle's second feedback pass — two presentation fixes shipped, three investigations completed, nothing else implemented

New feedback from Michelle after reviewing the live dashboard, five threads. n8n-dependent work (sync-control scheduling) stays paused per the upgrade-pending note above; everything below is explicitly non-n8n-dependent, per the user's own prioritization.

### 1. "Departures" → "Check-outs" — shipped, presentation-only

Confirmed presentation-only before touching anything: `departuresToday`/`summary.departuresToday` (variable names, `dashboard.service.ts` computation) are completely unchanged — only visible UI text changed, in `apps/website/src/domains/dashboard/components/DashboardSummary.tsx`: the "Departures today" metric tile → "Check-outs today", the "Today's Arrivals & Departures" section header → "Today's Check-ins & Check-outs", the "Departing today" column heading → "Checking out today", the "No departures today." empty state → "No check-outs today." (`/reservations`' own "Upcoming check-outs" section was already correctly worded — no change needed there). Full suite green (25/25).

### 2. Rescheduled Cleanings — real bug found and fixed, not just cosmetic

Investigated precisely rather than guessing: the section was **conditionally rendered** — `{summary.recentlyRescheduledCleanings.length > 0 && (...)}` wrapped the entire block including its own header, so at zero records the whole section (header included) simply didn't exist in the DOM. This exactly matches Michelle's report — not hidden, not broken data, just designed to disappear at zero, which is exactly what production's current state triggers (0 rescheduled cleanings migrated to Supabase — the one demo rescheduled-cleaning row from local dev was tied to `DEMO-001` and deliberately excluded from the production migration). Confirmed the underlying data source (`listRecentlyRescheduledCleanings(actor)`) is real, not fabricated, before changing anything. Fixed by always rendering the header, with a plain-text empty state ("No rescheduled cleanings.") when the list is empty — mirroring the exact same pattern this file already uses for "Important Tasks" right above it, for visual consistency. Full suite green (25/25).

### 3. Thermostat provider expansion (Cielo + Nest + Honeywell + Ecobee) — investigated, not implemented

**How provider-neutral the existing model already is**: quite neutral at the data/UI layer already — `SmartDeviceProvider` (Prisma enum) **already includes `HONEYWELL`** alongside `YALE`/`AUGUST`/`NEST`/`ECOBEE`/`CIELO` (schema was forward-designed for this), and the homepage's Thermostats tile groups by `deviceType === "THERMOSTAT"` — provider-agnostic by construction, already correctly summing across every connected thermostat provider without any dashboard code change needed once more providers sync real rows. The gap is entirely at the **integration** layer: `IntegrationProvider` enum has no `HONEYWELL` value at all, and there is no `packages/integrations/src/honeywell/` package (Nest and Ecobee already have structural stub packages; Honeywell has neither).

**Per-provider access/API findings** (real research, not assumed):

- **Nest**: official Google Smart Device Management (SDM) API exists, but requires a **mandatory one-time $5 paid registration** in Google's Device Access Console — a real-money action, not just a missing credential (documented in this package's own README from an earlier session).
- **Ecobee**: official API exists, but auth is a **PIN-based OAuth2 flow** (authorize → PIN → poll for token → refresh) rather than a static key — needs a token-storage/refresh design decision before real code, same complexity class as Gmail (documented in this package's own README from an earlier session).
- **Honeywell**: official API exists via Resideo's developer portal (`developer.honeywellhome.com`), OAuth2-based (authorization code + client credentials flows), but **developer access requires registration/vetting**, not an instant self-serve key — exact requirements/costs need direct confirmation on Resideo's site before implementation. [Resideo Developer Site](https://developer.honeywellhome.com/)

No credentials requested, no new provider code written, no `IntegrationProvider` enum change made — investigation only, per instruction. A future `/thermostats` detail page (mirroring `/locks`) would trivially show provider per-row once any of these are real, since `SmartDevice.provider` already exists as a field.

### 4. August lock completeness — answered with real, current evidence, not inference

Ran the existing read-only `packages/integrations/src/august/scripts/check.ts` against the live, currently-valid August credentials (token still valid, confirmed working) rather than just describing the code. **Result: the connected August account has exactly 7 locks total, right now** — same 7 lock IDs and same 4 houseIds already present in `AUGUST_PROPERTY_MAP` (Island Tides, Bonjour AMI ×2, Miramar Bliss ×2, Aqua Palm). Zero additional locks, zero additional houseIds beyond what's already mapped and synced. Confirmed from the client code (`GET /users/locks/mine` — "every lock the account has access to," no additional server-side filtering) that this is genuinely the account's complete inventory as returned by August's own API, not a subset silently filtered by StayWhile's own mapping logic. **Conclusion for the client**: these 7 locks are everything currently accessible through the connected credentials — if more locks exist, they belong to a different August account/login not currently connected, and Kenny/Michelle would need to either add those locks to the same connected account, or provide separate credentials for whichever account holds them (the current integration supports exactly one account's credentials, no multi-account support exists).

### 5. n8n

Untouched, as instructed — still paused pending the $24/month upgrade decision.

### Verification

Full monorepo `lint typecheck test build --force` — **25/25 tasks, 0 errors**, both presentation fixes included. Committed (`086c577`, one file only) and pushed same day — see the update below.

### Update — same day: deployed and verified; full status/architecture review completed; no other changes

- **Departures → Check-outs and the Rescheduled Cleanings fix are live in production** — commit `086c577`, deployment `5951237249` succeeded, `/sign-in` and `/api/health` confirmed healthy post-deploy.
- **Michelle will continue testing tomorrow** — current status, not yet re-confirmed as passing.
- **August**: still exactly 7 locks on the connected account (re-confirmed unchanged) — waiting on Michelle to confirm whether they expect more; if so, a different August login holds them, not a mapping gap in this integration.
- **Thermostat scope now explicitly includes Cielo + Nest + Honeywell + Ecobee** per Michelle. Only Cielo is connected/real (5 live rows). Nest/Honeywell/Ecobee are **not connected** — full requirements researched this pass (see below), nothing implemented, no credentials requested.
- **n8n Cloud trial expired, workflows paused.** Client informed of the required $24/month upgrade. **All automatic-sync/scheduling implementation stays paused** until they confirm the upgrade — this applies to the entire Integration Sync Controls plan from earlier increments, not just new work.

**Thermostat provider requirements researched** (real findings, sources cited in chat, not just repo inspection):

- **Nest**: Google Smart Device Management API. Requires a **mandatory one-time $5** Device Access Console registration (a real-money decision, not just a credential). OAuth2, standard authorization-code flow. Data available: connectivity (online/offline), current temperature, humidity, HVAC mode, fan status. Supports **both** real-time push (Cloud Pub/Sub) and plain polling.
- **Ecobee**: official API, but **PIN-based OAuth2** (app requests a PIN → owner enters it in their Ecobee account → app polls for the token) — not a standard redirect flow, no token-storage/refresh design exists yet (same complexity class as Gmail, already flagged in an earlier increment). Polling only. Data available: connected status, actual temperature, equipment running status, HVAC mode.
- **Honeywell (Resideo)**: official OAuth2 API exists (`developer.honeywellhome.com`), but developer access is **vetted/reviewed**, not instant self-serve — exact criteria need direct confirmation during actual implementation. Polling only. Data available: same general shape (online/offline, temperature, mode).
- All three need a **developer/project registration step**, not just an account password from Michelle/Kenny — worth deciding who registers (likely StayWhile's own side) before any credentials are requested from the client.

**Full homepage architecture reviewed against the original client requirements, classified honestly** (production data re-checked fresh, not assumed):

| Requirement           | Status                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| August lock summary   | 🟢 LIVE — 7 real rows                                                                                                                                                                      |
| Thermostat summary    | 🟢 LIVE for Cielo (5 real rows) — 🔴 NOT CONNECTED for Nest/Honeywell/Ecobee (tile is already provider-neutral, will absorb them automatically once real rows exist)                       |
| Today's check-ins     | 🟡 IMPLEMENTED, WAITING FOR DATA — production has **0 reservations** (confirmed fresh)                                                                                                     |
| Today's check-outs    | 🟡 IMPLEMENTED, WAITING FOR DATA — same                                                                                                                                                    |
| Rescheduled cleanings | 🟡 IMPLEMENTED, WAITING FOR DATA — production has **0 cleaning_schedules** (confirmed fresh) — this is _why_ Michelle couldn't find it before the visibility fix, not just a rendering bug |

**Root cause of the "waiting for data" tier**: none of `reservations`/`guests`/`cleaning_schedules`/`tasks`/`maintenance_requests` were migrated to production (they were 100% demo-linked at migration time, correctly excluded per an earlier explicit decision) — and OwnerRez's client only fetches read-only display "highlights," it does not write into `Reservation`/`Guest` by original design (that mapping was deliberately deferred, pending exact-reads/mappings/writes approval per the standing OwnerRez safety rule). These sections will stay empty until real reservations/cleanings exist through the app itself, or a real OwnerRez→`Reservation` sync gets explicitly designed and approved.

**OwnerRez/Notion**: re-confirmed strictly read-only at the code level, nothing added. **One unresolved unknown**: `OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN`/`NOTION_API_KEY` were verified working locally (Increment 22) but their presence in **Vercel's Production** env vars has never been directly confirmed (no Vercel dashboard access) — asked the user to check.

Nothing committed this pass beyond what's noted above (the deploy was already covered by the prior increment's commit). No migration, credential, or configuration change. No new integration code.

---

## Increment 27 — 2026-08-18 (same day, continued): Thermostat provider expansion (Nest/Honeywell/Ecobee) — full architecture investigation, nothing implemented

User asked for a deep investigation-only pass (explicitly: investigate first, do not implement) into adding Nest, Honeywell, and Ecobee thermostats alongside the already-live Cielo integration, ahead of a homepage unified-thermostat-summary redesign and a new `/thermostats` drill-down page. Supersedes Increment 26 §3's investigation with verified-current code state (via a dedicated read-only Explore pass) and fresh official-documentation research (not just carried-forward prior notes) — one real correction to Increment 26's Honeywell finding surfaced below.

### Current architecture (verified directly against code, not assumed from prior notes)

- **`SmartDeviceProvider` enum already has `HONEYWELL`** (alongside `YALE`/`AUGUST`/`NEST`/`ECOBEE`/`CIELO`) — no migration needed at the device-data layer for any of the three target providers.
- **`IntegrationProvider` enum is missing `HONEYWELL`** (has `NEST`/`ECOBEE` already) — confirmed via direct read of `schema.prisma`. This is the one real schema gap.
- `SmartDeviceType.THERMOSTAT` and the dashboard's Locks/Thermostats KPI tiles already group by `deviceType`, not `provider` — confirmed **fully provider-agnostic already**: a Nest/Honeywell/Ecobee row with `deviceType: "THERMOSTAT"` sums into the existing Thermostats tile with **zero dashboard code change**.
- `packages/integrations/src/nest/` and `.../ecobee/` exist as structural stubs (every method throws `NotImplementedError`; `NestCredentials`/`EcobeeCredentials` are placeholder `{apiKey}` shapes that don't match either provider's real auth). `packages/integrations/src/honeywell/` **does not exist at all** — confirmed via repo-scoped grep, zero source hits for "honeywell"/"resideo" anywhere in `packages/` or `apps/` besides the schema enum value itself.
- Every real/stub provider client implements the same `BaseIntegrationClient` (+ `SyncCapable`/`WebhookReceivable`) contract in `packages/integrations/src/core/types.ts` — a Honeywell client would follow this exact shape from scratch; Nest/Ecobee already have the file skeletons, just no real method bodies.
- `smart-devices.service.ts` has `syncAugustDevices()`/`syncCieloDevices()` only — same upsert/`*_PROPERTY_MAP`/`pruneStaleDevices` pattern, gated on the already-existing `smart_devices:update` permission (RBAC needs no changes — `smart_devices:*`/`integrations:*` keys already exist for every resource by construction, `admin` and `ops_manager` already hold the relevant ones).
- `/locks` (`app/(dashboard)/locks/page.tsx` + `LocksList.tsx`) is the exact template a `/thermostats` page would mirror — same `listSmartDevices()` call filtered by `deviceType`, same summary-tiles-plus-table shape. No `/thermostats` nav entry exists yet; `Sidebar.tsx`'s `NAV_ICONS` map has no `thermometer` key yet either (would need adding — `Thermometer` is already imported/used in `DashboardSummary.tsx` but not registered as a nav icon).
- No provider credentials (including today's real Cielo/August ones) are declared in `env.ts`'s Zod schema — all read ad hoc via `process.env` in the relevant service function, documented only in `.env.example`. A new provider would follow this same convention unless deliberately changed.
- No sync-frequency/schedule field exists anywhere in the schema (consistent with Increment 25's finding) — any auto-sync stays dependent on the still-paused n8n plan.

### Per-provider requirements — refreshed from current official documentation (not just prior repo notes)

**Nest** (Google Smart Device Management API):

- **Mandatory one-time $5 fee**, non-refundable, per Device Access project — confirmed current. [Device Access Registration](https://developers.google.com/nest/device-access/registration)
- Standard OAuth2 authorization-code flow. Requires: a Device Access **project** (UUID), OAuth Client ID + Secret (from a separate Google Cloud project), and the Nest/Google account must be a **consumer Google account** (`gmail.com`) — Google Workspace accounts aren't supported, and the linked account can't be changed after project creation. [Get Started](https://developers.google.com/nest/device-access/get-started)
- Readable thermostat fields: ambient temperature, humidity, connectivity (online/offline), mode + available modes, heat/cool setpoints, HVAC running state, fan timer state, eco mode. [SDM API](https://developers.google.com/nest/device-access/api)
- Rate limits (confirmed exact): reads (`devices.get`) 10 QPM per project/user; commands 10 QPM per project/user, 5 QPM per project/user/device (thermostats specifically: 5 QPM or 100 QPH at the device-instance level, shared across all projects touching that device). Reads are the only thing a dashboard sync needs — 10 QPM is generous for polling. [User and Rate Limits](https://developers.google.com/nest/device-access/project/limits)
- **Requires a real Google-account authorization step from whoever owns the Nest devices** (Michelle/Kenny or whoever the Nest account belongs to) — the OAuth consent screen must be completed by that account's owner, same class of human-in-the-loop step August's 2FA code was.

**Ecobee**:

- No paid registration — sign in to the Ecobee developer portal, enable developer access, create an app with **"ecobee PIN"** as the authorization method to get an API key. [ecobee API docs](https://www.ecobee.com/home/developer/api/documentation/v1/auth/pin-api-authorization.shtml)
- **PIN-based OAuth2**, not a redirect flow: app requests a PIN (`GET /authorize?response_type=ecobeePin`) → PIN shown to the user → **the Ecobee account owner logs into their own Ecobee web portal and enters the PIN** within its expiry window → app polls `/token` for `access_token`/`refresh_token`. Access tokens expire in ~1 hour (`expires_in: 3599`); refresh tokens must be stored and rotated — this is the token-storage/refresh design the existing stub README already flagged as unbuilt.
- Readable fields (confirmed field-level): `runtime.actualTemperature`, `runtime.actualHumidity`, `runtime.desiredHeat`/`desiredCool` (target setpoints), `runtime.connected` (**explicit boolean online/offline field** — this exists, contrary to earlier uncertainty), `equipmentStatus` (CSV of running equipment: heat pump, compressor, aux heat, fan, humidifier, etc.), plus `modelNumber`/`brand`/`name`.
- Rate limit: confirmed a limit exists (HTTP 429 on excess) but the exact requests/minute threshold is not published in the docs surfaced — worth a direct check with Ecobee support or conservative polling (e.g. 15 min, matching the interval already proposed in Increment 25's sync-controls plan) rather than guessing a number.
- **Requires the Ecobee account owner to complete the PIN-entry step themselves** — same human-in-the-loop shape as Nest's OAuth consent and August's 2FA.

**Honeywell (Resideo)**:

- **Correction to Increment 26's note**: API key creation is **self-serve, not a vetted/reviewed application process** — sign up for an account, then create an API key directly at `developer.honeywellhome.com/user/me/apps/add`. No manual approval step is documented. [Resideo FAQ](https://developer.honeywellhome.com/faq-page)
- OAuth2 — the portal documents both an Authorization Code flow (`/authorize` + `/token`) and a Client Credentials flow (`/accesstoken`); which one applies depends on the exact integration type (personal vs. third-party), not yet pinned down at the level of an implementation plan.
- **A physical Honeywell/Resideo device is required to meaningfully use or even test the API** — there is no simulator. Model/region support beyond the base "Round" thermostat is **not publicly documented** — Resideo's own FAQ says as much and directs further questions to `developerinfo@resideo.com`. **This means Michelle/Kenny's exact Honeywell thermostat model needs confirming before assuming compatibility.**
- Rate limit (confirmed exact): "poll device status every 5 minutes for up to 20 devices per hour" — a real, documented ceiling; higher limits require contacting `HoneywellAPISupport@honeywellhome.com` with expected volume/business justification.
- Readable fields, per the listed endpoints (`GET /devices/thermostats/{deviceId}`, `.../fan`, `.../thermostatconfiguration`): the general shape is confirmed (temperature, setpoint, mode, fan) but the exact field-level JSON shape isn't published outside an authenticated account — would need to be confirmed once real credentials exist, not guessed at now.

### What to ask Michelle/Kenny for (none of this was requested yet — investigation only)

1. **Nest**: whose Google account the Nest thermostats are registered under, and that person's willingness to (a) approve the one-time $5 charge and (b) complete the OAuth consent screen once StayWhile's side is built.
2. **Ecobee**: whose Ecobee account the thermostats are on, and that person's willingness to complete the PIN-entry step in their own Ecobee portal when prompted.
3. **Honeywell**: the exact thermostat model(s) in use (Resideo's public docs only confirm the base "Round" model; anything else needs direct confirmation from Resideo) and account credentials once StayWhile's own developer API key exists.
4. For all three, same standing rule as August/Cielo/OwnerRez/Notion: **no device↔property mapping will be inferred from names** — discovered devices and proposed mappings will be shown for explicit confirmation before any `SmartDevice` row is written.

### Costs/approval requirements summary

| Provider  | Cost                        | Approval gate                                                                                                                          |
| --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Nest      | $5 one-time, non-refundable | Google Device Access Terms + Nest-account-owner OAuth consent                                                                          |
| Ecobee    | None                        | Ecobee-account-owner PIN entry (self-serve developer portal, no vetting)                                                               |
| Honeywell | None (self-serve key)       | None for the API key itself; device/model compatibility unconfirmed publicly — needs direct Resideo contact or a real device to verify |

### Exact code/schema changes recommended (not yet made)

1. Add `HONEYWELL` to the `IntegrationProvider` enum (additive migration) — `SmartDeviceProvider` already has it.
2. Add a `HONEYWELL` entry to `PROVIDER_DEFAULTS`/`PROVIDER_CLIENT_STATUS` in `apps/website/src/domains/integrations/services/integrations.service.ts`.
3. Create `packages/integrations/src/honeywell/` (client.ts/types.ts/README.md) as a structural stub first, matching the existing `BaseIntegrationClient` shape — mirrors how Nest/Ecobee already look before real implementation.
4. Real implementation per provider (only once credentials + the relevant human-in-the-loop step are available), each producing a `sync<Provider>Devices()` in `smart-devices.service.ts` following the August/Cielo upsert + `pruneStaleDevices` pattern for the device data itself — **but NOT the `*_PROPERTY_MAP` env-var mapping pattern.** **STALE as of 2026-08-19 — see the standing "Dynamic, Dashboard-Configurable Integrations" requirement near the top of this file.** Device↔property mapping for Nest/Honeywell/Ecobee (and any future provider) must be database-backed and dashboard-managed, not a new `*_PROPERTY_MAP` env var. This item's original wording (copy the exact August/Cielo pattern including mapping) is superseded; only the sync/upsert mechanics still apply.
5. New `/thermostats` page (`app/(dashboard)/thermostats/page.tsx` + a new `ThermostatsList.tsx` component) mirroring `/locks`/`LocksList.tsx` exactly — see design below.
6. New `thermometer` nav-icon key in `packages/ui/src/components/Sidebar.tsx`'s `NAV_ICONS`, plus a `/thermostats` entry in `nav-config.ts`.
7. Homepage (`DashboardSummary.tsx`/`dashboard.service.ts`): **no change needed** — already provider-agnostic. Optional-but-recommended: the "Needs Attention" list's icon logic (`d.deviceType === "LOCK" ? Lock : Thermometer`) already handles thermostats generically; if a per-provider label becomes desirable later, that's additive, not required for correctness.

### Proposed `/thermostats` page design (not built)

Mirrors `/locks` exactly: `PageHeader` + `MetricStrip` (Total, Online, Offline, Low battery-or-N/A) + a `Table` with columns **Property, Thermostat name, Provider, Status, Current temp, Target temp, Mode, Humidity, Last synced** — populated per-row only with fields the row's specific provider actually supports (Cielo today: name/status only, no temp/mode/humidity; Nest: temp/humidity/mode/connectivity; Ecobee: temp/humidity/mode/connectivity/equipment; Honeywell: temp/mode/connectivity at minimum, humidity unconfirmed) — blank/`—` for anything a given provider doesn't report, never a fabricated value. Provider column would need a display-name mapping (today's `LocksList.tsx` only special-cases `AUGUST`→"August" and prints the raw enum otherwise — worth fixing generically, e.g. `{CIELO:"Cielo",NEST:"Nest",ECOBEE:"Ecobee",HONEYWELL:"Honeywell"}`, when building this).

### Safe implementation order (recommended, not started)

1. Confirm the human-side facts above with Michelle/Kenny (account ownership, $5 approval, Honeywell model) — no code needed yet.
2. `IntegrationProvider` migration + `PROVIDER_DEFAULTS` entry for Honeywell (small, additive, safe to do independent of any credential).
3. Build `/thermostats` page + nav entry now, since it needs no new provider code — it would show Cielo's 5 real live thermostats today (proving the drill-down page works) while Nest/Honeywell/Ecobee stay absent until connected, same "don't pretend unconnected providers are live" honesty rule already used everywhere else in this app.
4. Real provider implementation one at a time, in whichever order credentials/approvals actually land (no dependency between the three) — each following the August/Cielo precedent: build the real client and stub-to-real service wiring first, verify with a read-only check script, only then request the property-mapping confirmation and run a real sync.

**Nothing implemented this pass** — no schema migration, no credential requested, no new integration code, no dashboard/nav change. Investigation and architecture proposal only, per explicit instruction. **Waiting for user approval before any implementation begins.**

---

## Increment 28 — 2026-08-18 (same day, continued): `/thermostats` page shipped — credential-independent dashboard UI only, real provider work still gated

User approved Increment 27's proposal for the dashboard UI slice only (explicitly not the real Nest/Honeywell/Ecobee provider work). Built exactly what was approved, nothing more.

### What was built

- **`apps/website/app/(dashboard)/thermostats/page.tsx`** (new) — near-identical to `/locks/page.tsx`: `getCurrentUser()` → `listSmartDevices(actor)` (same call, same `smart_devices:read` gate, **no second data source**) → filters `deviceType === "THERMOSTAT"` → renders `ThermostatsList`.
- **`apps/website/src/domains/smart-devices/components/ThermostatsList.tsx`** (new) — mirrors `LocksList.tsx`'s structure: `MetricStrip` (Total / Online / Offline only, per the approved spec — no battery tile, since thermostats don't report one) + a `Table` with exactly the approved columns: Property, Thermostat, Provider, Status, Current temp, Target temp, Mode, Humidity, Last synced. Every reading field renders `—` when the device's `metadata` doesn't carry it — never fabricated.
- **`smart-devices.service.ts`** gained 5 small additive exports: `getCurrentTemperature`/`getTargetTemperature`/`getMode`/`getHumidity` (read from `SmartDevice.metadata`, same pattern as the existing `getBatteryLevel` — all currently return `null` for every real row, since no sync function writes these fields yet; this is honest, not a bug) and `getProviderDisplayName` (a small `provider → display name` map covering all 6 `SmartDeviceProvider` values, falling back to the raw enum string for anything unmapped — used only by the new `ThermostatsList`, `LocksList.tsx`'s existing inline August-only ternary was left untouched, out of scope).
- **Nav**: `packages/ui/src/components/Sidebar.tsx` gained a `thermometer` key in `NAV_ICONS` (imports `Thermometer` from `lucide-react`); `nav-config.ts` gained `{ href: "/thermostats", label: "Thermostats", icon: "thermometer" }` in the Operations section, directly after Locks.
- **Homepage confirmed untouched**: `git status` shows zero modifications to `dashboard.service.ts` or `DashboardSummary.tsx` — the homepage Thermostats tile stays exactly as it was (provider-agnostic by construction already, per Increment 27's finding).

### Verification

- Full monorepo `pnpm turbo run lint typecheck test build --force` — **25/25 tasks, 0 errors**. Production build includes `/thermostats` in the route manifest with the same size profile as every other dashboard route (`2.32 kB`, matching `/locks` exactly).
- **Real data confirmed** via a throwaway read-only script (run against the local dev database — production Supabase wasn't reachable from this network this session, the same documented Wi-Fi-blocks-outbound-Postgres limitation from Increment 23; not a new issue, not code-related) — script created, run, deleted immediately, not committed: exactly **5 `THERMOSTAT` rows, all `CIELO`, all `demo=false`**, `groupBy` confirms the full table is `7 AUGUST/LOCK + 5 CIELO/THERMOSTAT` with **zero `NEST`/`HONEYWELL`/`ECOBEE`/`YALE` rows** — nothing shows as connected for the three unimplemented providers, matching the explicit requirement.
- Local dev server started on port 3001 (port 3000 confirmed still a different client's process, left untouched, same as every prior session's note), `curl /api/health` → `200`; `curl /thermostats` → `404`, **identical to `curl /locks` → `404`** — both hit the same pre-existing Clerk dev-browser-handshake limitation documented since Increment 22 (not a regression, not thermostats-specific). Dev server stopped after the check.

### Exact diff

Modified: `apps/website/src/domains/smart-devices/services/smart-devices.service.ts` (+52 lines, additive only), `apps/website/src/platform/layout/nav-config.ts` (+1 line), `packages/ui/src/components/Sidebar.tsx` (+2 lines). New: `apps/website/app/(dashboard)/thermostats/page.tsx` (21 lines), `apps/website/src/domains/smart-devices/components/ThermostatsList.tsx` (122 lines). Full diff shown to the user in chat this session, not duplicated here.

**Not committed or pushed — waiting for user approval**, per explicit instruction. No schema migration, no credential requested, no `IntegrationProvider` enum change, no Supabase/Vercel/Clerk/n8n change, no real Nest/Honeywell/Ecobee code.

### Standing note carried forward, unchanged

Nest, Honeywell, and Ecobee still require client-side account-owner authorization steps before any real integration, regardless of credential availability on the assistant's/user's side — see Increment 27's full findings and the dedicated cross-session memory (`project_thermostat_provider_expansion`). This increment did not touch that gate.

---

## Increment 29 — 2026-08-18 (same day, continued): Ecobee is BLOCKED (real external finding, not a coding issue) — correction to Increments 26/27; Honeywell/Resideo investigated fresh

User has StayWhile's own live login access to both the Ecobee and Honeywell/Resideo accounts (their access, their StayWhile-owned credentials — no other client's anything was touched). Worked Ecobee first per the user's instruction, hit a real external blocker, then moved to Honeywell per the user's redirection. **Nothing was implemented in the repo this increment** — investigation and one external-only action (a public, non-secret PIN-flow research check) only.

### Ecobee — CORRECTION: developer registration is closed, not self-serve

**Increments 26 and 27 were wrong on this point** — both stated Ecobee's developer access was "no fee, self-serve, no vetting." That was accurate historically but is **stale**: confirmed via fresh official-page checks today that **Ecobee stopped accepting new third-party developer registrations on 2024-03-28**, and it is still closed as of this session (2026-08-18). Ecobee's own developer page states directly: _"Sorry, we are not currently accepting new developer registrations at this time"_ ([ecobee.com/en-us/developers](https://www.ecobee.com/en-us/developers/)). Multiple independent sources (Home Assistant GitHub issues, Home Assistant Community threads) confirm this has been the case continuously since the 2024 cutoff, with no reopening announced.

This was verified against the live StayWhile Ecobee account itself, not just docs: the account's own menu has **no "Developer" option at all** (only My Account / Add Thermostat / Subscriptions / Donate Your Data / My Apps / Logout / Support), and "My Apps → Add Application" is the **PIN-linking** screen for an app that already has a Client ID from before the 2024 cutoff — not an app-creation form. There is no live path today from a fresh account to a new Ecobee API key.

**Status: Ecobee is BLOCKED — external provider policy, not a StayWhile coding gap or a missed step.** Per explicit user instruction:

- No workaround will be built. HomeKit-bridge or any other unofficial/reverse-engineered method is explicitly ruled out — official API access only.
- Ecobee **stays included** in the unified Thermostats architecture (`SmartDeviceProvider.ECOBEE` already exists in the schema, `ThermostatsList.tsx`/`getProviderDisplayName()` already handle it) so it can be added later with zero dashboard redesign, the moment official access becomes available.
- No credential was requested or stored. `.env.local`/`.env.example` still have no real Ecobee value — confirmed via direct inspection before any of this (no secret was ever at risk of exposure).

### Update, same day: two concrete Ecobee paths identified — legacy check in progress, SmartBuildings is the user's chosen preferred path

User is personally checking the StayWhile Ecobee account for **legacy developer access** using the exact documented mechanism (distinct from "My Apps," which only lists apps _authorized to_ the account, not apps _created by_ it): after logging in, a **☰ hamburger icon** (separate from the account/profile dropdown) reveals a **"Developer"** option; if an application already exists on this account from before the 2024-03-28 closure, its Name/Summary/API Key show there directly. **Result not yet reported** — do not assume either outcome.

In parallel, the user has decided: **Ecobee's SmartBuildings API is the preferred long-term integration path for StayWhile**, regardless of the legacy check's outcome — it's a structurally better fit for a multi-property dashboard than the legacy consumer flow ever was:

- **Separate, current, actively-marketed program** (materials dated as recently as Nov 2025) explicitly for multifamily/property-management operators, not individual consumer accounts.
- **Explicitly free** per ecobee's own materials ("ecobee is happy to provide free access to our API").
- **Access is requested via `smartbuildings@ecobee.com` or 1-833-285-1119** — manually provisioned by ecobee, not instant self-serve, but a real current business channel.
- **Auth**: `client_credentials` machine-to-machine OAuth2 — `POST` to their `/token` endpoint (`audience: https://api.sb.ecobee.com`, `client_id`/`client_secret`) — bearer tokens valid ~2 hours (subject to change per their own docs). Fixed scopes include `read:thermostat` (also `create:building`/`write:thermostat`, which StayWhile would not request — read-only fits the standing dashboard philosophy).
- **No per-property PIN-entry step** — this is the structural advantage over the legacy flow: one portfolio-wide grant instead of authorizing one thermostat account at a time, which is why the user chose it as the preferred path for a multi-property dashboard specifically.

**Update: the SmartBuildings outreach email has been sent by the user to `smartbuildings@ecobee.com`.** Requested read-only portfolio-wide access (device status, current temperature, setpoints, mode, humidity if available) for a short-term-rental/property-management dashboard. **Status: WAITING FOR ECOBEE'S RESPONSE** — check current state next session, don't assume a reply has arrived. The legacy-developer-app check (☰ → Developer, above) is still separately in progress, not yet reported either.

**Both paths stay non-competing** with the schema/dashboard work already done: `SmartDeviceProvider.ECOBEE` already exists, `ThermostatsList.tsx`/`getProviderDisplayName()` already handle it — whichever path (legacy key, if one turns up, or SmartBuildings once provisioned) ends up real, `smart-devices.service.ts` would gain one new `syncEcobeeDevices()` function following the same _device-upsert_ pattern as August/Cielo, no dashboard redesign either way. **Its device↔property mapping must NOT reuse the `*_PROPERTY_MAP` env-var pattern** — see the standing "Dynamic, Dashboard-Configurable Integrations" requirement near the top of this file (set 2026-08-19, after this note was originally written). **Do not build the legacy consumer PIN integration** — explicit user instruction, since SmartBuildings is preferred regardless of what the legacy check finds.

**Nothing built, no credential requested/stored, no email sent, no repo/schema change.**

### Honeywell/Resideo — investigated fresh (re-verified today, not just carried forward)

Re-checked live rather than trusting Increment 26/27's notes, given the Ecobee surprise above — **Honeywell/Resideo's self-serve registration is confirmed still genuinely open today**, unlike Ecobee:

- **Registration page live and accepting signups**: `https://developer.honeywellhome.com/user/register` — a normal signup form (First/Last name, Username, Email, Password, Business-or-Personal-Use radio, API Use Case text field, optional Company Name, agree to the Resideo Developer License Agreement + Terms of Service, CAPTCHA, "Create new account"). No closure/approval-gate message present.
- **After account creation**: an application (Client ID / API Key + Secret) is created separately, at `developer.honeywellhome.com/user/me/apps/add` (per Increment 26's original FAQ finding, re-confirmed self-serve, no manual review step documented).
- **Connecting the app to a specific account's real devices still needs a human authorization step** — same class as Nest/Ecobee, just via a different mechanism. Resideo documents two flows and its own "Getting Started" guide is honest that it doesn't clearly say which applies when: **OAuth2 Authorization Code flow** (the account owner logs in and grants consent via a redirect — the standard, fully-documented path) vs. **OAuth2 Client Credentials flow** (app-level token via `POST /oauth2/accesstoken`, but still requires the target user to have been separately "authorized to your API Key" and identified via a `UserRefID` header — the exact linking mechanism for that isn't clearly documented either). **Recommendation: use the Authorization Code flow** when actually implementing, since it's the one with a complete, unambiguous documented procedure — Client Credentials has a real, acknowledged documentation gap around how `UserRefID` linking actually happens.
- **Confirmed prerequisite, unchanged from Increment 27**: "A Honeywell Home account with a connected/installed device" is explicitly required before the API is useful — no simulator exists.
- **Confirmed prerequisite, unchanged from Increment 27**: exact thermostat model/field support beyond the base "Round" model is still not publicly documented — needs checking directly against the account's real device list.
- Rate limit (unchanged, re-confirmed applicable): poll every 5 minutes, ≤20 devices/hour.

**Exact next action for the user, given they already have live Honeywell/Resideo account access** (told to the user directly in chat, not repeated here in full — short version): (1) go to `developer.honeywellhome.com/user/register` and create a developer account (self-serve, expect the form described above); (2) create an application to get a Client ID/API Key + Secret; (3) register an OAuth redirect URI for that application; (4) complete the Authorization Code consent flow using the actual account that holds the real thermostats (a live, one-time step only that account's owner can do); (5) separately, check the Honeywell Home account/app's device list for the exact thermostat model name(s) in use, since only the "Round" model's fields are publicly documented.

**Nothing implemented, no credential requested/stored, no repo/schema/production change.** Waiting for the user to complete step 1 (or report what they find) before any code is written.

### Nest — unchanged, still pending

Per explicit instruction, Nest stays separate and pending until it's confirmed whether existing access is a completed OAuth token (testable immediately) or only app-level credentials (still needs the account owner's one-time consent step). No action taken this increment.

---

## Increment 30 — 2026-08-19: Kenny's dynamic-mapping architecture requirement recorded; per-provider status updates; stale-statement correction pass

New session. User relayed a hard architecture requirement from Kenny and gave status updates on all three pending thermostat providers. **No application code, schema, integration, credential, production data, or deployment was touched this increment — documentation only**, per explicit instruction. `git status` reconfirmed at the start: identical working-tree state to where Increment 28 left it (the uncommitted `/thermostats` page + smart-devices.service.ts additions + nav wiring, plus the large pre-existing uncommitted body from Increments 1–24) — nothing new landed or was lost.

### Kenny's requirement: dynamic, dashboard-configurable integrations

Recorded in full as a new standing section near the top of this file (**"⚠️ Standing Architecture Requirement — Dynamic, Dashboard-Configurable Integrations"**, right after Workspace Isolation) so it can't be missed by a future session skimming increments. Short version: no more hard-coded `*_PROPERTY_MAP` env vars for new providers; existing `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP` are legacy/bootstrap, not the target end state; the real architecture is provider API authorization → dynamic device discovery → admin-confirmed mapping stored in the database → dashboard-managed from then on (enable/disable, remap, sync frequency, sync/error status) — RBAC-controlled and audited, never name-matched automatically. Applies to August, Cielo, Nest, Honeywell, Ecobee, and (flagged, not yet actioned) OwnerRez/Notion property associations. **Not yet designed or built** — this increment only records the requirement, it doesn't design the schema/UI for it.

**Corrected two now-stale forward-looking recommendations** that predate this requirement (both amended in place with a pointer back to the new standing section, not deleted, so the historical reasoning stays visible): Increment 27's "Exact code/schema changes recommended" item 4, and Increment 29's same-day Ecobee update — both had suggested extending the `*_PROPERTY_MAP` pattern to new providers. Neither has been acted on (no `NEST_PROPERTY_MAP`/`HONEYWELL_PROPERTY_MAP`/`ECOBEE_PROPERTY_MAP` exists anywhere), so this is a documentation correction, not a code rollback.

### Ecobee — SmartBuildings docs received, access not yet confirmed complete

Ecobee Support replied to the outreach email sent at the end of the prior session (Increment 29's same-day update) with the official SmartBuildings API documentation, the API-access request form, and the SmartBuildings account creation path. **Status: in progress, not complete** — the user has the documentation/form/path in hand but completing the access-request form and account setup has not been confirmed as done. Do not assume this is finished in a future session; check current status directly. SmartBuildings remains the selected official integration route per the user's explicit decision (Increment 29) — **the legacy consumer/PIN integration must not be built**, regardless of whether the separate legacy-developer-app check (☰ → Developer menu, Increment 29) ever gets reported back.

### Honeywell/Resideo — developer registration submitted, waiting for approval

Following the step-by-step walkthrough started in the prior session (Increment 29: `developer.honeywellhome.com/user/register`), the user submitted the developer account registration. **Status: WAITING FOR DEVELOPER ACCOUNT APPROVAL** — this is a real state change from Increment 29's finding that registration appeared to be instant self-serve with "no manual review step documented"; live behavior for this specific submission showed an approval step. **Do not implement or configure any Honeywell credentials until approval is received and confirmed** — no application/Client-ID creation step has happened yet (that was going to be the next step after registration, per Increment 29's walkthrough, but it's now blocked on approval first). Check current approval status before proceeding in a future session; do not assume either outcome.

### Nest — unchanged, still pending

No new information this increment. Still unconfirmed whether existing access is a completed OAuth token or only app-level credentials — do not assume either. No Google/Nest account/login/access information has been provided or acted on.

### Existing live integrations — status unchanged, but now explicitly in scope for the dynamic-mapping migration

**Cielo** (5 real thermostats) and **August locks** (7 real locks) both remain fully live exactly as documented in Increments 19–21/26 — nothing about their current runtime behavior changed this increment. Both are now explicitly flagged as needing to eventually conform to the dynamic-mapping requirement above (their current `*_PROPERTY_MAP` env-var approach is legacy/bootstrap, not being removed today, not blocking anything currently working).

### Preserved, unchanged, re-confirmed accurate as of this increment (no new verification performed — restated so nothing is lost between sessions)

- **`/locks` page + the "Check-outs"/"Rescheduled Cleanings" homepage wording fixes are deployed to production** — commits `5110dfc` (Locks page) and `086c577` (Check-outs rename + Rescheduled Cleanings always-visible fix), per Increments 24/26. Not re-verified live this increment; no reason to believe this has changed.
- **`/thermostats` page (Increment 28)**: still built, verified, **uncommitted**, waiting on the user's approval to commit/push — unchanged this increment.
- **Integration Sync Controls** (manual sync, automatic sync, on/off, configurable frequency): still exactly the state Increment 25 left it in — manual "Sync now" already works for August/Cielo today; automatic/scheduled sync, on/off toggles, and frequency controls are **proposed architecture only, not built**, and depend on the n8n-vs-alternative scheduling decision. **n8n Cloud trial is still expired**; the client was informed of the required $24/month upgrade and this has **not been confirmed as resolved** — do not assume the upgrade happened. This whole area will also need to route through the new dynamic-configuration requirement above once built (sync on/off + frequency belongs in the same dashboard-managed config, not a separate mechanism) — noted for whoever designs it, not decided here.
- **Michelle/Kenny acceptance gate** (Increment 23's full checklist): **still not confirmed cleared** as of the last direct update (Increment 24) — `admin@stayawhilewithus.com`'s own invitation/login was not yet confirmed accepted, and a full email-code-login + logout click-through had not been re-confirmed since the two production bug fixes landed. **Nothing in Increments 25–30 touched or re-verified this gate** — its status is exactly as unresolved as Increment 24 left it. Do not say "Ready for Michelle and Kenny to test" until it's actually re-checked and every item passes, per the standing gate rules (Increment 23).
- **Production infrastructure** (Supabase migration, Vercel env vars including the required `?pgbouncer=true&connection_limit=1` on `DATABASE_URL`, Clerk testing-phase checklist): unchanged, not touched or re-verified this increment. See Increments 23–24 for full detail.

**Nothing implemented, no credentials touched, no schema/production/deployment change this increment.**

---

## Increment 31 — 2026-08-19 (same day, continued): Nest connected — $5 registration, Google Cloud/OAuth setup, and read-only SDM discovery all complete; database-backed device-mapping architecture proposed, nothing implemented yet

User obtained live access to the Google account managing StayWhile's Nest thermostats and walked through the full Device Access / Smart Device Management (SDM) API setup, screen by screen, with each step verified against current official Google documentation before proceeding (not from memory/prior increments' notes). All of the following is now **complete and verified**:

- **Google Nest Device Access registration**: the one-time US$5, non-refundable fee — **paid successfully**, tied permanently to the Google account used (per Google's own policy, confirmed via live docs fetch, cannot be changed later).
- **Google Cloud project**: created (`StayWhile Nest Integ` Device Access project name, per the user's own naming).
- **Smart Device Management API**: enabled on the Google Cloud project.
- **OAuth 2.0 Client ID**: created (Web application type).
- **OAuth consent screen**: configured with the `sdm.service` restricted scope; the Nest-owning account was added under **Test users** (required since the SDM scope makes any app "unverified" without full OAuth API Verification — not required for personal/single-account use, confirmed via live docs fetch).
- **Device Access project**: created in the Device Access Console, linked to the OAuth Client ID.
- **Partner Connections Manager (PCM) authorization**: the Nest-owning account completed the consent flow — **succeeded**.
- **Read-only SDM device discovery**: performed via a temporary, uncommitted, self-deleting script (`apps/website/_tmp-nest-oauth-discover.mjs` — written, run once by the user in their own terminal, verified deleted afterward). Did the OAuth authorization-code → token exchange, then exactly one `GET .../enterprises/{project-id}/devices` call.
  - **Result: 33 real Nest thermostat devices returned by Google.**
  - Real `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET`, `NEST_PROJECT_ID`, `NEST_REFRESH_TOKEN` written to `apps/website/.env.local` (gitignored, confirmed via `git check-ignore`/`git ls-files` before and after — never committed, never pasted into chat, never printed by the script itself).
  - **Zero database writes, zero `SmartDevice` rows, zero property mappings** — this was discovery-only, verified independently (not just trusted from the user's report): confirmed the script file no longer exists and confirmed all 4 env var names are present via direct, read-only checks.

**No production Nest data exists anywhere in the database as of this note.** The 33 devices are known only via the one-time discovery call's terminal output — nothing durable persists them yet (see architecture proposal below for why, and what fixes that).

### Database-backed device-mapping architecture — proposed, not built

Per the standing "Dynamic, Dashboard-Configurable Integrations" requirement (Kenny, set earlier 2026-08-19, see the top of this file) and this session's explicit instruction, a full architecture was proposed in chat (not yet implemented) before any Nest device touches production:

- **New Prisma model `ProviderDevice`** (additive-only, no changes to `SmartDevice`/`Property`/any live table): a staging layer holding every device a provider's API reports, independent of whether it's mapped. Fields: `provider` (existing `IntegrationProvider` enum), `externalDeviceId`, `deviceType`, `discoveredName`, `connectivityStatus`, `rawMetadata`, `firstDiscoveredAt`/`lastSeenAt` (sync-owned), plus admin-owned mapping state: nullable `propertyId`, `enabled` (default `false`), `mappedAt`, `mappedByUserId`, and a nullable link to the eventual `SmartDevice` row once mapped+enabled.
- **Why a new table instead of making `SmartDevice.propertyId` nullable**: confirmed via direct schema read that `SmartDevice.propertyId` is a required, non-nullable FK today, and every live dashboard/`/locks`/`/thermostats` query already assumes every row has a property. A separate staging table means **zero changes** to any of that already-verified, client-facing code.
- **Four new service functions** (not yet written): `listDiscoveredDevices`, `mapProviderDeviceToProperty`, `unmapProviderDevice`, `setProviderDeviceEnabled` — all reuse the existing `smart_devices:read`/`smart_devices:update` permissions (no new RBAC grant needed) and call the existing `recordAudit()` helper on every mutation.
- **Discovery sync** would upsert into `ProviderDevice` only — it would never touch `propertyId`/`enabled`/`mappedAt`, which are exclusively admin-controlled fields, written only via an explicit dashboard action (dropdown pick of a real `Property`, never inferred from device name).
- **Provider-agnostic by construction**: the same table/functions are intended to serve Honeywell/Ecobee once connected, and eventually August/Cielo per the standing note — Nest is just the first to use it. August/Cielo are untouched by this proposal, no regression.
- **Flagged, not resolved**: 33 discovered Nest devices against 7 known StayWhile properties is a lot — plausibly multi-zone systems, or some devices outside StayWhile's managed portfolio. Needs Michelle/Kenny's input once mapping actually starts, not decided here.

**Nothing was implemented as a result of this proposal** — no migration, no service code, no admin UI, per the explicit instruction to stop after the proposal and wait for approval before writing any Nest device to production.

---

# What Has Been Completed

## Original Phase 1 (verified working)

- Turborepo + pnpm monorepo: `apps/website`, `packages/{database,auth,ai-automation,integrations,mcp-servers,ui,config}`.
- Full Prisma schema (25+ models), migrated and seeded against a local Postgres instance (Homebrew `postgresql@16` — Docker wasn't available in this dev environment; functionally equivalent, see ADR-0003).
- `@stayw/auth` RBAC engine, Clerk integration (code-complete, placeholder keys), event-driven n8n workflow trigger/callback plumbing, a working Properties vertical slice, CI, coding standards, ADRs 0001–0005.

## Architectural Refinement (this session, DDD + AI platform + Integration SDK)

User requested three refinements on top of the approved Phase 1 architecture. Status per piece:

1. **Domain-Driven Design reorganization — ✅ done and verified.**
   - `apps/website/src/server/**` retired. Replaced with `apps/website/src/domains/<domain>/` (business logic) and `apps/website/src/platform/` (cross-cutting infra with no permission checks of its own: `auth/get-current-user.ts`, `identity/verify-clerk-webhook.ts`, `identity/sync-clerk-user.ts`, `audit/record-audit.ts`, `notifications/create-notification.ts`, `errors.ts`).
   - `domains/properties/` fully migrated (services, schemas, components split out of the old inline page, actions, a new `properties.service.test.ts` covering RBAC grant/deny — this test didn't exist before).
   - The other 12 domains (`dashboard`, `reservations`, `guests`, `communications`, `cleaning`, `maintenance`, `tasks`, `smart-devices`, `integrations`, `ai`, `notifications`, `audit`) have **README-only skeletons** — no code yet, just scope/owned-model/permission-key documentation.
   - Clerk webhook route rewritten thin, delegating to `platform/identity/`. n8n webhook route rewritten thin, delegating to a new `packages/ai-automation/src/callback.ts` (`handleN8nCallback`) — that package now owns both directions of the n8n integration symmetrically.
   - New ESLint `no-restricted-imports` rule in `apps/website/eslint.config.mjs` enforces that only `src/domains/*/services/**` and `src/platform/**` may import `@stayw/database` — a real lint error, not just convention.
   - `CODING_STANDARDS.md` updated to match (module boundaries, service-layer example, API patterns, validation paths).
   - Verified: full monorepo `lint typecheck test build` all green after this migration, including a production build with `/properties` still in the route manifest.

2. **Integration SDK — ✅ done and verified.**
   - `packages/integrations/src/core/` now has `types.ts` (`BaseIntegrationClient` + `SyncCapable`/`WebhookReceivable`/`MessagingCapable`/`MediaUploadCapable` capability interfaces + `IntegrationCapability` union), `capabilities.ts` (type guards), `errors.ts`.
   - All 12 provider stubs (OwnerRez, Airbnb, Slack, Asana, Notion, Gmail, Google Voice, Yale, August, Nest, Ecobee, Cielo) rewritten to implement the new interface + correct capability set, **and a real pre-existing bug was fixed**: a bulk-generation script using macOS's BSD `sed` had silently produced broken class names (`UownerrezClient`, `UgoogleUvoiceClient`, etc.) — all corrected (`OwnerrezClient`, `GoogleVoiceClient`, etc.).
   - Every method still throws `NotImplementedError` — this is SDK _shape_ only, no real provider logic yet. **OwnerRez's client is still a stub** — building the real v2 API integration is unstarted implementation work, not a refinement-phase task.
   - Package README documents the capability matrix and the `IntegrationSyncLog` convention. Unit tests added (`core/capabilities.test.ts`) covering type-guard narrowing and that every method still throws.

3. **AI platform layer — ✅ done and verified (completed 2026-08-06).**
   - `packages/database/prisma/schema.prisma`'s `AiAction` model + `AiActionStatus`/`AiActionRiskLevel` enums, `ActorType.AI`, `NotificationType.AI_ACTION_PENDING` are migrated (`20260805172538_add_ai_action_approval_framework` — confirmed additive-only from the generated SQL: 2 new enums, 2 new enum values, 1 new table, 2 indexes, 2 FKs, nothing dropped/altered).
   - `packages/auth/src/permissions.ts` and `prisma/seed.ts` both have the new `ai_actions` resource (15 resources × 5 actions = 75 permissions total); `ops_manager` granted `ai_actions:read`/`ai_actions:update` (12 permissions, up from 10). Re-seeded successfully.
   - **`packages/ai` (`@stayw/ai`) is scaffolded and implemented**: Context Engine (real), Knowledge Retrieval (stub, `NotImplementedError`), Prompt Library (real), Tool Registry (real, enforces the approval gate), Orchestrator (real plumbing, stub Claude call via `NotImplementedClaudeClient`), Conversation Context (real, against `AiConversation`/`AiMessage`), Action Approval Framework (real, against `AiAction`, with a genuine `PENDING → APPROVED|REJECTED → EXECUTED|EXECUTION_FAILED` state machine guarded by `InvalidActionStateError`). 28 unit tests, all passing.
   - `packages/mcp-servers/src/shared/register-tools.ts` wires `@stayw/ai`'s Tool Registry onto the MCP SDK's `ListTools`/`CallTool` handlers (via `zod-to-json-schema`); every `CallTool` routes through `executeTool()`, so the approval gate applies over MCP too. 4 unit tests against a mocked `Server`.
   - **Proof-of-concept**: `apps/website/src/domains/properties/ai-tools.ts` registers a `properties.list` tool (read-only, `requiresApproval: false`) wrapping the already-tested `listProperties` service. 2 unit tests (mocking `@stayw/ai` itself, not its internals — see the note on the `server-only` package below).
   - **ADRs 0006 (DDD), 0007 (AI platform), 0008 (Integration SDK) written**; ADR-0001 updated to list `@stayw/ai` and cross-reference ADR-0006. `system-architecture.md` and `erd.md` updated (mermaid diagrams, folder structure, AI layer section, module-boundary line, data-flow file references, `AiAction`'s state machine explained).
   - **Full monorepo verification pass, all green**: `pnpm lint` (0 errors, only pre-existing `import/order` warnings from the repo's established `vi.mock`-between-imports test pattern), `pnpm typecheck`, `pnpm test` (46 tests across 8 packages), `pnpm build` (production build succeeds, `/properties` still in the route manifest).
   - **One real tooling bug found and fixed along the way**: root `package.json`'s `lint-staged` ran bare `eslint --fix` from the repo root, which can never resolve any package's flat `eslint.config.*` (ESLint v9 flat config only looks at the invocation `cwd`, unlike the old cascading `.eslintrc`). Real linting already runs correctly per-package via `turbo run lint` (used in CI) — pre-commit now only runs `prettier --write`.
   - **A `server-only` cross-package testing note for future sessions**: any workspace package with `import "server-only"` (currently `@stayw/database`, `@stayw/ai-automation`, `@stayw/ai`) can be tested **within its own package** by mocking `server-only` via a `vitest.setup.ts` (see `packages/ai/vitest.setup.ts`, mirroring `apps/website/vitest.setup.mts`'s existing pattern) — this works because first-party/inlined source goes through Vitest's transform pipeline where `vi.mock` applies. It does **not** reliably work when a _different_ package (e.g. `apps/website`) imports that package for real and expects the mock to propagate across the package boundary — Vitest externalizes workspace `node_modules` packages by default, and their internal `import "server-only"` then resolves via real Node resolution (hitting the real throwing module) instead of Vitest's mock registry. `apps/website/src/domains/properties/ai-tools.test.ts` works around this by mocking `@stayw/ai` itself at that boundary (matching how `properties.service.test.ts` already mocks every other cross-package dependency) rather than exercising `@stayw/ai`'s real internals from outside its own package.

## Increment 1 Progress — Core Ops Domains (`IMPLEMENTATION_PLAN.md`)

Started 2026-08-06 (same day as the architectural refinement, in later sessions). Same vertical-slice pattern each time: `schemas/` (Zod) → `services/` (assertPermission → validate → prisma → recordAudit) → `components/` → `actions.ts` (Server Actions) → thin `app/(dashboard)/<domain>/page.tsx` → RBAC tests.

- **Guests** — ✅ done (2026-08-06). List + create, 4 RBAC tests, `/guests` route.
- **Reservations** — ✅ done (2026-08-06). List + create, 4 RBAC tests, `/reservations` route. Manual bookings use `source=DIRECT` + generated UUID `externalReservationId`; writes the `ReservationGuest` join row in the same transaction.
- **Tasks** — ✅ done (2026-08-06, later session). List + create + complete, 6 RBAC tests, `/tasks` route + nav link. Schema/service/components (`createTaskSchema`, `listTasks`/`createTask`/`completeTask`, `TaskList`/`CreateTaskForm`) already existed from an earlier session; this session added `actions.ts`, the route, the nav link, and the tests. `completeTask` sets `status=DONE` + `completedAt`. Full monorepo `lint typecheck test build` verified green (25/25 tasks) after landing.
- **Cleaning schedules** — ✅ done (2026-08-06, same later session). List + create + complete, 6 RBAC tests, `/cleaning` route + nav link. `CleaningSchedule.taskId` is a required unique FK, so `createCleaningSchedule` creates the backing `Task` (type `CLEANING`) and the `CleaningSchedule` row together in one `prisma.$transaction`; `completeCleaningSchedule` updates both rows in one transaction too, mirroring the Reservations `Reservation`+`ReservationGuest` pattern. `CANCELLED`/`MISSED` statuses exist on the model but aren't wired to any UI action yet. Full monorepo `lint typecheck test build` verified green (25/25 tasks) after landing.
- None of Guests/Reservations/Tasks wire a `triggerWorkflow(...)` call yet — no n8n workflow exists for `guest.created`/`task.created`/etc. (n8n instance confirmed empty 2026-08-06; as of 2026-08-24 it still holds only the one inactive default workflow — see Increment 40). Add workflow triggers once real n8n workflows exist, to avoid spurious `WorkflowExecution` FAILED rows and admin-notification noise.
- As of the end of the "Tasks shipped" session, this work (Guests, Reservations, Tasks domain code; `layout.tsx` nav updates; `IMPLEMENTATION_PLAN.md`; this file) was **not yet committed to git** — still local working-tree changes. Confirm current `git status` before assuming otherwise.

## Technology & Integration Audit — ⚠️ explicitly abandoned mid-way

User asked for a full platform/credential audit, we agreed on a safe split (architecture-only data in git; sensitive account details as placeholders only), and created three files:

- `INTEGRATION_INVENTORY.md` — architecture-level platform inventory. **Only OwnerRez's high-level status was captured** ("in use," PAT created) before the user said "we are skipping the remaining audit." Every other platform is still `pending interview`.
- `SECURE_CONFIGURATION_CHECKLIST.md` — placeholder checklist (`<TO_BE_PROVIDED>` etc.) for every platform's credential needs. Fully templated, no real values, nothing filled in yet.
- `N8N_DISCOVERY.md` — architecture-only n8n deep-dive template. Entirely unfilled (`TBD` throughout) — **the audit was abandoned before any of n8n's existing workflows, credentials, or connected services were actually inspected.**

**This matters for the next session**: nobody has looked at what's already inside StayWhile's n8n instance. Don't assume it's empty — inspect it first (see Next Steps).

## n8n MCP Connection — ✅ connected, authenticated, and verified working (2026-08-06)

- User registered `n8n` as an HTTP MCP server: `claude mcp add --transport http n8n https://adminstay.app.n8n.cloud/mcp-server/http` (n8n Cloud, not self-hosted).
- Initial registration needed authentication. Browser-based `claude mcp login n8n` **cannot run through the assistant's Bash tool** (confirmed by trying it — fails with "stdin isn't a terminal"). The user ran it themselves in their own terminal successfully.
- `claude mcp list` now shows `n8n: https://adminstay.app.n8n.cloud/mcp-server/http (HTTP) - ✔ Connected`.
- **Verified working in the 2026-08-06 session**: `mcp__n8n__search_workflows`, `list_credentials`, `get_workflow_details`, `list_tags`, `search_projects` all called successfully and returned real account data. No further debugging needed for tool access.

### Update — 2026-08-06, later same-day session: n8n found disconnected

The verification above was real and accurate for that session. In a **later session the same day**, `claude mcp list` no longer showed `n8n` at all — only `IFTTT`, `Asana` (needs auth), and `Slack` were registered. **MCP server availability is session-specific and was not assumed to carry over** — no n8n tool calls were made or simulated once this was discovered. This does not overwrite the earlier "verified working" finding — both are true at their respective points in time. The user needs to reconnect n8n (re-run the registration/login flow from their own terminal, same as the original setup) before any n8n-dependent work can resume. Every future session must re-run `claude mcp list` and not assume n8n (or any MCP server) is still connected based on this document.

## MCP Connections — 2026-08-06, later same-day session: Slack / Asana / IFTTT observed, ownership unconfirmed

In the same later session, three MCP connections appeared in `claude mcp list` that are **not mentioned anywhere else in this document** and were never set up or discussed in any prior documented session:

- `Slack` — ✔ Connected
- `Asana` — needs authentication
- `IFTTT` — ✔ Connected

Per explicit user instruction (2026-08-06, that session): do not interact with any of these, or any future MCP connection, unless the user explicitly confirms it belongs to the StayWhile workspace. If ownership cannot be confirmed, ignore it completely. As of the end of that session, ownership had not been confirmed for any of the three, so none were used. Any future session must re-check this — the user may confirm ownership later, at which point this note should be updated (additively, not by deletion) to reflect that.

## n8n Instance Discovery — ✅ done (2026-08-06)

Full findings in `N8N_DISCOVERY.md`. Summary: the instance is **effectively empty** — one auto-generated default workflow ("My workflow": manual trigger → unconfigured HTTP Request, inactive, never touched), no tags, no folders beyond the single personal project, and only 3 credentials on file (`Notion account`, `Anthropic account`, `Header Auth account` — no OwnerRez/Slack/Gmail/etc. yet). **Safe to build new workflows without risk of colliding with or duplicating prior work.**

---

# What Is Blocked / Needs Verification First

1. ✅ **n8n MCP tools verified working** (2026-08-06 session). `search_workflows`, `list_credentials`, `get_workflow_details`, `list_tags`, `search_projects` all returned real data — the connection is fully functional, not just account-level.
2. ✅ **OwnerRez confirmed as production data** (2026-08-06 session — user answered directly after being asked a third time). All OwnerRez work must treat reservation/guest records as real. Read-only until the user explicitly authorizes writes.
3. **No OwnerRez PAT is configured anywhere in this codebase.** The user was told explicitly not to paste it into chat; it was never provided by any other channel either. It needs to go into `.env.local`/`.env` (gitignored) before the OwnerRez client can be implemented for real.
4. ✅ ~~`packages/ai` doesn't exist yet~~ — long since built and complete, see Increment 4–13 above. Stale as of 2026-08-12; kept for historical record only.

## Current blockers (updated 2026-08-14, see Increment 20 for full detail)

5. ✅ **RESOLVED (2026-08-14) — August is live end-to-end.** Real login (brand `yale_august`, token valid until 2026-09-12), 4 real `Property` rows created, `AUGUST_PROPERTY_MAP` fully populated, real sync run twice and proven idempotent (7/7 locks synced both times, no duplicates), the one non-lock device excluded by confirmed ID. No further action needed unless the client adds more properties/locks — see Increment 20 for the exact resume path if that happens.
6. ✅ **RESOLVED (2026-08-15) — Cielo is live end-to-end.** Client-confirmed mapping (via the user, sourced from Michelle): Island Tides and Miramar Bliss reuse the `Property` rows already created for August; Bahamas, Ocean Pearl, and Sandy Nudes are 3 new real `Property` rows created from Michelle's actual address/type/bed/bath/occupancy/timezone data (no fabrication). 7206 (Kenny & Jenny's personal residence, per Kenny's explicit confirmation) is deliberately excluded — omitted from `CIELO_PROPERTY_MAP` entirely, so it's skipped by the sync and never becomes a `SmartDevice` row. Real sync run twice, proven idempotent (5/5 synced both times, identical row IDs, zero duplicates). See Increment 21 for full detail. No further action needed unless the client adds more thermostats.
7. **Notion / OwnerRez** — code complete, credential-gated, currently unconfigured in this local environment. Not blocked on anything code-side; just waiting on the client to provide `NOTION_API_KEY` and/or `OWNERREZ_USERNAME`+`OWNERREZ_API_TOKEN` if/when they want those dashboard sections live.

---

# Architectural Decisions Made This Session

(In addition to ADRs 0001–0005 from original Phase 1, which stand unchanged.)

- **DDD folder structure**: `apps/website/src/domains/<domain>/` for business logic, `apps/website/src/platform/` for cross-cutting infra with no permission checks of its own. Reconciliation rule for domains that look cross-cutting (Audit, Notifications, AI, Integrations): the _package/platform layer_ owns the reusable capability; the _domain folder_ owns the human-facing feature built on top, with its own `assertPermission` call. — **needs ADR-0006**, not yet written.
- **AI platform layer**: a new, separate `packages/ai` (`@stayw/ai`), not an expansion of `@stayw/ai-automation`. n8n = deterministic business-process automation; the AI Orchestrator (not yet built) = a non-deterministic Claude tool-use loop — they're peers, with the Orchestrator able to call `triggerWorkflow()` as a future registered tool (not wired yet). Action Approval Framework needed a genuinely new `AiAction` table (confirmed gap, now in schema). Knowledge Retrieval is interface + stub only, deliberately deferred. — **needs ADR-0007**, not yet written.
- **Integration SDK**: base interface (universal methods) + capability interfaces (`SyncCapable`/`WebhookReceivable`/`MessagingCapable`/`MediaUploadCapable`), declared via a `capabilities` array, narrowed safely via type guards. No `IntegrationConnection`/`IntegrationSyncLog` schema changes needed — capability-to-sync-log mapping is a documented convention, not a new column. — **needs ADR-0008**, not yet written.
- **n8n is n8n Cloud** (`adminstay.app.n8n.cloud`), not self-hosted — confirmed by the MCP server URL the user registered.
- **MCP tool access requires a fresh session** — confirmed both by official Claude Code documentation and by direct testing in this session (`ToolSearch` returned nothing for n8n despite a successful account-level connection).

---

# Remaining Implementation Tasks, In Priority Order

1. ✅ ~~New session bootstrap: verify n8n MCP tools~~ — done 2026-08-06.
2. ✅ ~~Finish the paused architectural refinement~~ — done and fully verified 2026-08-06, see "AI platform layer" above. `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` is now fully executed; no need to re-read it for design content (only for historical context).
3. **Commit this session's new work** (packages/ai, mcp-servers wiring, ADRs 0006-0008, updated docs) — see "Risks" below, not yet done as of end of session.
4. **Credential setup**: get the OwnerRez PAT into `.env.local`/`.env` (never into git, never pasted into chat). OwnerRez is now **confirmed production data** (2026-08-06) — read-only until explicitly authorized otherwise.
5. ✅ ~~n8n discovery~~ — done 2026-08-06, instance confirmed empty, see `N8N_DISCOVERY.md`. Safe to build real workflows without collision risk.
6. **OwnerRez v2 API integration**: implement `packages/integrations/src/ownerrez/client.ts` for real (currently a structural stub, now shaped per ADR-0008's capability interfaces). Build and test reservation synchronization — read-only first, given the confirmed-production data.
7. **Webhook listeners** where OwnerRez/other providers support them (`WebhookReceivable` capability already modeled in the SDK).
8. **Connect the dashboard backend** to real synced data (extends the `domains/reservations/`, `domains/properties/` pattern already established).
9. **Real Claude wiring in the Orchestrator**: `packages/ai/src/orchestrator/claude-client.ts`'s `NotImplementedClaudeClient` is the one piece of `@stayw/ai` still stubbed — everything around it (context, prompts, persistence) is real and tested. Also still a stub: Knowledge Retrieval.
10. **Build real n8n workflows**: reservation notifications, guest communications, etc. — the instance is empty and ready.
11. Continue the platform-by-platform audit interview for the remaining platforms (Airbnb, Slack, Asana, Notion, Gmail, Google Voice, GitHub, Supabase, Vercel, Claude API, MCP Servers, Yale, August, Nest, Ecobee, Honeywell, Cielo) **if/when the user wants it resumed** — it was explicitly deprioritized, not cancelled.

---

# Assumptions Made

- OwnerRez reservation-sync testing will hit **production data** — confirmed directly by the user 2026-08-06, no longer an assumption.
- n8n is **Cloud-hosted**, not self-hosted (inferred from the registered MCP server's URL).
- The audit's "skip remaining" instruction applies to the **interview process**, not to the two safe artifacts already created (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`) — those stay as living documents to fill in opportunistically during implementation, not deleted.
- "Take over implementation" and "only ask for approval before destructive changes" is scoped to **this project's own resources** (its database, its repo, its n8n workflows) — it does not extend to skipping confirmation for genuinely irreversible or cross-system actions (e.g. force-pushes, dropping tables, production data mutations) per this assistant's standing safety practice, which the user has not overridden.
- Local Postgres (Homebrew, not Docker) remains an acceptable dev substitute per ADR-0003; production still targets Supabase.

---

# Risks & Warnings

- ✅ **RESOLVED (2026-08-06)**: all work from this session — original Phase 1, the DDD/SDK refinement scaffolding, all original documentation, and the refinement-completion work (packages/ai, mcp-servers wiring, ADRs 0006-0008, updated docs) — is committed to git across five commits on `main`. Working tree is clean as of end of session. Not yet pushed to `origin` — only local commits were requested/authorized.
- ✅ **RESOLVED (2026-08-06)**: n8n's existing state is now known — see "n8n Instance Discovery" above and `N8N_DISCOVERY.md`. It's empty; safe to build on.
- ✅ **RESOLVED (2026-08-06)**: OwnerRez is confirmed production data (see "What Is Blocked," item 2) — no longer an open question. Any reservation-sync work must treat this as real guest/reservation data, read-only until explicitly authorized otherwise.
- ✅ **RESOLVED (2026-08-06)**: `AiAction` and its enums are migrated (`20260805172538_add_ai_action_approval_framework`, confirmed additive-only). `schema.prisma` and the database are in sync.
- The three audit documents (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`, `N8N_DISCOVERY.md`) are mostly `TBD`/skeleton — don't mistake their existence for completeness.
- Clerk is still running on placeholder (non-functional) API keys; full sign-in has never been tested end-to-end with real credentials.

---

# Exact Next Steps For The New Session

1. Start the new session in this same project directory.
2. Confirm n8n MCP tool availability still holds (was verified working 2026-08-06; re-verify if this is a materially later session).
3. Recommend committing this session's new work (packages/ai, mcp-servers, ADRs, docs) early, given the risk noted above.
4. Ask the user to pick the next priority from "Remaining Implementation Tasks" items 4/6/9/10 (credential setup, OwnerRez real integration, real Claude wiring, or building actual n8n workflows) — all four are now unblocked and it's the user's call to sequence.

### Update — 2026-08-06, later same-day session (supersedes steps 2 and 4 above; step 1 and 3's intent still stand)

The user has since directed work to continue down **Increment 1** of `IMPLEMENTATION_PLAN.md` (core ops domains) rather than jumping to the credential-gated Increment 2 items. Revised steps for the next new session:

1. Start the new session in this same project directory (unchanged).
2. **Re-run `claude mcp list` fresh — do not assume n8n, or any other connection documented in this file, is still live.** See "n8n MCP Connection" and "MCP Connections" updates above.
3. Recommend committing any currently-uncommitted work — check `git status` for the real current state.
4. Continue Increment 1 at the next undone domain per `IMPLEMENTATION_PLAN.md`'s table (Cleaning schedules, once Tasks is committed) using the same vertical-slice pattern, referencing `apps/website/src/domains/tasks/` as the most recent worked example.
5. Only return to Increment 2 items (credential setup, OwnerRez, Claude wiring, n8n workflows) once Increment 1 is further along or the user redirects.

### Update — 2026-08-07 session (supersedes all steps above; Increments 1, 1.5, 3, and 4 are now done)

1. Start the new session in this same project directory (unchanged).
2. Re-run `claude mcp list` fresh if any MCP-dependent work is planned — not needed last session, don't assume it's still true.
3. Recommend committing — there is now a very large amount of uncommitted work spanning this session and the prior one; check `git status` for the real current state before assuming anything is saved.
4. Everything left in `IMPLEMENTATION_PLAN.md` is genuinely credential-, money-, login-, or design-decision-gated (see Increment 2's table). Real next steps, in rough priority:
   - If the user provides `ANTHROPIC_API_KEY`, `OWNERREZ_USERNAME`+`OWNERREZ_API_TOKEN`, `SLACK_BOT_TOKEN`+`SLACK_SIGNING_SECRET`, `NOTION_API_KEY`, or `ASANA_ACCESS_TOKEN`: the adapters are already real and code-complete — verify against a live account and wire up any missing env declaration in `apps/website/env.ts`.
   - Ask the user for a decision on Google Voice (no public API exists — drop it, or substitute something like Twilio).
   - If real Clerk keys become available, test the actual sign-in round-trip end-to-end for the first time.
   - The Orchestrator's tool-use loop is now real and wired to the AI domain (Increment 4) — Context Engine wiring (real context providers for `assembleContext()`, so the `{{context}}` prompt placeholder isn't empty) is the next genuinely no-credential AI feature, if the user wants richer conversations. Wiring `completeStream()` into the actual Next.js UI (a streaming route handler + client component) is the other one.
   - Knowledge Retrieval (semantic/long-term memory) needs a vector store decision from the user before any code — a real infra/credential question, not a coding gap.

### Update — 2026-08-12 session (supersedes the steps above; see Increment 19 for full detail)

Everything above this update is now historical — the AI platform, dashboard demo-readiness, and Clerk auth work it describes are all done. The project is now in **live-integration verification mode** for August/Cielo. Exact order of work for the next session:

1. Start in this same project directory. Run `git status` for the real current state — a large amount of work (including all of today's dashboard + August/Cielo work) is still uncommitted.
2. **Check whether Kenny has provided the August verification code.** If yes: the user runs `pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts` themselves (interactive, needs their own terminal — an assistant cannot do this step). Once it reports success, run `pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts` to confirm real locks/battery/online-offline, then fill in `AUGUST_PROPERTY_MAP` using the real houseId values it prints, then run the real August sync and verify the dashboard's Locks section.
3. **Check whether the client has resolved the Cielo property-mapping blocker** (real Property records created for Island Tides / Bahamas / Ocean Pearl / 7206 / Miramar Blis / Sandy Nudes, or an explicit correspondence to existing properties). If yes: fill in `CIELO_PROPERTY_MAP`, re-run `syncCieloDevices`, confirm the resulting `SmartDevice` rows via `psql`, then confirm the dashboard's Thermostats section shows them as live (not demo).
4. If neither is resolved yet: there's no further live-integration work possible without client input — this is a legitimate stopping point, not a gap to work around. Everything else (dashboard requirements, both integrations' code, tests) is done and verified; re-confirm with a fresh `pnpm turbo run lint typecheck test build --force` if picking up other work, since that's cheap and catches drift.
5. Do not attempt to complete August's login without a human entering the real password/2FA code, and do not guess a Cielo property mapping — both are explicit standing instructions from the client.

### Update — 2026-08-14 session (August done — see Increment 20 for full detail)

Kenny's code arrived, the user ran the login themselves, and August is now **fully live end-to-end** — real login, 4 real properties, real lock mapping, real sync proven idempotent (twice).

### Update — 2026-08-15 session (supersedes all steps above; Cielo is now also done — see Increment 21 for full detail)

Both August and Cielo are now fully live. Nothing is blocked. Exact order of work for the next session:

1. Start in this same project directory. Run `git status` for the real current state — a very large amount of work (everything from Increment 1 through 21) is still uncommitted; recommend committing in logically-grouped chunks (re-derive current groupings from `git status` directly rather than assuming any prior note's grouping is still accurate).
2. No live-integration blockers remain. Reasonable next priorities, the user's call to sequence: (a) commit the large uncommitted body of work, (b) OwnerRez/Notion credential setup if the client wants those dashboard sections live (both are code-complete, just unconfigured in this environment), (c) Increment 18's flagged gap — no UI/admin flow exists yet for granting a role to a new real Clerk sign-in, so every future first-time real user still needs a manual SQL grant.
3. If the client adds more August locks or Cielo thermostats later: same resume path both times — re-run the respective `check.ts` script, extend the respective `*_PROPERTY_MAP`, re-run the sync.

### Update — 2026-08-15 session, continued (supersedes all steps above — see Increment 22 for full detail)

**Current status: WAITING FOR CLIENT FEEDBACK.** Michelle and Kenny are testing the dashboard and the new sign-out flow; the user has explicitly asked for no further feature work, mappings, syncs, or external-system writes until they give new instructions. Exact order of work for the next session:

1. Start in this same project directory. **Check with the user for feedback from Michelle/Kenny before doing anything else** — if none yet, the correct action is to wait, not to proceed with new work independently.
2. Run `git status` for the real current state — 20 files uncommitted (the Team/Users admin feature across Increments 21–22, the case-insensitive-email + last-admin-deactivation-guard fixes, the Notion/OwnerRez read-only safety README updates, and the sign-out button), plus everything from Increments 1–20 already noted as uncommitted in every prior update. Do not assume only the sign-out file is uncommitted — see Increment 22's "Git status at the end of this increment" for the exact file list.
3. Once feedback arrives and the user is ready: commit the uncommitted work in logically-grouped chunks (re-derive current groupings from `git status` directly). The Team/Users feature, the RBAC safety fixes, the Notion/OwnerRez doc updates, and the sign-out button are four reasonably separable commits, but confirm with the user before grouping.
4. **Do not implement any OwnerRez/Notion sync or write path** without first showing the user the exact reads, exact property mappings, and exact writes, and getting explicit approval — this is a standing hard rule (see `packages/integrations/src/notion/README.md`, `packages/integrations/src/ownerrez/README.md`, and the `feedback_notion_ownerrez_read_only_safety` cross-session memory), not just a one-time instruction.
5. **StayWhile's dev server may still be running on port 3001** (started this session because port 3000 belongs to a different client's project — never touch whatever is on port 3000 without first confirming, the same way this session did, that it actually belongs to StayWhile). Check `lsof -i :3001` before assuming it's still up; restart with `PORT=3001 pnpm --filter website dev` if not.
6. If the client adds more August locks or Cielo thermostats later: unchanged, same resume path as before (step 3 in the prior update block).

### Update — 2026-08-17 session (supersedes all steps above — see Increment 23 for full detail)

**Current status: PRODUCTION CUTOVER IN PROGRESS — Clerk testing-phase gate not yet cleared.** Do not resume the "commit uncommitted work" / "wait for Michelle & Kenny feedback on the old dev flow" track above — that was superseded the moment this session began production migration work. Exact state:

- **Supabase**: migration complete and fully verified (Phase 1–3, see Increment 23). The existing StayWhile Supabase project now holds exactly the approved production dataset. Do not re-run any phase of this migration or treat it as still pending.
- **Vercel**: `DATABASE_URL`/`DIRECT_URL`/`NEXT_PUBLIC_APP_URL` already updated and redeployed, pointing at Supabase. Live at `https://stayawhilewithus-website.vercel.app` (project not renamed — user reversed that plan; do not rename it).
- **Clerk**: a testing-phase checklist was handed to the user (disable Password strategy, restrict sign-up, add allowed origin, add webhook + its signing secret to Vercel) — **check with the user whether this has actually been applied yet before assuming it has.**
- **Standing acceptance gate** (see Increment 23 for the full checklist): the dashboard cannot be declared ready for Michelle/Kenny until every gate item is verified, with browser/inbox-dependent items (email-code login, logout) confirmed by the user directly, never assumed. The required exact phrase, once cleared, is **"Ready for Michelle and Kenny to test."**
- **After that phrase is said**: stop. No new feature work, property mappings, OwnerRez/Notion sync, write functionality, Supabase data changes, or further Vercel/Clerk changes — and no acting on assumptions about Michelle or Kenny's preferences — until the user relays their actual feedback.
- The large body of previously-uncommitted work (Increments 1–22) is **still uncommitted** — this session added no new commits either. Still worth grouping and committing whenever the user is ready, but that's independent of and lower-priority than the production cutover/testing-gate work above.
- Local dev server situation (port 3001 vs. another client's port 3000) is unchanged from the prior note — still applies if local dev work resumes.

### Update — 2026-08-18 session (supersedes all steps above — see Increment 24 for full detail)

**Current status: still PRODUCTION CUTOVER IN PROGRESS — acceptance gate still not cleared.** This session found and fixed two real production bugs via actual live-login testing (not code review), got `ryskris0@gmail.com` working end-to-end as a second global admin, and added a `/locks` drill-down page at the user's request. Exact state for the next session:

- **Two real bugs fixed this session** — full detail in Increment 24: (1) Prisma query engine wasn't bundled into the Vercel serverless function (fixed via `@prisma/nextjs-monorepo-workaround-plugin`, committed as `e23bcd0`, already deployed and confirmed working by a real sign-in); (2) Prisma + Supabase transaction-pooler prepared-statement conflict (`42P05`), fixed by appending `?pgbouncer=true&connection_limit=1` to Vercel's Production `DATABASE_URL` only — **do not remove this query string**, it's required, not optional.
- **`admin@stayawhilewithus.com`**: invited via Clerk, **not yet confirmed accepted/signed-in as of this note** — check current state, don't assume either way.
- **`ryskris0@gmail.com`**: fully working — real Clerk sign-in, one clean Supabase row, global `admin` role granted and verified. This is the user's own personal testing account, kept deliberately separate from `admin@stayawhilewithus.com`.
- **`/locks` page**: implemented and verified against real production data (7 real August locks, 0 demo), full suite green (25/25). **Correction: this WAS subsequently committed (`5110dfc`) and pushed later in the same 2026-08-18 session** (see Increment 24's "Update, same session" note) — the "not committed/pushed yet" wording directly above is stale, kept only for historical accuracy of what was true earlier in that session.
- **Standing acceptance gate unchanged** (Increment 23's full checklist still applies): do not say **"Ready for Michelle and Kenny to test"** until every item passes, with email-code login and logout confirmed by the user directly. Not cleared as of this note — `admin@stayawhilewithus.com`'s own login is still outstanding, and a full click-through hasn't happened since the bug fixes landed.
- The large body of previously-uncommitted work (Increments 1–22) is still uncommitted. Still lower priority than clearing the acceptance gate.

### Update — 2026-08-19 session (supersedes all steps above — see Increments 25–30 for full detail)

**Current status: still PRODUCTION CUTOVER / ACCEPTANCE GATE track, unresolved — plus a new parallel thread (thermostat provider expansion) that is now itself gated on a fresh, hard architecture requirement.** Nothing below has been implemented in code; this is all research, external provider registration, and documentation.

1. Start in this same project directory. Run `git status` for the real current state — same working tree as Increment 28 left it (large pre-existing uncommitted body from Increments 1–24, plus the uncommitted `/thermostats` page + `smart-devices.service.ts` additions + nav wiring from Increment 28). Nothing new was added or removed this session.
2. **Read the new "⚠️ Standing Architecture Requirement — Dynamic, Dashboard-Configurable Integrations" section near the top of this file before writing any new integration code** — it changes the target design for Nest/Honeywell/Ecobee (and eventually August/Cielo/OwnerRez/Notion) away from hard-coded `*_PROPERTY_MAP` env vars toward database-backed, dashboard-managed mapping. Not designed or built yet.
3. **Ecobee**: check whether the SmartBuildings access-request form / account setup (docs received from Ecobee Support, per Increment 30) has been completed. Do not assume either way. Do not build the legacy consumer/PIN integration regardless.
4. **Honeywell/Resideo**: check whether the developer account registration (submitted, per Increment 30) has been approved yet. Do not implement/configure any Honeywell credentials or start the application-creation step until approval is confirmed.
5. **Nest**: ~~still fully pending~~ — **superseded, see Increment 31**. Google Cloud/OAuth/Device Access setup is complete, PCM authorization succeeded, real credentials are in `apps/website/.env.local` (`NEST_CLIENT_ID`/`NEST_CLIENT_SECRET`/`NEST_PROJECT_ID`/`NEST_REFRESH_TOKEN`), and a one-time read-only discovery call confirmed **33 real Nest thermostats**. A `ProviderDevice` database-backed mapping architecture was proposed in Increment 31 but **not implemented** — no migration, no real `NestClient`, no admin mapping page, zero `SmartDevice` rows or property mappings exist for Nest. Do not write any Nest device to production until the user explicitly approves the Increment 31 proposal.
6. **Michelle/Kenny acceptance gate** (Increment 23's checklist): still not confirmed cleared as of Increment 24, and nothing since has re-verified it. If resuming production-readiness work rather than the thermostat thread, this is still the higher-priority open item — check `admin@stayawhilewithus.com`'s invitation/login status directly before assuming anything.
7. **n8n**: still paused, Cloud trial expired, $24/month upgrade not confirmed as resolved — re-check before assuming Integration Sync Controls (Increment 25) can move forward.
8. Do not commit or push anything related to the `/thermostats` page (Increment 28) until the user explicitly approves — still outstanding as of this note.
9. **Nest next step, if approved**: implement the Increment 31 `ProviderDevice` proposal (migration → real `NestClient.listDevices()` wired to the SDM API using the stored credentials, with hourly access-token refresh → `discoverNestDevices()` writing all 33 into `ProviderDevice` → admin mapping page) — in that order, stopping for a checkpoint before any `SmartDevice` row is created.

---

## Increment 32 — 2026-08-19 (same day, continued): SECOND CLIENT MEETING — new priority scope, recorded before any implementation starts

User relayed a second client meeting (Michelle, Kenny, and now **April** joining as a tester). This supersedes prior "wait for approval" pacing on the `ProviderDevice` architecture discussion (Increments 31 + the refined pass right before this one) — **the refined design from those two passes is the one being implemented**, just not all at once. Recording the full scope here first, per explicit instruction, "so a new terminal cannot lose these requirements."

### Priority order, as given

1. **Fix production Sync Now** for August/Cielo now, Nest once staged. Kenny reports it currently returns a failure/zero-record error in production. Required behavior: independent of automatic sync, shows "Syncing…", prevents duplicate concurrent syncs, shows success/failure clearly, preserves last-good data on a failed sync, updates "Last synced", never performs device-control commands. Must not wait on n8n — n8n stays a separate, still-externally-blocked thread (Cloud trial expired, $24/month upgrade unconfirmed) for _automatic_ background sync only.
2. **Move "Rescheduled Cleanings" higher on the homepage** — Michelle wants it grouped with Check-ins/Check-outs/Due-upcoming-cleanings as the ops team's first-thing-in-the-morning check. Stays visible at zero records (existing "No rescheduled cleanings." empty state, from Increment 26 — don't invent data). Preserve every other original homepage priority unchanged: August lock summary (esp. offline/low-battery), Thermostat status (esp. offline), daily check-ins, daily check-outs. ADR/Revenue stay off the homepage — unchanged standing rule.
3. **Build the dynamic provider-device mapping foundation** (`ProviderDevice`) — the refined design from the two design passes immediately before this message. Full spec: additive `ProviderDevice` table scoped to `IntegrationConnection` (not just `IntegrationProvider`), no denormalized `provider` column (derive via the relation), `onDelete: Restrict` (not `Cascade`) on the connection FK, new `SmartDevice.deactivatedAt` (soft-deactivate, never hard-delete — also fixes the real existing `pruneStaleDevices()` history-loss bug found during that design pass), transactional map/unmap via `prisma.$transaction` keyed on `SmartDevice`'s existing `[provider, externalDeviceId]` unique constraint for idempotency, full audit trail via the existing `recordAudit()` helper. Applies to August, Cielo, Nest, Honeywell, Ecobee eventually — August/Cielo's current `*_PROPERTY_MAP` env-var behavior is explicitly legacy/bootstrap, migrated later (two options were laid out — backfill-only vs. backfill-and-refactor-sync-together — **not yet decided by the user**, check before assuming either).
4. **Stage the 33 discovered Nest thermostats** into `ProviderDevice` (discovery/staging only) once the foundation exists — zero `SmartDevice` rows, zero mappings, no `NEST_PROPERTY_MAP`, no name-based guessing. Once an admin explicitly maps+enables any, the unified Thermostats view should include Cielo + Nest together (already provider-agnostic at the dashboard layer per Increment 27's finding — no dashboard code change expected here).
5. **Make additional August locks dynamically discoverable** — Michelle will grant access to more locks; the system must support new discovery/mapping without any developer touching env vars or code (same `ProviderDevice` foundation, just applied to August's existing connection).
6. **OwnerRez → StayWhile property sync (read-only)** — Michelle/Kenny confirmed OwnerRez holds StayWhile's real property portfolio (~38 properties; production currently has 7) and they do not want properties entered manually. Requirements: OwnerRez stays strictly read-only (standing rule, unchanged, see `feedback_notion_ownerrez_read_only_safety`), no write-back, **do not delete current production properties until matching/backfill logic is proven**, prevent duplicate properties, preserve stable StayWhile `Property.id` UUIDs wherever a current property can be safely matched to an OwnerRez record, and **matching rules must be shown to the user before any production backfill runs** — same "show reads/mappings/writes before syncing" standing rule already applied to every other integration in this project. Only use OwnerRez fields the API actually returns (name, bedrooms, bathrooms, beds, guest capacity, etc.) — never guess/invent a field the API doesn't provide.
7. **Dashboard-managed property regions/categories** — Kenny wants admins to assign/change a property's region from the dashboard, not hard-coded. The client's current operational groupings (relayed, not yet confirmed final by Michelle): SPI; SRQ (Bradenton/Sarasota); Largo; St. Augustine; Destin (Destin/Destin Beach/Santa Rosa Beach grouped together per their team); Panhandle (Navarre Beach/Pensacola Beach). **Do not infer final region assignments from property names** — Michelle said she'll provide the exact property-to-region list; wait for it rather than guessing from naming patterns. Needs: assign/change a property's region, create/rename a region (permission-gated), filter properties by region — all without code changes or redeploys.
8. **Team test admin account** — Kenny wants a separate test/admin account for the ops team instead of everyone sharing the original `admin@stayawhilewithus.com` login. **The exact email must be confirmed from the existing StayWhile account/inventory before creating or inviting anything — do not guess from the meeting transcript.** Once confirmed: invite via the existing Clerk + StayWhile flow (mirrors the Team/Users domain built in Increment 22), grant the existing global `admin` role (**do not create a new RBAC role** — explicit instruction), then verify email-code login, global admin access, logout, and login-again — same manual-confirmation standard as the Michelle/Kenny acceptance gate (Increment 23), not something to claim passed without the user's direct confirmation.
9. **Notion monthly backup** — Michelle wants an automatic end-of-month preserved copy of Notion's latest content. Notion stays strictly read-only from the dashboard (standing rule, unchanged) — a backup reads and stores a copy elsewhere, it does not edit/delete/write back to Notion itself. **Design first, before implementing**: what exactly gets backed up, where it's stored, timestamp/version naming, retention policy, failure notification, and how scheduled execution works while n8n is still inactive (prepare the implementation, but scheduling itself stays explicitly blocked/marked-pending until n8n's upgrade is confirmed — same pattern as automatic sync in Priority 1).

### Explicitly not blocking this work

**Honeywell** (developer/API application submitted, waiting on Resideo approval) and **Ecobee** (SmartBuildings is the chosen official path, account/API onboarding still being completed externally) — neither blocks any of the 9 priorities above. Check their status opportunistically, don't let either gate other work.

### Documented for later, explicitly not prioritized yet

Captured from the second meeting, **not to be worked ahead of priorities 1–9 above**: email inbox integration, Google Voice, Asana, Slack, cleaning photos, pool reports, file reports, possible Airbnb integration/booking-request visibility. **Airbnb specifically needs careful investigation before any second write path is built** — OwnerRez already has its own Airbnb integration/sync, and the interaction/conflict risk between that and any StayWhile-side Airbnb integration isn't understood yet. Nothing here is scoped, designed, or started.

### Deployment expectation, per feature, standing for this entire scope

For each of the 9 priorities (worked in the stated order, not batched): inspect first → implement → `lint`/`typecheck`/`test`/`build` → show the exact diff → keep unrelated uncommitted work out of the commit → commit/push only once verified safe → deploy to production → **provide a simple, plain-language testing checklist for Michelle/Kenny/April** covering exactly what changed and what to click. This cadence applies to every priority in this list — no exceptions, no batching multiple priorities into one commit/deploy.

### Status as of this note

**Nothing from this increment's 9 priorities has been implemented yet.** This increment is the scope-recording step, done first per explicit instruction. Work begins with Priority 1 (Sync Now) immediately after this entry, in the order listed above.

---

## Increment 33 — 2026-08-19/20: Priority 1 (Sync Now) shipped and deployed; Cielo device-count discrepancy investigated (real, external, not a StayWhile bug — but surfaced a real data-loss risk); new "Full Smart Device Management" client requirement recorded

### Priority 1 — Sync Now — done, committed (`52890d9`), pushed, deployed, live-verified

Root cause of Kenny's original "0 synced" report: `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP` were missing from Vercel **Production** env vars — confirmed directly by the user checking Vercel's dashboard, not assumed. Restored from the trusted local `apps/website/.env.local` values (same ones proven live in Increments 20-21), copied by the user directly — never printed or handled by the assistant.

Code-side reliability/UX rebuild, in `apps/website/src/domains/integrations/{actions.ts, services/integrations.service.ts, services/integrations.service.test.ts, components/IntegrationConnectionList.tsx, components/SyncNowButton.tsx (new)}` — exactly these 5 files, nothing else, verified via `git diff --stat` before committing:

- Sync actions are `IntegrationConnection.id`-scoped, not provider-name-scoped (multi-account-safe, though multi-account itself isn't built).
- Duplicate-concurrent-sync guard: a **namespaced, two-key** Postgres advisory lock (`pg_try_advisory_xact_lock(hashtext('integration_sync'), hashtext(connectionId))`), wrapping the RUNNING-row check-and-create in one transaction — no schema change, no TOCTOU race window. Lock is transaction-scoped (releases in milliseconds); the slow external API call happens _after_ commit, outside the transaction, deliberately — production's `DATABASE_URL` uses Supabase's transaction-mode pooler (`?pgbouncer=true&connection_limit=1`), so holding a lock across a slow external call would have been risky.
- Stale-RUNNING self-heal: a `RUNNING` row older than **10 minutes** is closed out as `FAILED` before a new sync proceeds. No real historical duration sample was available (local dev DB's sync-log history had been reset; production Supabase was unreachable both times it was tried this session — the same recurring flaky-Wi-Fi issue, not new). Threshold instead derived from `packages/integrations/src/core/http-client.ts`'s own retry/timeout code: 10s timeout × 3 attempts + backoff ≈ 30.75s worst case per HTTP call; August's 8-call sync ≈ 246s worst case today, Cielo's 2-call sync ≈ 62s. 10 minutes leaves margin for both today's worst case and Priority 7's expected additional August locks.
- The action can never throw: `beginDeviceSync` itself is wrapped in try/catch, and the failure-path `finishDeviceSync` call has its own nested try/catch — a second, independent failure while trying to log the first no longer crashes the action to the page-level error boundary.
- `lastSyncedAt` only ever updates inside the `SUCCEEDED` branch — confirmed unchanged/correct. A distinct "Last attempt failed {time}" line was added so a failure is visible after a page reload, not just in the ephemeral inline button state.
- Zero-synced results are never shown as a generic "success" — three distinct, differently-colored outcomes: real count (green), zero-with-skipped (amber, names the mapping gap), zero-with-zero-skipped (amber, "provider returned 0 devices"), versus a thrown failure (red, separate branch entirely).
- Confirmed via direct code read (not assumed): neither `AugustClient` nor `CieloClient` exposes any lock/unlock or temperature-set method at all — both remain 100% read-only by construction, unchanged by this work.

**Verified, fresh, before commit**: typecheck 0 errors, lint 0 errors (pre-existing warning classes only), **241/241 tests pass**, production build succeeds. Committed as exactly the 5 files above (`git add` by explicit path list, not `-A`), pushed, Vercel deployed (`/api/health`/`/sign-in` both 200 post-deploy).

**Live production test results, from the user directly**:

- **August: full pass.** CONNECTED, SUCCEEDED, **7 records synced**, UI showed "Synced 7 devices.", Last synced updated. Matches expected exactly.
- **Cielo: partial — 3 synced, 1 skipped, not 5.** CONNECTED, SUCCEEDED, UI showed "Synced 3 devices (1 more discovered but skipped — no property mapping)." Investigated below.

### Cielo device-count investigation — real, external cause found; a real data-loss risk surfaced

Ran the existing `packages/integrations/src/cielo/scripts/check.ts` (real, read-only, no code changes) against the live account. **Result: Cielo's API currently returns only 4 devices, not 5 or 6**:

| Device                  | MAC          | Status  |
| ----------------------- | ------------ | ------- |
| Island Tides - Man cave | D8BFC0FE8756 | ONLINE  |
| Bahamas - Living Room   | D0EF7624CCD4 | OFFLINE |
| 7206 - Office           | C45BBEC42260 | ONLINE  |
| Sandy Nudes - Garage    | 781C3CB9ED6C | ONLINE  |

- **The 1 "skipped" device is "7206 - Office" (`C45BBEC42260`)** — correct, by design. Kenny confirmed in Increment 21 this is his and Jenny's personal residence and must never be mapped. Not a bug.
- **The real gap**: two of the five originally-mapped devices — **"Ocean Pearl - SPA Room" (`B48A0AF68C2A`)** and **"Miramar Blis - MIL" (`781C3CBADB1C`)** — are missing from the live API response entirely (not skipped — simply absent). `CIELO_PROPERTY_MAP` itself is confirmed intact and working correctly (proof: every device that _was_ returned and _is_ in the map synced successfully). This is an external, provider-account-side change, not a StayWhile config/mapping problem — same class of finding as Increment 26's "August's 7 locks are the account's complete inventory." **Cause not assumed** — needs confirming with Michelle/Kenny (device removed from the account, physically disconnected, renamed, moved to a different login — unknown from here).

**Urgent, unresolved as of this note**: `pruneStaleDevices()` (`smart-devices.service.ts:92-100` — the same hard-delete function flagged as a real existing bug during the `ProviderDevice` architecture discussion, fix deferred to Priority 3, never implemented) runs on every Cielo sync and deletes any `SmartDevice` row not in the current result. Since Ocean Pearl and Miramar Bliss's Cielo devices weren't in this run's 4-device result, **this live sync almost certainly already deleted their `SmartDevice` rows from production**. **Not yet confirmed** — production Supabase was unreachable both times this was checked this session. **Verify this the moment Supabase is reachable, before assuming either outcome.** If confirmed, this is real evidence for prioritizing the `ProviderDevice`/soft-deactivate fix sooner rather than treating it as purely deferred — noted, not decided, not actioned.

**Nothing hardcoded, no guessed mapping, no code changed as part of this investigation.**

### New client requirement — Full Smart Device Management (Locks + Thermostats control) — recorded, NOT started

Second-meeting follow-up from the user: the client wants the dashboard to eventually provide **operational control**, not just read-only monitoring, for both Locks and Thermostats. Recorded here in full so it isn't lost; **nothing below has been designed in detail or implemented**.

**Locks section, expanded scope** (beyond current read-only monitoring): keep existing Online/Offline + Battery/Low-Battery, add — Locked/Unlocked status, Lock door, Unlock door, view property/device link (already exists), generate guest access codes, set access-code start/expiration date-time, view active access codes where the provider permits, revoke/delete access codes where supported, reservation-linked guest code generation where supported, clear success/failure feedback per command, audit/history record for control actions.

**Thermostats section — needs its own dedicated page**, not just the homepage summary tile (today's `/thermostats` page is read-only/monitoring only — see Increment 28). Per-thermostat: Property, Provider, device name, Online/Offline, current temperature, current setpoint, current mode (Heat/Cool/Auto/Off) where available, heating/cooling state where available, last synced. Write access where supported: change setpoint, change HVAC mode, on/off via provider-supported modes, command success/failure feedback, audit/history log.

**Homepage stays exactly as-is** — the client's original four requirements (August lock problems esp. offline/low-battery, Thermostat problems esp. offline, Today's check-ins, Today's check-outs, due/upcoming cleanings, Rescheduled Cleanings) remain the homepage's scope. Detailed controls belong only in the dedicated Locks/Thermostats sections, never the homepage.

**Explicit standing safety/rollout rule**: current read-only behavior is intentional while integrations are still being completed/verified — **do not remove read-only restrictions globally**. Control must be enabled **provider by provider and capability by capability**, only after confirming, per capability: (1) the provider API officially supports the operation, (2) the credentials/scopes actually authorize it, (3) the device is correctly mapped to the property, (4) RBAC restricts the control to the right StayWhile users, (5) commands have clear confirmation/error handling, (6) the action is auditable. **Never expose a control button for a capability that isn't verified-supported and implemented** — never fake a successful command. Different providers will expose different real capabilities; the UI must reflect that honestly, not assume uniform capability across Nest/Cielo/August/Honeywell/Ecobee.

**Current control-capability status, per connected provider — direct, no research performed beyond what's already true in this repo today**:

| Provider         | Read (implemented)                                              | Write/control (implemented)                                                                                                                             |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| August           | ✅ list locks, battery, online/offline                          | ❌ **zero** — `AugustClient` has no lock/unlock method at all today, deliberately (Increment 19: "read-only, intentionally")                            |
| Cielo            | ✅ list devices, online/offline                                 | ❌ **zero** — `CieloClient` has no setpoint/mode method at all today                                                                                    |
| Nest             | ✅ discovery proven (33 devices, staging-only per Increment 31) | ❌ not attempted; the OAuth scope granted (`sdm.service`) has not been checked against Google's read-vs-write scope boundaries — unconfirmed either way |
| Honeywell/Ecobee | ❌ not connected at all yet                                     | ❌ not connected at all yet                                                                                                                             |

**Every provider's control capability is genuinely unresearched beyond this table** — whether August's real API (via the `yalexs` reference library) or Cielo's real API support lock/unlock or setpoint commands at all hasn't been verified in this engagement. That research is real, separate, future work — not done as part of recording this requirement, and explicitly not started per the user's instruction to finish the Cielo investigation first and not begin control implementation this increment.

**Status**: requirement recorded only. No design, no schema, no code, no capability research beyond the table above. Waiting on the user before any of this becomes active work — and still gated behind the `ProviderDevice` dynamic-mapping foundation (Priority 3) landing first, since exposing device _control_ before device _mapping_ is dashboard-managed would compound the exact hard-coding problem Kenny's standing requirement already rules out.

---

## Increment 34 — 2026-08-20: Michelle's clarification on the August offline-lock report and lock/thermostat scope — recorded before investigation

User relayed a direct clarification from Michelle after the assistant's read-only investigation of "only 3 of 7 August locks visible" (Increment 33) found all 7 rows genuinely present — the real question was never a missing-record problem.

### 1. All 7 August locks are expected to be ONLINE — investigation reopened, not closed

Production actually shows **7 Total, 3 Online, 4 Offline, 0 Low Battery** — all 7 rows exist (confirmed in Increment 33), so the earlier "3 of 7 visible" framing was answered, but **Michelle has now clarified all 7 locks should show Online**, which reopens the real question: why are 4 genuinely showing Offline. To investigate, not assume:

- Whether August is really reporting those 4 as offline right now (live check).
- Whether StayWhile is reading the wrong August field (bridge/connectivity mapping logic).
- Whether the sync isn't refreshing those 4 specific devices.
- Whether the dashboard is showing stale status from an earlier sync.
- Any other verified cause.
- **Also**: why the same 4 Offline rows' "Last synced" timestamps behave differently from the 3 Online rows' — verify status and timestamp behavior together, end to end.

**Explicit standing instruction**: do not change `OFFLINE` to `ONLINE` in the database or UI to resolve this. The dashboard must show the provider's real state — whatever that state turns out to be.

### 2. August lock **code management** — new client requirement, investigation-only for now

Michelle clarified the StayWhile team will actively manage guest/access codes through the dashboard — the Locks section can't stay monitoring-only long term. Wanted, where the provider API actually supports it: view existing access codes/PINs; generate/create a new guest code; assign a code to the correct lock/property; set start/activation date-time; set expiration/end date-time; modify an existing code if supported; revoke/delete a code; show code status (active/scheduled/expired); show which reservation/guest a generated code belongs to, when that relationship exists.

**Explicit standing instruction**: do not guess API capabilities, do not build fake controls. Inspect the real August/Yale client and provider API behavior first, report exactly what's supported before any code is written. Since creating/deleting codes is a real device/security action: needs authorization, validation, confirmation, audit logging, and clear success/failure feedback — never exposed to every dashboard user automatically.

### 3. Keep monitoring separate from controls

The existing lock summary (Total/Online/Offline/Low battery, Property, Lock name, Provider, Battery, Last seen) stays as-is. A distinct **Access Codes / Code Management** area is wanted for the operational code work — not merged into the monitoring table.

### 4. Thermostats — get the existing read-only page live and verified now; controls are a later, separate stage

Standing instruction reaffirmed: Thermostats belongs directly under Locks in the sidebar. **Immediate ask**: get the already-built read-only `/thermostats` page (Increment 28) actually live, visible, and verified — it was built but left uncommitted, status not reconfirmed since. Full thermostat write/control functionality is explicitly a separate, later stage — same standing rule as locks: no write/control capability gets enabled for any provider until that provider's real API permissions and behavior are verified first.

### Priority order for this pass, as given

1. Record this clarification in HANDOFF (this entry).
2. Investigate why 4/7 August locks show Offline when Michelle expects all 7 Online.
3. Investigate the August/Yale API's real access-code capabilities — report exactly what's safely exposable, nothing guessed.
4. Verify and expose the existing `/thermostats` page + nav entry.

**Standing rule restated**: no hard-coded device states, lock codes, thermostat values, or property mappings to make the UI look complete — everything shown or controlled must come from the real provider/integration or an explicitly dashboard-managed configuration.

**Status as of this note**: recorded only — investigation begins immediately after this entry, in the order above.

---

## Increment 35 — 2026-08-19/20: closed the August UNKNOWN-status bug (deployed, awaiting production test); Michelle plans to add more August locks to surface other hardware/connectivity architectures

### August UNKNOWN-status fix — implemented, committed, deployed

Full investigation (Increments 33-34 above) found `bridgeIsOnline()` collapsed "no `Bridge` object in the API response" into `OFFLINE` — a real bug, not a hardware problem. A live field-by-field audit of the real 7-lock fleet found three genuinely different hardware/firmware generations: `Type 15` locks return a `Bridge` object + real-time push data (reliable ONLINE/OFFLINE, unchanged by this fix); `Type 21`/`1005` locks never return `Bridge` at all, while three of the four still sent battery telemetry as fresh as the "online" locks — they were working, just unreadable through the field this integration checked. The fourth (`Type 1005`, Island Tides - Man Cave) had genuinely stale telemetry (~46h vs. the ~2-4h normal range).

Shipped: `UNKNOWN` added to `SmartDeviceStatus` (additive migration, single `ALTER TYPE ... ADD VALUE`, confirmed no existing rows touched). Bridge-absent locks now classify as `UNKNOWN`, never `OFFLINE`. `/locks` and the homepage both stop counting `UNKNOWN` as `OFFLINE` or auto-flagging it as critical — a device only needs attention for an explicit `OFFLINE` report, low battery, or stale telemetry (24h threshold, derived from the real observed fleet data, documented in code, not guessed). `/locks` gained separate `Connectivity`/`Lock state`/`Last synced` (StayWhile's own `updatedAt`)/`Last telemetry` (the provider's own timestamp) columns — "Last synced" no longer shows `lastSeenAt`, which used to null out on every offline classification even when the row had, in fact, just synced. Only safe fields (`batteryLevel`, `telemetryUpdatedAt`, `lockState`) enter `SmartDevice.metadata` — verified by a dedicated test. No lock-control or access-code write capability added.

**Committed (`13cea96`) and pushed** — 13 files, exactly the approved scope (schema + migration, August client/types, sync service, `/locks`, dashboard service + homepage component, plus matching tests at unit/e2e/dashboard level). Verified before commit: migration validated, lint/typecheck clean on both affected packages, 258 website + 61 integrations tests pass, production build succeeds. **Deployed, `/api/health` and `/sign-in` both confirmed 200 post-deploy.**

**Not yet done — waiting on the user's live production test** (checklist already given in chat): all 7 locks visible, expected 3 Online / 0 Offline / 4 Unknown split, Island Tides - Man Cave's distinct "telemetry stale" badge, Last synced vs. Last telemetry values, no false Offline badges anywhere. **Do not consider this bug closed until that test passes** — see "Current work order" below.

### New client note — Michelle plans to add more August locks specifically to surface other hardware architectures

Michelle, relayed by the user, in direct response to the UNKNOWN-status finding: _"If that's the case with the August connectivity, different lock models might require different connectivity fields, then I'll add more locks to your August access, in case there are types of locks that might have the same issue."_ She's granting the already-authorized StayWhile August account access to additional real locks, deliberately to help find any other lock model/connectivity architecture beyond the three already found (Type 15 / Type 21 / Type 1005).

**Standing protocol for when those locks appear — recorded now, not yet actioned:**

1. **No automatic property mapping, ever.** Michelle adding a lock to the August account only makes it _discoverable_ — it does not tell StayWhile which `Property` row it belongs to. Never guess from the lock name. This is exactly the case the already-planned `ProviderDevice`/admin-mapping architecture exists for — newly discovered devices get reviewed and explicitly mapped through the dashboard, not hard-coded into an env var. Not built yet; this note is why it matters here specifically.
2. **Discovery must be read-only**: run the existing `check.ts`-style live discovery, compare against the known 7-lock inventory, identify exactly what's new.
3. **Per new device, inspect only verified non-sensitive fields**: device name, `Type`, SKU/model, `Bridge` presence/status, `module`/`hostLockInfo` presence, pubsub/connectivity structure, `LockStatus` structure, battery %, battery telemetry timestamp, and any other connectivity field confirmed safe the same way this increment's investigation confirmed the existing ones — never PIN values, guest names, tokens, credentials, or access-code contents, matching the exact discipline already used throughout Increments 33-35.
4. **Connectivity classification stays conservative**: only classify ONLINE/OFFLINE when a verified signal supports it, exactly like the fix just shipped. A new/unrecognized hardware architecture defaults to `UNKNOWN` — never `OFFLINE`, never a guessed classification to make the UI look complete.
5. **No hard-coded model numbers or property mappings** added just to make new locks display correctly.
6. **Report before changing production logic** — new hardware/model groupings and a recommended connectivity-derivation approach get reported and approved first, same pattern as this entire investigation, before any code changes.

### Current work order, as given

1. **Do not interrupt** the user's live production test of the August UNKNOWN-status fix already deployed.
2. Once it passes: close the August status bug (mark resolved in this doc), then expose the read-only `/thermostats` section under Locks in the sidebar (page already built in Increment 28, still uncommitted — nav placement already correct).
3. When Michelle confirms the additional August locks have actually been added: run the expanded read-only discovery protocol above.
4. Access-code write/control functionality stays separate and un-started until its API operations are independently verified (per the standing Increment 33/34 findings — read is confirmed, write is unverified).

**Nothing implemented this entry — documentation only, per explicit instruction.**

---

## Increment 36 — 2026-08-20: 44-lock August discovery closes the connectivity-logic question and reopens the property-mapping priority — OwnerRez now comes before ProviderDevice mapping

### August UNKNOWN-status fix — validated against the real, expanded fleet

Michelle added more locks to the authorized August account specifically to stress-test the connectivity fix (Increment 35). Read-only discovery (no writes, no property mapping, no pins/guest data touched) found:

- **44 total locks discovered** (7 original + **37 new**).
- **A real correction to Increment 33/34's finding**: `Type` alone is _not_ a reliable connectivity discriminator — only 3 of 19 `Type 15` locks actually have a `Bridge` object; the other 16 don't. The true discriminator is the combination of `Bridge`/`pubsubChannel`/`LockStatus`-validity/`module`/`hostLockInfo` presence, which cuts across `Type` values.
- **4 distinct connectivity capability patterns** across all 44:
  - **Pattern 1 — full real-time signal** (Bridge + pubsubChannel + valid `LockStatus`): **3 locks** (Bonjour Front Door, Bonjour In Law, Aqua Palm Front Door — all original, all `Type 15`).
  - **Patterns 2-4 — no verified real-time signal, `UNKNOWN` by design**: **41 locks**, spanning `Type` 15 (16 new), 21 (3 original + 9 new), 20 (2 new), 1005 (1 original + 4 new), 1001 (5 new), 1007 (1 new).
- **Confirmed safe**: every one of the 41 `UNKNOWN` locks correctly avoids a false `OFFLINE` label under the already-shipped logic — this is the direct, empirical validation of the fix from Increment 35, now proven against 44 real devices instead of 7. **No further connectivity-logic refinement needed right now** — explicit user decision, not deferred by oversight.
- **7 locks with stale telemetry (>24h), flagged for attention, never treated as Offline**: Island Tides - Man Cave (~46h, already known), Flor Sun - Front Door (~25h), Bahamas - Front Door (~28h), Palm Haven - Front Door (~2.5 days), Spa lock (~6 days), "Delete Door" (~6 months), Royal Eden - garage Door (~3 years — likely genuinely dead/decommissioned, not a classification bug).
- **Explicit standing instruction**: do not remove, hide, or auto-classify suspicious-looking devices like "Delete Door" or "Royal Eden - garage Door" — surface them later as discovered devices for admin review, never assume based on their name or stale data alone.

### Property-mapping gap found — reopens and reprioritizes the ProviderDevice work

- **All 37 new locks are currently unmapped** — none of their house IDs are in `AUGUST_PROPERTY_MAP`. **Explicit instruction: do not add 37 new `AUGUST_PROPERTY_MAP` entries** — this is the real production case proving the standing `ProviderDevice`/admin-mapping architecture (Discovered → Unmapped → Admin maps to Property → Enabled/Operational) is needed now, not hypothetically.
- **34 of the 37 new locks have no matching StayWhile `Property` row at all** (by name, purely an observation, not a mapping decision) — only 3 (Bahamas, Ocean Pearl, Sandy Nudes) share a name with an existing property (created earlier for Cielo), and even those aren't in `AUGUST_PROPERTY_MAP` yet.
- **New priority decision**: because 34 of 37 locks have no property to map to at all, **OwnerRez's property sync (client's second-meeting requirement — "sync the full portfolio from OwnerRez, don't manually create properties one by one") must land _before_ building the `ProviderDevice` admin-mapping UI.** Building device-mapping UI against StayWhile's current 7-property inventory would be mapping most of these 37 locks to nothing. Revised implementation order below.

### Revised implementation order

1. Keep the 37 new locks read-only/discovered-only — **no `SmartDevice` rows created for unmapped locks**, no property mapping, no `AUGUST_PROPERTY_MAP` expansion.
2. Expose the already-built read-only `/thermostats` page under Locks in the sidebar (next, this same session).
3. **OwnerRez property sync/backfill** (read-only investigation → safe backfill design → implementation) — bring in the full real portfolio, preserve the existing 7 `Property` UUIDs where safely matchable, prevent duplicates. This is now the next real body of work, ahead of device mapping.
4. Only after that: build the `ProviderDevice`/admin-mapping UI so the 37 discovered August locks (and future Cielo/Nest/Honeywell/Ecobee devices) can be explicitly mapped to real properties — no name-based auto-mapping, admin confirmation required for every mapping, same standing rule as everywhere else in this project.

### What the user told Michelle (for continuity, not a new decision)

The user sent Michelle a summary along these lines: August now returns 44 locks total (up from 7), only 3 expose a verified real-time connectivity signal so the rest correctly show as Unknown rather than a false Offline, several locks have older telemetry surfaced separately as an Attention Needed condition, and the 37 newly discovered locks confirm why the dynamic mapping setup is needed — once the property list is synced from OwnerRez, discovered devices will be reviewable and mappable directly from the dashboard.

**Nothing implemented yet in this entry beyond documentation** — `/thermostats` exposure and OwnerRez work follow immediately after, per the order above.

---

## Increment 37 — 2026-08-20: `/thermostats` timestamp fix shipped; full OwnerRez audit completed (read-only, nothing implemented)

### Thermostats timestamp fix (shipped)

`ThermostatsList.tsx`'s "Last synced" column was reading `lastSeenAt` (nulls out whenever a device is offline) instead of `updatedAt` — the same bug class already fixed on `/locks`. Fixed to match Locks exactly: "Last synced" now reads `updatedAt`; a separate "Last telemetry" column reads `getTelemetryUpdatedAt()`, correctly rendering "—" for Cielo (which doesn't populate that metadata key) rather than inventing a value. Lint/typecheck/258 tests/build all passed. Committed `0f2ffc7`, pushed, production health-checked (`/api/health` and `/sign-in` both 200 post-deploy). Single-file change, no other Thermostats work done per explicit instruction not to re-polish this increment.

### OwnerRez audit (read-only — no writes to OwnerRez, no writes to any database, two throwaway scripts used and deleted immediately after)

1. **Vercel Production credentials**: **could not be verified this session** — the Vercel CLI here has no stored auth token and no linked `.vercel/project.json` exists in the repo, so `vercel whoami`/`vercel env ls` hang on an interactive login this session can't complete. Same unresolved-credential-location risk pattern as the original Sync Now bug (`AUGUST_PROPERTY_MAP` present locally, missing in Production). **Needs a safe, identity-verified check next session** — see "Next: Vercel Production verification" below.
2. **Client code**: real, not stubbed. `connect`, `disconnect`, `authenticate`, `healthCheck`, `validateCredentials`, `listProperties`, `listBookings`, `getGuest`, `sync("INBOUND")` all make genuine HTTP calls. Only `receiveWebhook()` is a stub (undocumented payload shape, not a credential gap).
3. **Endpoints implemented**: `GET /properties`, `GET /bookings` (+ `since_utc`), `GET /guests/{id}`.
4. **Real property data reaching the dashboard**: no. Only `listBookings()` reaches the dashboard, as a 5-item read-only "upcoming bookings" preview. No OwnerRez data is ever written to the database — `sync("INBOUND")` deliberately only counts and returns.
5. **`Property.ownerRezPropertyId` usage**: dormant. Repo-wide grep found exactly one hit — its own definition in `schema.prisma`. Never read or written anywhere.
6. **Live property count** (checked live, read-only `GET /v2/properties`, 2026-08-20): **20 properties, all active, single page** — matches the 2026-08-15 verification, still accurate.
7. **Real fields OwnerRez returns** (confirmed live, not just docs): `id`, `key`, `name`, `external_name`, `internal_code`, `active`, `is_snoozed`, `address` (street1/street2/city/state/postal_code/country), `property_type`, `bedrooms`, `bathrooms`/`bathrooms_full`/`bathrooms_half`, `max_guests`/`max_adults`/`max_children`/`max_pets`, `check_in`, `check_out`, `currency_code`, `latitude`, `longitude`, `owner_id`, `public_url`, `thumbnail_url*`. No `amenities` field. No incremental (`since_utc`) filter on this endpoint — any sync must be a full pull (cheap at 20 rows). OwnerRez has its own `internal_code` — a second matching key alongside `id`/`key`.
8. **Matchability of existing StayWhile properties** (checked against the **local dev DB only** — no production DB connection available this session, production may differ and should be re-checked before real sync work): local dev has 9 non-deleted `Property` rows (2 are demo seed rows, `DEMO-001`/`DEMO-002`, expected to never match). Of the 7 real rows, name-based comparison against the live 20 found: **Ocean Pearl** and **Bonjour AMI** — exact name/internal_code match; **Miramar Bliss** — close but not exact ("Miramar-Bliss" / internal_code "Miramar Bliss 2") — flag for review, not auto-linked; **Aqua Palm, Bahamas, Island Tides, Sandy Nudes** — no OwnerRez counterpart found at all. So **17 of the 20 real OwnerRez properties have no matching StayWhile row in local dev.** No `ownerRezPropertyId` was written anywhere — these are candidates for human confirmation only.
9. **Files that would need to change**: `packages/integrations/src/ownerrez/types.ts` (widen `OwnerrezProperty` to the real field set above), a new `ownerrez-sync` service function (matching + report logic, no auto-apply), a new admin-review UI for confirming proposed matches, and `HANDOFF.md`.
10. **Schema/migration**: **none needed.** `Property.ownerRezPropertyId String? @unique` already exists and is unused — ready to hold confirmed mappings.

### Approved plan (design only, not built yet)

Full pull of `GET /v2/properties` (no incremental filter exists) → match in strict order (`ownerRezPropertyId` exact → `internalCode` exact, reported for confirmation, never auto-linked → unmatched either side reported, never created/deleted automatically) → writes are update-only for already-confirmed matches, never delete-on-missing (same lesson as the `pruneStaleDevices` data-loss incident) → nothing written back to OwnerRez → every run outputs a structured report (`alreadyLinked`/`proposedMatches`/`unmatchedOwnerRez`/`unmatchedStayWhile`), never a silent boolean.

### Next: Vercel Production verification (client-isolation-critical — user has multiple client accounts)

Before touching Vercel at all next session: verify which Vercel account/team the CLI is authenticated to, verify this repo is linked specifically to the StayWhile `stayawhilewithus-website` project, never inspect/modify/deploy any other client's project, never change env var values — only check whether `OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` exist by name in Production. This session could not even reach the identity-verification step (CLI unauthenticated) — needs the user to authenticate the CLI (or confirm via the Vercel dashboard directly) before any check proceeds.

### After OwnerRez: return to second-meeting priorities, Notion next

Once Production credentials are confirmed and OwnerRez is implemented (read-only, admin-reviewed mappings, no guessing, no auto-overwrite of existing properties), the next approved priority is **full Notion connection** — dashboard search of authorized Notion content (no demo results), automated monthly Notion backup (what's backed up, where, naming/versioning, retention, failure reporting, how it runs while n8n is unresolved), and altered/deleted-page awareness (verify actual Notion API capability first, no promising real-time events it doesn't support). Full requirements already recorded from the second client meeting.

---

## Increment 38 — 2026-08-22: Nest production verification, RBAC fixes deployed, real permission discrepancy found — unresolved, resume here

### Nest production status

Production's Nest connection is real and working. A production discovery run returned 33 real Nest thermostats, all of which correctly stayed Discovered/Unmapped — discovery created zero `SmartDevice` rows automatically. Capability distribution: 32 devices report Heat/Cool/Fan, 1 reports Cool/Fan only. Discovery's `IntegrationConnection.lastSyncedAt` and the `ProviderDevice` timestamp range were cross-checked against each other and found internally consistent (same run wrote both).

**Aqua Palm - Living room** was manually mapped to the Aqua Palm property and then Enabled — the only Nest device enabled so far, a deliberate single controlled test, not a bulk rollout. Enable itself is confirmed, from direct code inspection, to send zero Nest API/device commands — it's a pure local DB transaction that upserts a `SmartDevice` row from the already-stored discovery snapshot. `/thermostats` went from 3 thermostats (the 3 Cielo devices) to 4 immediately after Enable. Telemetry displayed successfully: 73°F current, 72°F target, mode COOL, 52% humidity, at the time of the verification screenshot.

The telemetry-timestamp fix shipped this session is live: `toSmartDeviceMetadata()` now requires an explicit `observedAt`, and the Enable path passes the real `ProviderDevice.lastSeenAt` (the actual discovery time) instead of fabricating "now" — so "Last telemetry" on this row reflects when Nest was actually last polled, not when someone happened to click Enable.

**Do not enable any of the remaining 32 discovered Nest devices yet.** No physical Nest command (Heat/Cool/Fan/Mode) has been sent or tested — that gate is still fully closed, independent of the RBAC issue below.

### Production deployment

Commit `3224dc5` was pushed to `main` this session. Contents: the thermostat telemetry-timestamp fix, the Nest ghost-row visibility fix (a Nest `SmartDevice` row is now hidden from `/thermostats` once its `ProviderDevice` is unmapped or disabled, instead of lingering with stale data), and the RBAC scope/expiry fixes (see below). `/api/health` returned `HTTP 200` (`{"status":"ok"}`) both immediately post-push and again later in the session, fresh (`x-vercel-cache: MISS`, `age: 0`), not a stale cached response.

**Vercel CLI must NOT be authenticated from this Client C environment.** Confirmed again this session, matching the earlier documented finding above (Increment "Vercel Production verification"): a `vercel whoami` call with no stored credentials immediately starts an interactive OAuth device-login flow — this was deliberately killed, not completed, both times it's happened across sessions. Deployment verification must go through the user checking the Vercel dashboard directly, or the public `/api/health`/`/sign-in` endpoints — never through an authenticated CLI session from inside Claude Code here.

### RBAC production state

`thermostats:manage` now exists as a real `Permission` row in production. Granted roles: **`admin`, `ops_manager`** (deliberately, per explicit client-approved scope — not the other four roles). Confirmed NOT granted: `cleaner`, `front_desk`, `maintenance_tech`, `read_only`.

Applied via a purpose-built minimal script (`grant-thermostats-manage.mjs` — see below), never via the full `prisma/seed.ts`, which was explicitly audited and rejected for production use this session (see "Local operational safety").

A read-only production diagnostic (`diagnose-thermostat-permission-denial.mjs`) confirmed, directly against production data:

- **`ryskris0@gmail.com`**: exactly one `User` row, Clerk-linked, `ACTIVE`, `admin` role at **Global** scope, `expiresAt = null`, admin role confirmed to have `thermostats:manage` via `RolePermission`, and the live replay of `getEffectivePermissions()`'s exact query resolves `thermostats:manage` as granted (effective = YES).
- **`admin@stayawhilewithus.com`**: exactly one `User` row, `ACTIVE`, `admin` role at Global scope, `expiresAt = null`, same effective result (YES). **Its `clerkUserId` is still the seed placeholder `seed_pending_clerk_link`** — this account has apparently never completed a real Clerk sign-in linking of its own; this needs verification before relying on it for live device control, separate from the open issue below (Kenny/Michelle are currently signed in as this shared login for dashboard browsing only, not device control).

### OPEN ISSUE — resume here next session

While logged in as `ryskris0@gmail.com`, Aqua Palm's enabled Nest thermostat rendered:

> View only — no permission to control this device

This directly conflicts with the production RBAC diagnostic above, which shows this exact user has effective `thermostats:manage = YES`.

**Do not modify `User`/`UserRole`/`RolePermission` data — production RBAC data has been verified correct**, not the suspect. A full code trace (`getCurrentUser()` → `AuthContext` → `getEffectivePermissions()` → `/thermostats/page.tsx`'s per-property `hasPermission()` calls → `canManageByPropertyId` → `ThermostatsList.tsx` → `canRenderNestControls()`) found no bug in any hop, cross-checked against every plausible category (wrong Map/Set key, UUID mismatch, Promise-ordering, inverted boolean, bad `??` fallback default, propertyId lost across the server/client boundary, stale prop name, and a stale-compiled-`@stayw/auth`-package hypothesis — `packages/auth` has no build step and no `dist/`, ruled out empirically). A new regression test, `apps/website/src/domains/smart-devices/services/thermostat-permission-gating.test.ts`, wires the **real** `hasPermission()` and `canRenderNestControls()` together (not reimplementations) against a fixture reproducing this exact confirmed production data shape, and it **passes** — the application code, as committed in `3224dc5`, correctly grants controls for this scenario in isolation.

**Therefore the next investigation must focus on the actual production runtime/request — deployment timing, browser/session cache state, and the resolved `actor` for that specific request — not more speculative RBAC changes.** Ruled out so far, with evidence: server-side static/ISR caching (route is fully dynamic — Clerk's `auth()` forces this, confirmed via `grep` finding zero `dynamic`/`revalidate` overrides anywhere in the route or its layouts) and edge/CDN caching (checked live: `x-vercel-cache: MISS`, `age: 0`). **Not ruled out**: the Next.js App Router client-side Router Cache serving an already-open, not-yet-refreshed browser tab a stale render, or the screenshot having been taken during Vercel's build window before the `3224dc5` deployment actually went live — neither is verifiable from outside without either a hard refresh or dashboard deployment timestamps.

**First next-session step**: have Kris hard-refresh (or open a fresh incognito window and sign in fresh) on `/thermostats` and check whether Aqua Palm still renders "View only."

**If still reproducible**, the next step is a minimal, temporary, server-log-only production diagnostic — already designed, not yet implemented or deployed, pending explicit approval:

- One small, clearly-labeled, easily-`git revert`-able insert into `/thermostats/page.tsx` only.
- Logs one line to Vercel's server-side Function Logs (never rendered to the browser): the resolved `actor.userId`, the full `canManageByPropertyId` map (property-id → boolean, includes Aqua Palm's `propertyId` and the live `hasPermission()` result for it), and `process.env.VERCEL_GIT_COMMIT_SHA` (a Vercel-injected env var, no new setup needed) to definitively answer whether `3224dc5` is actually what's live.
- Explicitly excludes: email, Clerk ID, tokens, credentials, full permission-key lists, any other user's data — nothing new is exposed in the browser UI at all.
- No DB writes, no Nest commands, during this diagnostic step or its removal.

### Other smart-device integrations

**Cielo**: production currently shows 3 Cielo thermostats (Bahamas Living Room, Island Tides Man cave, Sandy Nudes Garage). Detailed temperature/mode/humidity telemetry is currently blank for all three — this is a real, separate, not-yet-investigated gap (consistent with the already-known fact that `CieloClient.listDevices()` only ever returns name/online status, never temperature/mode/humidity — see `smart-devices.service.ts`'s own comment).

**August locks**: the integration/code exists but has **not** yet received the same end-to-end production verification Nest just got this session. Do not describe August as fully production-tested — that work hasn't happened yet.

**Priority order after the Nest permission discrepancy is resolved and one controlled Nest command is deliberately, explicitly tested**: August production verification next, then Cielo telemetry/inventory investigation.

### Testing users

Kenny and Michelle are currently using the shared global-admin login `admin@stayawhilewithus.com` for testing. They may browse/test the dashboard now. **Do not have them issue any Nest thermostat command or real lock command** until the permission/runtime issue above is resolved and controlled-command testing is explicitly approved.

### Local operational safety

- Before any production database write, always run `diagnose-db-target.mjs` first and confirm it reports the StayWhile Supabase project `bsyjuufnwjyzfchmxgiv` — both `DATABASE_URL` and `DIRECT_URL` should resolve to host `db.bsyjuufnwjyzfchmxgiv.supabase.co`, port `5432`, database `postgres`.
- Shell cleanup after any production command: `unset DATABASE_URL DIRECT_URL`.
- **Do not run the full production seed (`prisma/seed.ts` / `pnpm db:seed`) for RBAC-only changes.** Audited this session and confirmed unsafe: `seedDemoData()` unconditionally writes fake `Property` (`DEMO-001`/`DEMO-002`), `Guest`, `Reservation`, `CleaningSchedule`, `MaintenanceRequest`, `Task`, `Notification`, `MessageThread`, `AiConversation`, and `AuditLog` rows with no env-var gate protecting any of it — and would also create 6 fake demo `SmartDevice` rows whenever `AUGUST_ACCESS_TOKEN`/`CIELO_USERNAME`/`CIELO_PASSWORD` aren't set inline (confirmed true for a plain `DATABASE_URL`+`DIRECT_URL` shell invocation, since `packages/database/.env` holds neither key). Use the narrow `grant-thermostats-manage.mjs` script instead for any future RBAC-only production change.

### Diagnostic/read-only scripts created this session — local operational tooling, currently untracked (not committed)

All in `packages/database/`, all syntax-checked via `node --check`, all safe by construction (read-only ones make zero write calls; the two RBAC scripts below are narrowly-scoped by design):

- `diagnose-db-target.mjs` — read-only; prints which DB host/project `DATABASE_URL`/`DIRECT_URL` would actually resolve to, without ever connecting. Run before any production write, always.
- `check-nest-discovery.mjs` / `verify-nest-discovery-result.mjs` — read-only; verify Nest discovery ran and produced the expected Discovered/Unmapped invariants.
- `list-nest-mapping-candidates.mjs` — read-only; lists discovered Nest devices alongside active properties (with existing-thermostat and today's-occupancy flags) to support a human, non-automatic mapping decision.
- `check-thermostats-permission.mjs` — read-only; reports `thermostats:manage`'s existence, granted roles, a specific user's effective grant (GLOBAL vs. property-scoped), and which roles can see `/thermostats` controls but lack the permission to use them.
- `grant-thermostats-manage.mjs` — the approved minimal RBAC-only production script. Writes exactly `permission.upsert` for `thermostats:manage` plus `rolePermission.upsert` for `admin` and `ops_manager` only; nothing else. Has a `DRY_RUN=1` mode. Already used against production this session.
- `rollback-thermostats-manage.mjs` — pairs with the above; one `permission.delete`, cascading (via the schema's `onDelete: Cascade`) to remove exactly the two `RolePermission` rows the grant script creates. Has a `DRY_RUN=1` mode. Not needed/used — kept in reserve.
- `diagnose-thermostat-permission-denial.mjs` — read-only; the tool that produced the RBAC diagnostic findings in the Open Issue above. Takes `TARGET_USER_EMAILS` (comma-separated) and an optional `TARGET_PROPERTY_ID`, reports `User`/`UserRole` state per email side by side, and live-replays `getEffectivePermissions()`'s exact query.

None of these are wired into the app; none run automatically. Consider committing them as dedicated ops tooling in a future session if they keep proving useful, or deleting them once the open issue above is resolved — not decided yet.

## Increment 39 — 2026-08-24: priority pivot to OwnerRez+Notion; deployed the Nest diagnostic; completed a full August capability audit; completed OwnerRez and Notion production-verification audits — all read-only, nothing implemented for OwnerRez/Notion beyond what already existed

### Nest diagnostic deployed

The server-log-only diagnostic designed in Increment 38 was implemented exactly as scoped (narrower than originally proposed, per explicit user direction: logs only `actorUserId`, `aquaPalmPropertyId`, `aquaPalmCanManage` — derived from the already-computed `canManageByPropertyId` map, no new permission query — and `commitSha`; never the full map). Typecheck/tests(304 passing)/build all green. Committed (`da8ac61`) and pushed to `main` after explicit approval. **Not yet acted on**: needs a fresh `/thermostats` request as `ryskris0@gmail.com` followed by a Vercel Function Logs check for the `[nest-diag]` line — see the priority-pivot banner at the top of this file for the exact resume state. A fresh-incognito re-test (before this diagnostic was deployed) already **confirmed the "View only" discrepancy is reproducible**, ruling out stale browser/router cache as the cause.

### August capability audit — read-only, zero writes, zero commands, zero PIN changes

Full findings, condensed (see the priority-pivot banner above for the top-line summary):

- **Credentials**: `AUGUST_IDENTIFIER`/`AUGUST_INSTALL_ID`/`AUGUST_ACCESS_TOKEN`/`AUGUST_BRAND` (names only), via a one-time interactive 2FA login (`packages/integrations/src/august/scripts/login.ts`), not a static API key.
- **Discovery/sync path**: `syncAugustDevices()` (`smart-devices.service.ts:140-250`) → `AugustClient.listLocks()` (returns everything the account has, live) → each lock's `houseId` checked against `AUGUST_PROPERTY_MAP` → no match → `skipped.push(...); continue` (line 174-177), **never written anywhere** → match → `getLockDetail()` + `prisma.smartDevice.upsert()`. `/locks/page.tsx` reads only from the DB, no live call at render time.
- **Mapping mechanism**: hard-coded `AUGUST_PROPERTY_MAP` env var only — confirmed the sole mechanism. No `ProviderDevice`-based admin-mapping flow exists for August (that table's only writer in the whole repo is Nest's discovery script).
- **Why 7 locks now vs. 44 previously discovered — definitive answer**: the 37 were never persisted anywhere. They were observed via the real, committed, genuinely read-only script `packages/integrations/src/august/scripts/check.ts` (zero DB import, zero write call) — its terminal output was hand-transcribed into Increment 36, never stored. `AUGUST_PROPERTY_MAP` still only lists the original 4 properties, so the sync loop silently discards the other 37 on every run. **Exact same pattern as the pre-Phase-A-D Nest "33 devices" figure** — except August never got a Phase-A-D equivalent built.
- **Read capabilities implemented**: locked/unlocked state (only when provider confirms validity), tri-state connectivity, battery %, last-sync/last-telemetry timestamps. **Not captured anywhere**: lock model/Type/SKU — not even parsed from the raw API response.
- **Write capabilities**: genuinely absent, not merely unused — grepped the full codebase, zero lock/unlock/PIN method exists anywhere. `AugustClient`'s own doc comment states outright: "Read-only: does not implement lock/unlock." `yale/client.ts` is a 100% stub. PIN create/edit/delete don't exist in the `yalexs` reference library at all, regardless of implementation effort.
- **RBAC**: no dedicated `locks`/`access_codes` permission resource exists — lock read is gated by the existing `smart_devices:read` (same two roles as thermostats: `admin`, `ops_manager`). No lock-control permission key exists because no lock-control code exists to gate.
- **Safest next single test (not yet run, awaiting approval)**: a read-only re-run of `check.ts` against the real Production August account, to confirm the current 7-lock data is still fresh — the August equivalent of what `check-nest-discovery.mjs` did for Nest.
- **Safest lock for a first controlled write test, later**: Aqua Palm - Front Door (same property as the Nest test property; ONLINE, 99% battery, fully verified real-time connectivity signal per Increment 20's data) — not being tested now, flagged for a future explicitly-approved pass only.

### OwnerRez production-verification audit — read-only, zero writes, zero live calls this pass

- **Integration code**: `OwnerrezClient` (`packages/integrations/src/ownerrez/client.ts`) is real — `connect`/`listProperties`/`listBookings`/`getGuest`/`sync("INBOUND")` all genuine HTTP Basic-Auth calls to `api.ownerreservations.com/v2`. Only `receiveWebhook()` is unimplemented (undocumented payload shape). No `getProperty(id)` detail endpoint exists yet — only the list endpoint.
- **Production credentials/authentication**: confirmed present and working — per the existing 2026-08-21 record in this file (`OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` added to Vercel Production, a self-deleting diagnostic returned valid credentials + 20 real properties). **Not re-verified with a new live call this session** — this is a citation of prior work, not a fresh check.
- **Real API read status**: properties — proven live in Production (above). Bookings — proven live in local dev only (19 active + 1 canceled), not re-checked in Production.
- **Any OwnerRez data stored/synced in the DB today**: **no.** `sync("INBOUND")` deliberately only counts bookings and returns — writes nothing. `Property.ownerRezPropertyId` and `Guest.ownerRezGuestId` both exist in the schema but are grepped repo-wide as **written nowhere, read nowhere**, outside their own field definitions.
- **Where the dashboard's current 7 real properties actually come from**: manually, through the app's own `createProperty()` action (`properties.service.ts:26`) — confirmed by elimination, since no OwnerRez call exists anywhere near property creation, and the seed script only ever creates 2 fake demo rows (`DEMO-001`/`DEMO-002`), never the real properties.
- **What's missing for OwnerRez to become source of truth**: a property-sync service and an admin-review mapping UI — both fully designed (strict-order match: `ownerRezPropertyId` exact → `internalCode` exact → everything else reported for human review only, never auto-linked), zero code written _as of this increment_ — **superseded by Increments 40/41 below, which built the preview/apply/create split and committed it in the isolated `worktree-ownerrez-property-sync` worktree (commit `46c4d6e`); not merged to `main`, not deployed**. `OwnerrezProperty`'s type also doesn't model address/bedrooms/bathrooms/etc. yet — only `id/name/key/active`.
- **Last known real match report** (local dev only, not re-run against Production): 2 exact matches, 1 close-not-exact, **17 of 20 real OwnerRez properties had no StayWhile counterpart at all**.
- **Reservation sync**: only a live, ephemeral 5-item "upcoming bookings" dashboard tile (`getOwnerRezHighlights`, `integrations.service.ts:373-397`), fetched fresh every page load, never persisted to `Reservation`/`Guest`. No webhook, no polling job, no scheduled sync exists anywhere.
- **Airbnb-alteration-notification feasibility**: genuinely unresearched at the API level — not a guess, just never investigated. `receiveWebhook()`'s payload shape is an explicitly open design question in its own code comment and README.
- **n8n vs. direct-backend architecture**: confirmed direct-backend only, always has been — n8n has zero OwnerRez credentials (or any provider credentials) today; per this file's own n8n section, n8n "cannot run these syncs itself today without credential duplication."
- **Safest next step (not yet run, awaiting approval)**: re-run the already-written, self-deleting `packages/integrations/scripts/ownerrez-property-inventory.ts` against Production (read-only, no writes) to produce the full field-level property dump and the real bucketed match report — this was already pending before this session and remains pending.

### Notion production-verification audit — read-only, zero writes, zero live calls, zero interaction with Michelle's real workspace this pass

- **Two separate Notion credentials exist — do not conflate them.** App-level `NOTION_API_KEY` (real Bearer token, `.env.example:39`, used in `integrations.service.ts:322`): proven live 2026-08-15 in **local dev only** (100+ pages/databases, 4 real database schemas retrieved) — Production presence is unconfirmed. n8n-level "Notion account" credential (`notionApi` type, owned personally by Kenny Pham per `N8N_DISCOVERY.md`): existence re-confirmed 2026-08-24 via live n8n MCP `list_credentials` (see Increment 40) — still unused by any workflow. **Metadata existence only, not live-auth-tested** — see Increment 40 for what the read-only MCP surface can and cannot prove.
- **Workspace identity**: app-level, only recorded as "the real StayWhile workspace," no more specific name anywhere. n8n-level, explicitly Kenny's personal account per its own discovery doc.
- **n8n workflow usage**: **the credential is completely unused** — exactly one workflow exists in the entire n8n instance, and it's n8n's own auto-generated default scaffold (inactive, an unconfigured HTTP Request node, no auth wired in). Zero real automation of any kind currently runs in n8n.
- **App-side Notion code**: real but narrow — `packages/integrations/src/notion/client.ts` implements `validateCredentials`/`sync` (count-only, writes nothing)/`listRecentlyEdited` (titles/URLs/timestamps for the 5 most recent items only, never page content). Powers exactly one dashboard "Notion" tile, gated by the generic `integrations:read` permission (no Notion-specific RBAC resource exists).
- **Dashboard keyword-search status**: **does not exist at all.** No query-string search method anywhere in the client — Notion's real `/search` endpoint accepts a `query` param, it's simply never used. No `search`/`knowledge` domain exists anywhere in the app. Would be built from scratch.
- **Change/deletion-notification status**: **does not exist.** A generic `Notification` model exists in the schema (used elsewhere, zero Notion usage today) and existing webhook routes (`/api/webhooks/clerk`, `/api/webhooks/n8n`) establish a pattern a Notion route could follow — but there is no polling job, no diff logic, and no webhook receiver for Notion today. Whether Notion's real API even supports outbound webhooks for page changes has **never been confirmed against Notion's actual docs** — this file already flagged this exact gap back in the "Second client meeting" priorities section ("verify actual Notion API capability first, don't promise real-time events the API doesn't support"), and it's still unresolved.
- **Only mechanism provably buildable today with zero new unknowns**: polling `listRecentlyEdited()` and diffing against a stored "last seen" timestamp/state. A webhook-based approach requires first confirming Notion's API actually supports it.
- **Safest next step (not yet run, awaiting approval)**: confirm `NOTION_API_KEY` presence in Vercel Production (name-only, same pattern as the OwnerRez check) — plus ask the user to independently verify the n8n-side Notion credential is still valid via the n8n UI, since no tool here can reach it.

### OwnerRez — expanded architecture detail (2026-08-24, design confirmed against real schema; "still zero code written" below is superseded by Increments 40/41 — real code now exists, committed in the isolated `worktree-ownerrez-property-sync` worktree, not merged to `main`)

Confirmed by direct `schema.prisma` inspection this session (not assumed): the schema is already meaningfully prepared for this work, more than previously credited.

- **`Property.ownerRezPropertyId`** (`schema.prisma:137`) and **`PropertyStatus.ONBOARDING`** (`schema.prisma:692`) already exist — the property-matching plan's "no schema migration needed for this part" claim is now verified true, not just asserted.
- **`Guest.ownerRezGuestId`** (`schema.prisma:167`, unique nullable) already exists — ready for OwnerRez guest sync with zero migration.
- **`Reservation.source: ReservationSource`** already includes `OWNERREZ` (`schema.prisma:705`) and `Reservation` has a **compound unique constraint on `[source, externalReservationId]`** (`schema.prisma:213`) — the schema was already deliberately built to safely ingest reservations from multiple providers without ID collisions. This was not previously highlighted as clearly as it should have been.
- **Still needed, additive/nullable, not yet migrated**: `Property.ownerRezActive: Boolean?` and `Property.ownerRezLastSeenAt: DateTime?` (OwnerRez's active/inactive signal must stay genuinely separate from `PropertyStatus`, never auto-triggering deactivation).
- **`OwnerrezProperty` typed client** (`packages/integrations/src/ownerrez/types.ts:12-22`) only models `id`/`name`/`key`/`active` today — needs extending to the real detail-endpoint fields (address, `bedrooms`, `bathrooms_full`/`bathrooms_half`, `max_guests`, `property_type`, `time_zone`, lat/long) once `getProperty(id)` (`GET /properties/{id}`, not yet implemented in `client.ts` — only the list endpoint exists) is built.
- **Field-ownership policy** (already designed, see the "OwnerRez — revised field-ownership policy" section above): OwnerRez-owned/continuously-synced/null-safe-per-field vs. StayWhile-owned/never-touched-by-sync — unchanged, now cross-checked against the real schema and confirmed consistent.
- **Reservation/Guest persistence proposal (new this session, design only)**: sync writes a `Reservation` row only for a booking whose `propertyId` maps to an **already-confirmed-linked** property (never auto-creates a property from a booking); `Guest` is upserted by `ownerRezGuestId` (create if new, null-safe update if existing); a reservation is matched/updated by the existing `[source, externalReservationId]` unique key; cancellations/date-changes update the existing row's `status`/dates, never delete.
- **Airbnb alteration-notification feasibility**: confirmed genuinely un-researched at the API level (not "designed, not built" — literally never investigated). `receiveWebhook()` (`client.ts:149-154`) is an explicit open design question in its own code comment and the package README. Next real step is reading OwnerRez's actual webhook/API docs, not proposing an architecture yet.

### Notion — clarified verification-state distinction (2026-08-24)

Explicitly separating four states that were previously at risk of being conflated:

- **Known existing credential/configuration**: two separate credentials — app-level `NOTION_API_KEY` (`.env.example:39`) and an n8n-level "Notion account" credential (`notionApi` type, owned personally by Kenny Pham per `N8N_DISCOVERY.md`). Not necessarily the same token.
- **Previously verified connection (real, evidence-backed)**: app-level, proven live 2026-08-15 in **local dev only** (100+ pages/databases, 4 real DB schemas). n8n-level, only confirmed to _exist_ as a credential object (2026-08-06) — never proven to still authenticate.
- **Still cannot be proven via n8n MCP, even now that the connection is back (2026-08-24, Increment 40)**: the n8n-level credential's _live_ validity. The MCP surface (19 read-only tools) can confirm the credential object exists and its non-secret metadata, but exposes no create/execute/test-credential tool — so no live Notion API call can be made without adding a Notion node to a workflow and running it, which is out of scope. Proving live validity still requires either the n8n web UI's built-in credential "Test" button (no workflow needed) or a check at the app level (separate credential, see above).
- **Genuinely never verified by anyone**: `NOTION_API_KEY` presence in Vercel **Production** (2026-08-15 check was dev-only); whether the app-level and n8n-level credentials are the same integration; whether Notion's API supports outbound webhooks for page changes at all.
- **Read-only feasibility, both requested features**: keyword search is directly buildable — Notion's real `/search` endpoint already accepts a `query` param, simply unused today, fully non-destructive. Change/deletion detection: polling `listRecentlyEdited()` and diffing against a stored "last seen" state is the only mechanism provably buildable today with zero new unknowns; a webhook approach needs Notion API capability confirmed first. Neither feature touches or could touch Michelle's actual content — both are read-only by construction.

### New standing priority order (see banner at top of this file for the full statement)

1. **OwnerRez property source of truth** — admin-review matching page + property-sync service (design exists, zero code written _at the time this list was written_ — see Increments 40/41: built and committed in the isolated worktree, commit `46c4d6e`, not merged/deployed)
2. **OwnerRez reservations** — Guest/Reservation sync per the persistence proposal above
3. **Notion read/search** — query-capable search method + service + dashboard UI
4. **Notion change/deletion notifications** — polling-based diff first; webhooks only after Notion API capability is separately confirmed
5. **Nest** → finish verification/control
6. **August** → finish verification/control/PIN capabilities
7. **Cielo** → finish telemetry and control verification

Nothing has been implemented for OwnerRez or Notion this session — audits and architecture clarification only. No Production writes, no OwnerRez writes, no Notion writes (nothing in Michelle's real workspace was touched in any way), no bulk imports, no migrations, no deployment beyond the already-approved-and-pushed Nest diagnostic commit `da8ac61`, no Nest/August/Cielo commands, no RBAC changes, no credential values read or printed anywhere.

## Increment 40 — 2026-08-24 (fresh session): n8n MCP connection re-confirmed working; Notion read-only verification via n8n MCP

### n8n MCP connection — corrected finding

The note above and elsewhere in this file stating "no n8n tool is available from inside Claude Code in this environment" is **outdated as of this fresh session**. `claude mcp list`-equivalent tool availability was re-checked: **19 n8n MCP tools are loaded and callable** (`explore_node_resources`, `get_node_types`, `get_workflow_best_practices`, `get_workflow_details`, `get_workflow_execution`, `get_workflow_history`, `get_workflow_sdk_reference`, `get_workflow_version`, `list_credentials`, `list_n8n_connect_services`, `list_workflow_tags`, `search_data_tables`, `search_folders`, `search_nodes`, `search_projects`, `search_workflow_executions`, `search_workflows`, `validate_node_config`, `validate_workflow`). None of the 19 create, update, delete, activate, publish, or execute anything — the surface is read-only/inspection-only by construction. Per the finding at line ~1100, MCP availability is session-specific and must be re-checked each session; it should not be assumed connected or disconnected based on a prior entry in this file.

Used three of the read-only tools (`search_projects`, `list_credentials`, `search_workflows`) to re-verify the StayWhile n8n instance against `N8N_DISCOVERY.md`'s 2026-08-06 baseline. Result: **exact match, nothing changed**:

- **1 project**: `Kenny Pham <admin@stayawhilewithus.com>` (personal) — no other projects, no team projects, no cross-client data of any kind visible.
- **1 workflow**: `"My workflow"` (id `p9AsCYI5THw1oVLX`), inactive, 0 triggers, 2 nodes (`Manual Trigger` → unconfigured `HTTP Request`) — confirmed via `get_workflow_details`, no Notion (or any other service) node present.
- **3 credentials**: `Notion account` (`notionApi`), `Anthropic account` (`anthropicApi`), `Header Auth account` (`httpHeaderAuth`) — same three as the 2026-08-06 baseline, no new ones added.

No n8n modifications were made this increment — every call above is a read/search/get, never a create/update/delete/execute.

### Notion read-only verification via n8n MCP (Michelle's requested scope: keyword search of authorized Notion content + alter/delete notifications; hard rule: never modify Notion)

- **Credential existence**: confirmed. `list_credentials` returns `Notion account` (id `4VXm2JUDYsHUKKP6`, type `notionApi`, home project = Kenny Pham personal). Only non-secret metadata is ever returned by this tool (name/type/id/project/scopes) — no secret value was or can be read through it.
- **Workflow usage**: confirmed **zero**. The only workflow in the instance (`My workflow`) has exactly 2 nodes, neither of which is a Notion node — verified via `get_workflow_details` on its full node list, not inferred. The Notion credential is not wired into any workflow anywhere in this n8n instance.
- **Can the current MCP toolset validate the Notion connection itself (no workflow created/edited)?** **No.** All 19 tools were reviewed: `validate_node_config` and `validate_workflow` are schema/shape validators only (they check that node parameters or SDK code are well-formed) — neither makes a live call to any external API, and neither can test a credential's live authentication. There is no `test_credential`, `execute_workflow`, or equivalent tool exposed. `search_nodes` confirms the **Notion node type itself** is available in this n8n instance's catalog (`n8n-nodes-base.notion` — supports `page.search`/`page.getMarkdown` operations, which map directly to Michelle's keyword-search ask; `n8n-nodes-base.notionTrigger` exists for the alteration-notification ask) — but this only proves the node type is installed, not that the credential authenticates against Michelle's real workspace.
- **What can be safely confirmed without writing anything**: credential object exists and is unused; no workflow currently touches Notion; the Notion action node and Notion trigger node both exist in this instance's catalog, so both of Michelle's requested capabilities are structurally buildable here in principle. Nothing about real page/database content, real workspace identity, or live authentication can be confirmed through n8n MCP without running a node against the live API.
- **"Credential exists" vs. "real Notion API read proven" — explicitly distinguished**: existence is proven (this increment, live `list_credentials` call). A real read is **not proven** for the n8n-level credential — the only real, evidence-backed live Notion read on record anywhere is the **app-level** `NOTION_API_KEY` check from 2026-08-15, and that was **local dev only**, a separate credential, and has not been re-run this session.
- **Smallest safe next step to prove a live n8n-side Notion read, if wanted**: use the n8n web UI's built-in credential "Test" button on the `Notion account` credential. This is a native n8n feature that pings the real Notion API to confirm the token authenticates — it does **not** require creating, editing, activating, or executing any workflow, and makes no write call to Notion. This has to be done by the user directly in the n8n UI; no MCP tool here can trigger it. (Separately, re-running the app-level `NOTION_API_KEY` check against Production — already queued from Increment 39 — would prove the _other_ credential live, but doesn't speak to the n8n-side one.)

No Notion content was read, searched, or modified. No workflow was created, edited, activated, published, deleted, or executed. No credential was changed. Stopped for approval per explicit instruction before any further Notion or OwnerRez action.

### Notion production-verification audit — completed, full report (still this increment, read-only, zero writes)

Cross-checked the n8n-side findings above against the app-level code directly (`packages/integrations/src/notion/client.ts`, its `README.md`, `integrations.service.ts`, `dashboard.service.ts`) to produce one consolidated report, explicitly separating the categories Michelle/the user asked not to conflate:

1. **Credential exists**: Yes, two separate credentials, both confirmed to exist, neither the same object. n8n-level `Notion account` (`notionApi`, id `4VXm2JUDYsHUKKP6`) — confirmed live this session via `list_credentials`. App-level `NOTION_API_KEY` (`.env.example:39`) — confirmed by name in code, not re-read this session.
2. **Credential appears valid**: n8n-level — unknowable from the MCP surface; `list_credentials` returns no validity/status field at all, only name/type/id/project/scopes, so "appears valid" cannot be assessed for this credential beyond "well-formed object of the right type in the right project." App-level — the closest real signal on record: `NotionClient.validateCredentials()` (a genuine `GET /users/me` call) succeeded on 2026-08-15, but that was **local dev only**; Production presence/validity of `NOTION_API_KEY` is unconfirmed.
3. **Real Notion API read proven or not proven**: **Not proven** for the n8n-level credential — no tool in the 19-tool read-only MCP surface can make a live external call (confirmed: `validate_node_config`/`validate_workflow` are schema-only; no `test_credential`/`execute_workflow` tool exists). **Proven, but only for the separate app-level credential, and only in local dev**: `validateCredentials()` + `listRecentlyEdited()` both succeeded against the real StayWhile workspace on 2026-08-15 (100+ pages/databases seen, 4 real database schemas retrieved).
4. **What workspace/content access is actually available**: Whatever the app-level `NOTION_API_KEY` integration token can see via Notion's `/search` endpoint — proven as "100+ pages/databases" in dev on 2026-08-15, not re-quantified since. The n8n-level credential's access scope is completely unverified — its live validity has never been tested at all (not even in dev), so nothing can be said about what it can see.
5. **Does any existing n8n workflow use Notion?** **No.** The instance's only workflow (`My workflow`, id `p9AsCYI5THw1oVLX`) has exactly 2 nodes — `Manual Trigger` → `HTTP Request` — confirmed via `get_workflow_details`'s full node list. Zero Notion nodes anywhere in this n8n instance.
6. **What is already built in the StayWhile app**:
   - `NotionClient` (`packages/integrations/src/notion/client.ts`) is genuinely read-only **by construction**, not just by convention — every method (`connect`/`healthCheck`/`validateCredentials`/`listRecentlyEdited`) issues only `GET`-style reads against `/users/me` or `/search`; `sync()` accepts only `INBOUND` and throws on `OUTBOUND`; there is no `PATCH`/create/archive/append call anywhere in the file. This matches Michelle's "never modify Notion" rule at the code level, not just as an unenforced intention.
   - Wired into exactly one place: `getNotionHighlights()` (`integrations.service.ts:317-336`), gated by the generic `integrations:read` permission (no Notion-specific RBAC resource exists), which powers one dashboard tile (`DashboardSummary.tsx`) showing the 5 most recently edited pages/titles/URLs. `configured: false` (env var unset) is handled as a normal state, not an error.
   - The README (`packages/integrations/src/notion/README.md`) already encodes a hard client-directed safety rule (2026-08-15): Notion is read-only source of truth, no write/patch/archive/rename path may ever be added, any Kenny/Jenny-vs-StayWhile data conflict must be reported to a human, never auto-resolved — and any property-mapping must be explicit/human-confirmed, never inferred from name/address similarity.
7. **What is still missing for Michelle's keyword search**: No query-string search exists anywhere in the app — `listRecentlyEdited()` calls `/search` with only `page_size`/`sort`, never a `query` param, and no dashboard UI, route, or service method accepts a search term today. Notion's real `/search` endpoint does accept a `query` param (confirmed in the client's own request shape), so this is additive — a new service method plus a small UI — not a redesign, and stays read-only by construction if built the same way as `listRecentlyEdited()`.
8. **What is still missing for change/deletion notifications**: No polling job, no diff/last-seen-state storage, and no webhook receiver exist for Notion anywhere in the codebase today (the generic `Notification` model exists but has zero Notion usage). Whether Notion's real API even supports outbound webhooks for page changes/deletions has **never been confirmed against Notion's actual documentation** — this is a standing open question carried over from Increment 39, still unresolved. The only mechanism provably buildable today with zero new unknowns is polling `listRecentlyEdited()` (or a new query-capable variant) on a schedule and diffing against a stored last-seen timestamp/state per page.

**Smallest safe next step to prove the n8n-side credential is actually live, without writing anything**: use the n8n web UI's built-in credential **"Test"** button on `Notion account`. It performs a real read-only ping against Notion's API to confirm the token authenticates, requires no workflow to be created, edited, activated, or executed, and makes no write call. No MCP tool available here can trigger this — it has to be done by the user directly in the n8n UI. (A secondary, independent option: re-run the already-queued, already-approved-in-design check of `NOTION_API_KEY` presence/validity in Vercel Production — proves the _other_, app-level credential, not this one.)

Nothing in Michelle's real Notion workspace was read, searched, or modified this increment. No workflow created/edited/activated/executed/deleted. No credential changed. `.claude/worktrees/ownerrez-property-sync` was noted to exist (via a repo-wide grep) but not entered, read further, or modified. Stopped here for approval, per explicit instruction, before any Notion build work, the n8n UI credential test, or the OwnerRez/Nest/August/Cielo queue.

### Notion audit — consolidated final findings (this increment, read-only, zero writes)

**Path A — n8n → Notion:**

- Credential exists (`Notion account`, `notionApi`, id `4VXm2JUDYsHUKKP6`) — confirmed live via MCP `list_credentials`.
- Credential appears valid — **cannot be assessed**; `list_credentials` returns no validity/status field at all.
- Real Notion API read proven — **not proven**. No tool in the 19-tool read-only MCP surface (`explore_node_resources` … `validate_workflow`) can make a live external call; `validate_node_config`/`validate_workflow` are schema-only. Verdict, stated exactly: **"The credential exists, but no live Notion API read has been proven this session."**
- Existing workflow usage — **zero**. The instance's only workflow (`My workflow`) has exactly 2 nodes (`Manual Trigger` → `HTTP Request`), confirmed via `get_workflow_details`'s full node list; no Notion node anywhere.
- Workspace/content access provable through this path — **none**. Nothing about this credential's actual reach into Michelle's workspace can be established without a live call, which the MCP surface cannot make.

**Path B — StayWhile app → Notion:**

- `NOTION_API_KEY` consumed in exactly one place: `getNotionHighlights()` (`apps/website/src/domains/integrations/services/integrations.service.ts:317-336`), reading `process.env.NOTION_API_KEY` directly.
- Production configuration status — **only expected/documented in `.env.example:39`, never confirmed present in Production this session or in any prior recorded session**. The top-level `SECURE_CONFIGURATION_CHECKLIST.md` still shows Notion unchecked (though that checklist is stale generally — e.g. OwnerRez is also shown unchecked there despite being separately confirmed live in Production — so its checkbox state alone isn't strong evidence either way). Cannot be checked directly this session: this environment is under a standing restriction against authenticating the Vercel CLI (documented earlier in this file), so Production env-var presence can only be confirmed via the user's own Vercel dashboard or a self-deleting diagnostic script — not attempted this increment.
- Working Notion client — **yes**, `NotionClient` (`packages/integrations/src/notion/client.ts`), genuine HTTP calls to `api.notion.com/v1`, read-only **by construction** (no `PATCH`/create/archive/append call exists anywhere in the file; `sync()` throws on `OUTBOUND`).
- Read operations supported today: `connect`/`healthCheck`/`validateCredentials` (all `GET /users/me`), `sync("INBOUND")` (count-only `POST /search`), `listRecentlyEdited(limit)` (`POST /search` sorted by `last_edited_time`, returns id/type/title/url/last-edited-time for the top N).
- Dashboard keyword search — **unbuilt**. No method anywhere passes a `query` param to `/search`; no route/UI accepts a search term.
- Change/deletion detection — **completely pending**, not partially implemented. No polling job, no last-seen-state storage, no webhook receiver exist anywhere in the codebase for Notion. Whether Notion's real API even supports outbound webhooks for page changes/deletions has never been confirmed against Notion's actual docs — still open.
- Exposed in the Production dashboard today — **yes, narrowly**: one tile (`DashboardSummary.tsx`) showing the 5 most-recently-edited Notion items, gated by the generic `integrations:read` permission, powered by `getNotionHighlights()`. That's the entire current surface — no search, no notifications.

No credential value was read, printed, or exposed at any point in this audit.

### Michelle's requested Notion functionality — recommended architecture (design/analysis only, nothing built)

**1. Dashboard keyword/property/region search → recommend direct StayWhile app → Notion.**
Rationale: this is a synchronous, user-initiated read at request time — the same shape the app's `NotionClient` already handles (`listRecentlyEdited` already does a live `/search` call on dashboard render). Extending `/search` with a real `query` param is additive to the existing read-only client, stays inside the app's existing RBAC model, and needs no second credential. Notion's `/search` API is generic full-text only — it has no native "region" concept — so property-name and keyword matching map directly onto `query`, but **region filtering (SRQ/Largo/St. Augustine/Panhandle/Destin/SPI) would have to be done by matching Notion results against StayWhile's own property list/region field, not by inventing a Notion-side filter**, since Notion has no equivalent structure today (unconfirmed either way until a real read happens — see next section). Routing this through n8n instead would add a second credential to keep in sync, a second network hop, and no benefit for a synchronous user query.

**2. Change/deletion notifications → recommend a split architecture.**
The polling/diff/notify loop (schedule trigger → diff against last-seen state → dispatch to Slack/email/team) is a better structural fit for n8n — that's what its trigger/schedule/notification-node primitives are for, and building an equivalent scheduler + notification dispatcher from scratch inside the StayWhile app would duplicate what n8n already does. But: **the definition of "relevant" (which pages/properties matter) should stay driven by the same source the app already trusts**, not be redefined independently inside n8n — otherwise the two systems' notion of "relevant Notion content" can silently drift apart. Concretely: StayWhile-side owns the property/region reference data and decides scope; n8n-side owns the scheduling, diffing, and notification dispatch once scope is handed to it. This is a recommendation only — not designed in detail, not built, and blocked on first proving the n8n-side Notion credential is actually live (Path A above) and on confirming whether Notion's API supports webhooks at all (still unconfirmed).

### Meeting reference — Michelle's 38-property regional structure (reference only — NOT yet proven to match Notion's real structure)

Recorded verbatim as given; **do not assume Notion is organized this way until a real Notion read confirms it** — this is StayWhile/meeting-side reference data only, not a Notion read result.

| Region                   | Count | Properties                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRQ                      | 24    | Aqua Palm, Bonjour AMI, Camingo, Casa del Mar, Champion Retreat, Coco Vista, Driftwood Cottage, Florisun, Lakeshore, Lucky Charm, Mahalo, Maison de la Mer, Majestic Isla, Moonlit Cove, Moroccan Moon, Once Upon a Pond, Palm Haven, Paradise Awaits, Picasa, Riverside Château, Robinson Recluse, Royal Eden, Royal Palms, The Bahamas |
| Largo                    | 1     | Ocean Pearl                                                                                                                                                                                                                                                                                                                              |
| St. Augustine            | 1     | Magnolia                                                                                                                                                                                                                                                                                                                                 |
| Panhandle                | 4     | Aloha by the Sea, Island SOS, Islafront                                                                                                                                                                                                                                                                                                  |
| Destin                   | 4     | Bird of Paradise, Casa Blanca, Miramar Bliss, Surfside Solace                                                                                                                                                                                                                                                                            |
| SPI (South Padre Island) | 4     | Las Sirenas, Orion's Landing, Roseate Madre, Sandy Nudes                                                                                                                                                                                                                                                                                 |

Total meeting reference inventory: **38 properties**. (Note: Panhandle lists 4 as the count header but 3 named properties, and Largo/St. Augustine each list 1 name for a count of 1 — transcribed exactly as given without correcting or inferring a missing name.)

**OwnerRez reference aliases (reference-only, no action taken)**: `BOP` → Bird of Paradise; `Miramar Bliss 2` → Miramar Bliss.

**Hard rule carried forward**: these aliases, and this entire regional list, are reference information only. They must **not** trigger automatic matching, linking, renaming, or any data change — same standard already established in the Notion README's "Mapping rule" and applied to `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP`: every property correspondence requires explicit, human-confirmed matching, never inference from name/alias similarity, no matter how obvious it looks.

### Notion — status summary (complete vs. pending vs. next step)

**Complete**: app-level read-only Notion client (connect/healthCheck/validateCredentials/sync-count/listRecentlyEdited); one dashboard tile exposing it in Production; n8n-side credential existence re-confirmed this session; n8n-side zero-workflow-usage confirmed; full read-only n8n MCP capability ceiling established (no live-call/test-credential tool exists); architecture recommendation drafted for both of Michelle's requested features (design only).

**Pending**: n8n-side Notion credential's live validity (never proven, needs n8n UI "Test" button); `NOTION_API_KEY` Production presence (never proven, needs Vercel dashboard check or an approved self-deleting diagnostic — Vercel CLI auth remains off-limits in this environment); Notion API webhook-support research (never done); dashboard keyword/property/region search (unbuilt); change/deletion polling+notify pipeline (unbuilt); real Notion read confirming/refuting Michelle's 38-property regional structure.

**Recommended next step**: the user tests the n8n-side `Notion account` credential via the n8n UI's built-in "Test" button (no workflow needed, no write to Notion) — this is the one remaining question a live call can answer that nothing in this session's tooling can. Everything else above is design/build work awaiting explicit approval.

### Notion Production connection verification — attempted, blocked (still this increment, zero writes, zero credential exposure)

Attempted the smallest possible read-only proof that `NOTION_API_KEY` is configured in Production, authenticates, and can read — preferring an existing safe read path (`healthCheck()`/`GET /users/me`, or the existing dashboard tile's `listRecentlyEdited()` call) over building anything new, per explicit instruction. **Could not complete this session.** Three paths considered, all currently unavailable or out of scope:

1. **No existing Notion-specific diagnostic script** — unlike OwnerRez (`ownerrez-property-inventory.ts`), nothing in `packages/integrations/scripts/` targets Notion yet. Writing one is a build step, explicitly deferred.
2. **Claude-in-Chrome browser extension not connected this session** — checked via `tabs_context_mcp`, returned "Browser extension is not connected." This would have been the zero-build option: the Production dashboard's existing "Notion" tile already calls the real `NOTION_API_KEY` through `getNotionHighlights()` → `listRecentlyEdited()`, so viewing it read-only would have proven configured/authenticated/read-access/item-count in one step, exactly the safe metadata shape requested, with no new code and no secret exposure.
3. **Vercel CLI authentication remains off-limits in this environment** — per the standing rule already recorded earlier in this file; not attempted.

**Verdict: Production connection status is genuinely unverified, not "assumed missing" or "assumed working."** No credential value was read, printed, or exposed. Nothing was built.

**Three concrete options handed to the user, in order of conclusiveness:**

- **(A)** User logs into the Production dashboard as `admin@stayawhilewithus.com` and reads the existing "Notion" dashboard tile directly — proves configured + authenticated + read-access + item count in one look, or reports the exact "not configured"/error state shown.
- **(B)** User reconnects the Claude-in-Chrome browser extension so the same tile can be viewed read-only from inside this session.
- **(C)** User approves building a minimal, self-deleting, name/status-only diagnostic (same pattern as `ownerrez-property-inventory.ts`) calling only `healthCheck()` against the real Production key, reporting only `configured`/`authenticated`/`checkedAt` — never the token. Not started; a build step awaiting explicit approval.

Nothing further attempted this session pending the user's choice among (A)/(B)/(C).

### Notion Production connection — DEFINITIVE RESULT (via user's own Production dashboard, option A above)

The user logged into the real StayWhile Production dashboard as `admin@stayawhilewithus.com` and read the existing "Notion" tile directly — the zero-build path this file predicted would be conclusive. It reads:

> **NOTION — Not connected — set `NOTION_API_KEY` to enable.**

This is the `configured: false` branch of `getNotionHighlights()` (`integrations.service.ts:317-336`) — the code only ever shows this exact message when `process.env.NOTION_API_KEY` is unset. **Definitive, closed finding: StayWhile Production does NOT currently have the app-level `NOTION_API_KEY` configured.** This is exactly why the direct app → Notion integration is inactive in Production today — not a code bug, not an auth failure, simply an unset env var. This also answers, definitively, the item this file has carried as unconfirmed since 2026-08-15: Production presence of `NOTION_API_KEY` is now known, not merely unconfirmed — it is **absent**.

Same screenshot also showed the OwnerRez dashboard tile:

> **OWNERREZ — Couldn't reach OwnerRez: Request to `/bookings` failed with 400**

**Recorded as a separate, real, currently-unexplained Production issue — not investigated, not touched this session**, per explicit instruction. This differs from and is newer than every prior OwnerRez Production finding in this file (Increment 22's live-credential verification, Increment 39's property/booking-read confirmation) — something now causes a 400 on `/bookings` in Production that wasn't previously reported. Flagged for a future session; do not start on it without explicit direction.

### OwnerRez — untouched this increment, but the `ownerrez-property-sync` worktree is NOT "zero code written"

**Correction**: several places above in this file (Increment 39, and the priority banner near the top) describe the OwnerRez property-sync service and admin-review UI as "design exists, zero code written." That was accurate at the time each was written, but is now superseded: Increments 40 and 41 (this same file, below/above per reading order) document that this work was actually built and is committed — `a415919` then `46c4d6e` ("Split OwnerRez sync into preview/apply/create, rewrite test suite") — inside the **isolated** `worktree-ownerrez-property-sync` git worktree at `.claude/worktrees/ownerrez-property-sync`. Confirmed this session via a read-only `git log`/`git status` in that worktree: HEAD is `46c4d6e`, clean working tree, nothing uncommitted. **`main`'s own HEAD remains `da8ac61`** (confirmed via `git worktree list`) — this work has **not** been merged into `main`, not deployed, not pushed beyond the worktree's own tracking branch. No OwnerRez work was done, and the worktree was not entered, modified, merged, or pushed this increment or this session — only its git log/status were read to confirm the above.

### App-level Notion connection procedure — requested, not yet actioned (design/instructions only, nothing built or changed)

The user asked for the safest exact procedure to connect the app-level Notion integration in Production (obtain the correct integration token; verify it's scoped only to intended StayWhile content; where to add `NOTION_API_KEY` in Vercel; whether a redeploy is required; how to do the first read-only verification afterward). Given as guidance in conversation only — Michelle's absolute rule (no Notion content ever created/edited/moved/renamed/deleted/archived/restructured/tagged, no test content) applies throughout. Nothing was implemented, no token was requested in chat, no secret was read or exposed. Full procedure is in this session's conversation record; add it here if/when the user actually starts the connection work.

---

# Notes

- Package manager: pnpm 9.15.0 (installed via `npm install -g pnpm` this session, wasn't preinstalled). Node: v26.5.0 present; `.nvmrc` pins `20.11.0` as the project's nominal target.
- Local Postgres (Homebrew `postgresql@16`) runs as a background service with trust auth on localhost — fine for local dev only, never replicate this auth config anywhere else.
- `packages/database/.env` and `apps/website/.env.local` contain real local Postgres connection strings and placeholder (non-functional) Clerk/n8n secrets — both gitignored, never commit them.
- The plan file with full remaining-refinement content (exact ADR text scope, exact `@stayw/ai` API shapes, exact file lists) is at `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` — read it before redoing design work that's already been thought through.

---

## Increment 42 — 2026-08-24: Authoritative current state — OwnerRez + Notion + n8n

**This section is the authoritative current-state summary for OwnerRez, Notion, and n8n as of 2026-08-24.** It supersedes any conflicting statement in an earlier increment or banner above (several were written before this work existed, or before this session's fresh verification — most notably the "zero code written" phrasing that appears in Increment 39 and the priority banner near the top of this file, both now stale). History above is left intact; nothing was deleted or rewritten wholesale. Where an older statement conflicts with what's below, **this section governs.**

_(Context: this increment consolidates ground truth after this session found its own prior HANDOFF edits appeared to have drifted — root-caused to a stray `cd` into the `ownerrez-property-sync` worktree persisting across Bash calls, which made several read-only shell checks target the worktree's own copy of this file instead of this one. No content was actually lost; this section is a clean, single consolidation pass, not a recovery from real data loss.)_

### OwnerRez — current truth

- A real OwnerRez property-sync implementation **exists** — it is not a design-only proposal.
- It lives entirely in the **isolated** git worktree `worktree-ownerrez-property-sync`, checked out at `.claude/worktrees/ownerrez-property-sync`.
- Two commits: **`a415919`** ("Add OwnerRez property-sync groundwork — match report, confirm, field sync") and **`46c4d6e`** ("Split OwnerRez sync into preview/apply/create, rewrite test suite").
- Implements the **preview → apply → create** flow: `previewOwnerRezPropertyChanges` (read-only diff), `applyOwnerRezPropertyChanges` (writes exactly one property's changed OwnerRez-owned fields at a time), `createPropertyFromOwnerRez` (creates + links a new `Property` from an unmatched OwnerRez listing, atomically, admin-reviewed).
- **28/28** focused OwnerRez tests passing.
- Full website suite: **308/308** passing, zero regressions.
- `pnpm --filter website exec next build` **succeeds** in that worktree.
- An additive migration (`add_ownerrez_property_sync_fields` — two new nullable columns, `owner_rez_active`/`owner_rez_last_seen_at`) exists and **has only been applied to local dev** — never to Production.
- **Not merged to `main`** — confirmed this session via `git worktree list`: `main`'s own HEAD is still `da8ac61`, the worktree's branch is a separate ref entirely.
- **Not pushed beyond the worktree's own tracking branch, not deployed.**
- **No Production OwnerRez writes have been made** as part of this work — everything above was verified against the local dev DB only.
- Separately, the current Production dashboard shows **`OWNERREZ — Couldn't reach OwnerRez: Request to /bookings failed with 400`** — a real, currently-unexplained issue, observed directly by the user via the live dashboard this session. **This is a separate, pending OwnerRez issue — it is not evidence that the property-sync work above is broken** (that work has never touched Production; this 400 is on the existing, already-live `/bookings` read path). Not investigated, not touched this session, per explicit instruction.

### Notion — current truth

- n8n contains a **`Notion account`** credential (`notionApi` type, id `4VXm2JUDYsHUKKP6`, home project = Kenny Pham's personal StayWhile project).
- **Credential existence is proven. Credential validity is not proven** — `list_credentials` returns no validity/status field of any kind.
- **No live Notion API read has been proven through n8n this session** — the 19-tool read-only n8n MCP surface has no `test_credential`/`execute_workflow`/equivalent tool; `validate_node_config`/`validate_workflow` are schema-only, no live external call.
- **No existing n8n workflow uses Notion** — confirmed via `get_workflow_details`: the instance's only workflow (`My workflow`, 2 nodes: `Manual Trigger` → `HTTP Request`) has zero Notion nodes.
- The StayWhile app has a real, read-only-by-construction `NotionClient` (`packages/integrations/src/notion/client.ts`) — genuine HTTP calls to `api.notion.com/v1`, no `PATCH`/create/archive/append anywhere in the file.
- The app-level dashboard path requires `NOTION_API_KEY` (`.env.example`) — a separate credential from the n8n-level one above.
- **The user checked the actual Production dashboard directly and it shows: "Not connected — set `NOTION_API_KEY` to enable."**
- **Therefore: Production app-level Notion is definitively NOT configured right now.** Not "unconfirmed" — known and absent.
- Dashboard keyword/property/region search — **unbuilt**. No `query` param is ever passed to Notion's `/search` anywhere in the code.
- Change/deletion detection — **unbuilt**. No polling job, no last-seen-state storage, no webhook receiver exist anywhere for Notion.
- **No Notion content has been modified** at any point, by any path, this session or any prior one.

### Michelle's Notion requirements (recorded, unbuilt)

- Dashboard keyword/property/region search of authorized Notion content.
- Notifications when relevant Notion content is changed or deleted.
- **Strict read-only toward Notion content — absolute, no exceptions**: no create, edit, rename, move, delete, archive, restructure, tag, categorize, or test content, ever.

### 38-property regional reference (Michelle's meeting reference — NOT yet proven to match Notion's real structure)

Recorded verbatim; do not assume Notion is organized this way until a real Notion read confirms it.

| Region                   | Count | Properties                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRQ                      | 24    | Aqua Palm, Bonjour AMI, Camingo, Casa del Mar, Champion Retreat, Coco Vista, Driftwood Cottage, Florisun, Lakeshore, Lucky Charm, Mahalo, Maison de la Mer, Majestic Isla, Moonlit Cove, Moroccan Moon, Once Upon a Pond, Palm Haven, Paradise Awaits, Picasa, Riverside Château, Robinson Recluse, Royal Eden, Royal Palms, The Bahamas |
| Largo                    | 1     | Ocean Pearl                                                                                                                                                                                                                                                                                                                              |
| St. Augustine            | 1     | Magnolia                                                                                                                                                                                                                                                                                                                                 |
| Panhandle                | 4     | Aloha by the Sea, Island SOS, Islafront                                                                                                                                                                                                                                                                                                  |
| Destin                   | 4     | Bird of Paradise, Casa Blanca, Miramar Bliss, Surfside Solace                                                                                                                                                                                                                                                                            |
| SPI (South Padre Island) | 4     | Las Sirenas, Orion's Landing, Roseate Madre, Sandy Nudes                                                                                                                                                                                                                                                                                 |

Total meeting reference inventory: **38 properties**.

**Reference-only aliases**: `BOP` → Bird of Paradise; `Miramar Bliss 2` → Miramar Bliss.

**These aliases, and this entire regional list, are for human review/search context only. They must never trigger automatic matching, renaming, or relinking of any data** — same standard already established for `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP` and the Notion README's own mapping rule: every correspondence requires explicit, human-confirmed matching, never inference from name/alias similarity.

### n8n — current truth

- The official native n8n MCP is connected, StayWhile-only, local scope, at the correct URL: `https://adminstay.app.n8n.cloud/mcp-server/http`.
- A fresh Claude Code session now loads **19 read-only n8n tools** (`explore_node_resources`, `get_node_types`, `get_workflow_best_practices`, `get_workflow_details`, `get_workflow_execution`, `get_workflow_history`, `get_workflow_sdk_reference`, `get_workflow_version`, `list_credentials`, `list_n8n_connect_services`, `list_workflow_tags`, `search_data_tables`, `search_folders`, `search_nodes`, `search_projects`, `search_workflow_executions`, `search_workflows`, `validate_node_config`, `validate_workflow`) — none create/update/delete/execute anything.
- **One StayWhile project visible**: `Kenny Pham <admin@stayawhilewithus.com>` (personal) — no other projects, no cross-client data of any kind.
- **One inactive default workflow**: `"My workflow"` (id `p9AsCYI5THw1oVLX`), 0 triggers, 2 nodes.
- **Credentials visible**: `Notion account`, `Anthropic account`, `Header Auth account` — same three as the 2026-08-06 baseline in `N8N_DISCOVERY.md`, nothing added or removed.
- **No cross-client data visible anywhere in this n8n instance.**
- **No n8n writes performed** — every call made this session was read/search/get/list, never create/update/delete/execute.

### Next priority, in order

1. Configure/verify app-level `NOTION_API_KEY` in Production.
2. Prove a real read-only Notion API call against it.
3. Build Michelle's read-only Notion search (keyword/property/region).
4. Design/verify change/deletion monitoring for Notion.
5. Return to OwnerRez rollout/reconciliation (review + approve the worktree's changes; apply the additive migration to Production; deploy; run the real match report against Production for the first time) — separately, first investigate the newly observed `/bookings` 400.
6. Then Nest → August → Cielo, per the standing device-work order.

### Documentation rule going forward

This Increment 42 is the authoritative current-state section for OwnerRez/Notion/n8n. Future sessions should not keep patching conflicting older increments one-by-one — leave history intact, and if an older statement conflicts, mark it superseded by Increment 42 (or append a new authoritative increment when the state changes again) rather than rewriting the historical record.

Nothing was merged, pushed, or deployed this increment. The `ownerrez-property-sync` worktree was not entered, modified, merged, or pushed. No Notion content was touched. No n8n workflow was created, edited, activated, or executed.

---

## Increment 43 — 2026-08-25: `NOTION_API_KEY` confirmed live in Production; specific data source ("View of Listings") identified — supersedes Increment 42's Notion-configuration finding

**Supersedes Increment 42's line "Production app-level Notion is definitively NOT configured right now."** That finding is now stale — see below. Increment 42 remains otherwise accurate and unmodified; this section governs where the two conflict.

### Verified this increment (code inspection only — no live Notion API call made by this session)

- User added `NOTION_API_KEY` to Vercel Production and redeployed. The Production dashboard's Notion tile changed from **"Not connected — set NOTION_API_KEY to enable"** to **"No pages/databases found."**
- Per `DashboardSummary.tsx:591-603`, that exact wording only renders on the `configured === true && ok === true && items.length === 0` branch — i.e. `getNotionHighlights()` → `NotionClient.listRecentlyEdited()` → `POST /search` **completed without error** and returned zero results. **This proves the token authenticates successfully.** It is not an auth failure.
- **Root cause of the empty result, by design of Notion's own permission model**: an internal integration token has zero content access by default — a page or database becomes visible to it only once a human explicitly shares it with that integration via Notion's own UI ("•••" → "Connections" → "Add connections"). `/users/me` (what `validateCredentials()`/`healthCheck()` call) succeeds regardless, since it's a workspace/bot-identity check, not content-scoped — explaining exactly why auth can look fine while `/search` still returns nothing. **Nothing has been shared with this integration yet** — this is the missing step, not a code bug.
- User identified Michelle's property database as a Notion **data source** named **"View of Listings"** and copied its **data source ID** locally (Notion → Manage data sources → View of Listings → ••• → Copy data source ID). **The ID's value was not shared with or requested by this session, is not in chat, and is not in the repo.**
- **Client version note, confirmed by direct code read**: `packages/integrations/src/notion/client.ts:44` pins `Notion-Version: "2022-06-28"` — predates Notion's multi-source-database feature. Under that version, content is addressed by `database_id` via `POST /v1/databases/{id}/query`; "data source" as a distinct queryable object is a newer API concept. **Open technical unknown, not yet resolved**: whether this copied data source ID is directly usable under the current pinned version (interchangeable with the classic database ID, common for a database that's never been split into multiple sources) or whether the `Notion-Version` header needs bumping first to query it via a newer, data-source-specific endpoint. Resolving this needs one real, approved, read-only test call — not more code reading.

### Two conditions that must both hold before any query against this data source can succeed

1. **"View of Listings" (or its parent database/page) must be explicitly shared with the integration** in Notion's UI — a separate, required manual step from copying the ID; not yet confirmed done.
2. **The API version question above must be resolved** — confirms which endpoint shape (`/v1/databases/{id}/query` vs. a newer data-source-specific endpoint) actually accepts this ID.

### Recommended storage (not yet added)

A new Vercel Production environment variable — proposed name `NOTION_LISTINGS_DATA_SOURCE_ID` — added the same way `NOTION_API_KEY` was (Vercel dashboard → Settings → Environment Variables). Never hard-coded in source, never committed. This is a single fixed config pointer (which data source holds property listings), not a per-device mapping table, so it does not collide with the standing `*_PROPERTY_MAP` prohibition elsewhere in this file.

### Smallest safe next step (proposed, NOT implemented — awaiting approval)

One new, additive, read-only `NotionClient` method — e.g. `queryDataSource(dataSourceId, { page_size: 1 })` — reporting only `{ ok: boolean, resultCount, firstItemTitle? }`, never a full content dump, same shape as the existing `healthCheck()` pattern. Does not touch or replace the existing `/search`-based `listRecentlyEdited()` used by the current dashboard tile.

### How this fits Michelle's planned keyword/property/region search

Once read access to this specific data source is proven, the real search feature should query it directly (Notion's own `filter`/query object against that data source), not the generic `/search` used today — narrower in scope (property listings only, nothing else in the workspace) and a better match for "keyword/property/region." If "View of Listings" turns out to have its own structured "Region" property column, region filtering could become a real Notion-side `filter` rather than string-matching against StayWhile's own 38-property reference list (Increment 42) — a materially better design if the schema supports it. Not yet confirmed either way.

Nothing implemented this increment. No Notion content read or modified. OwnerRez and n8n untouched.

---

## Increment 44 — 2026-08-25 (same day, continued): Notion API version/sharing question resolved via Notion's live official docs — resolves Increment 43's open technical unknown

**Resolves the open item from Increment 43** ("whether this copied data source ID is directly usable under the current pinned version... or whether the Notion-Version header needs bumping"). Answered this increment by fetching Notion's current official docs directly (`developers.notion.com`, `notion.com/help`) — not from training memory, since Notion's API has moved since this assistant's knowledge cutoff. Still zero live calls made against StayWhile's actual Notion workspace; nothing implemented.

### Verified facts (with sources)

- **Sharing is managed at the database level, not per data source.** Individual data sources have no independent connection/permission setting — access is granted by sharing the parent **database** (••• → Add connections), which then covers every data source under it. [Notion Docs — Working with databases](https://developers.notion.com/guides/data-apis/working-with-databases)
- **Whether sharing a parent page/teamspace cascades down to a nested database was checked directly and is NOT explicitly confirmed in Notion's docs either way.** Do not assume it cascades — the docs-backed action is to share the specific database directly. [Notion Help — Add & manage connections](https://www.notion.com/help/add-and-manage-connections-with-the-api)
- **`2022-06-28` (this codebase's current pinned version) still works for a database with a single data source** — Notion's own migration guide: _"Connections using the 2022-06-28 API version (or older) will continue to work with existing databases in Notion that have a single data source."_ It only fails — with an explicit `400` validation error, not silently — if the database has multiple data sources. [Notion Docs — Start building with the Notion API (upgrade FAQs)](https://developers.notion.com/docs/upgrade-faqs-2025-09-03)
- **Confirmed current required version for direct data-source access**: `GET /v1/data_sources/{data_source_id}` requires `Notion-Version: 2026-03-11` (fetched live from Notion's current reference page — newer than the 2025-09-03 version that introduced data sources). [Notion Docs — Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source)
- **Bumping the version is confirmed NOT globally backwards-compatible** — under the new version, `/search`'s filter values change (`"page"|"database"` → `"page"|"data_source"`) and its response shape changes to data-source objects. [Notion Docs — Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- **This codebase's shared `HttpClient` (`packages/integrations/src/core/http-client.ts:33`) already supports a per-call header override** — `headers: { ...this.opts.headers, ...init.headers }` merges a caller-supplied header on top of the client's constructor default. Confirmed by direct code read. This means a new method can send `Notion-Version: 2026-03-11` for just its own call, leaving the client's global default (`2022-06-28`) and every existing method (`/users/me`, `/search`-based `sync()`/`listRecentlyEdited()`) completely untouched. **No version migration needed — purely additive.**
- **Unshared-object error semantics, confirmed via Notion's own error reference**: an object not shared with the integration returns **`404 object_not_found`** (deliberately indistinguishable from "doesn't exist," by Notion's own design, to avoid leaking existence) — not a `403`. [Notion Docs — Errors](https://developers.notion.com/reference/errors)

### Smallest safe proof — designed, NOT implemented, awaiting approval

One new `NotionClient` method: single `GET /v1/data_sources/{id}` call, `Notion-Version: 2026-03-11` passed as a per-call header override only, reading `NOTION_LISTINGS_DATA_SOURCE_ID` from env (never hard-coded). Reports only `{ ok, status, title? }` — the data source's own name field, never its rows/pages/property content. No create/update/delete/archive anywhere in this design.

### Diagnostic power of this one call

- `200` → database is shared with the integration and readable. Proof succeeds in one call, regardless of single- vs multi-source, since this targets the modern, universally-correct endpoint directly.
- `404 object_not_found` → not yet shared with the integration (the sharing step from Increment 43 hasn't been done, or the ID is wrong — can't fully distinguish those two, but the ID came directly from Notion's own "Copy data source ID" action, so 404 here should be read as "go share the database").
- Recommendation given to the user: **do the one-click sharing step in Notion's UI first** (zero-risk, no code, reversible), then run this proof — cleanest path to an unambiguous result, even though the proof call is technically capable of surfacing "not shared" on its own via the 404.

Nothing implemented this increment. No live call made against StayWhile's real Notion workspace. No Notion content read or modified. OwnerRez and n8n untouched.

---

## Increment 45 — 2026-08-25 (same day, continued): identified exactly where "View of Listings"'s parent database lives and how to share it; refined the read-only proof to a query call

**Builds directly on Increment 44.** Still code/documentation reasoning only — no live call made against StayWhile's real Notion workspace, nothing implemented.

### Where "View of Listings" sits, confirmed via Notion's own current help docs

- **"Manage data sources" is opened via the slider icon at the top of a database** — it is a menu on the database's own page, not a separate hidden object. [Notion Help — Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases)
- That panel splits into two sections: **"Sources"** (data sources native to the current page) and **"Linked"** (data sources originating from a _different_ database, shown here only as a linked view).
- **The exact disambiguating check handed to the user**: whether "View of Listings" appeared under "Sources" (→ the page the user was already on **is** the parent database — no separate object to find) or "Linked" (→ the real parent database is elsewhere, and that one needs sharing instead). Not yet confirmed which case applies — the user needs to check this once, in Notion's UI, before sharing.
- **Where to share, in the (more likely) "Sources" case**: the same page's top-right **"•••" menu** → scroll to a "Connections" section → "Add connections" → select the StayWhile Dashboard integration by name. [Notion Help — Add & manage connections](https://www.notion.com/help/add-and-manage-connections-with-the-api) If not visible there, check the adjacent **"Share"** button instead — Notion has moved this control between the two across UI versions; this session cannot confirm which one is current from documentation alone.
- Per Increment 44, this is a one-time, database-level action that will cover every data source under that database automatically, including "View of Listings" — no separate per-data-source share needed.

### Proof design refined: query, not a bare object descriptor

The user's "retrieve at most 1 item, report count" description matches Notion's **query** call, not a plain `GET /v1/data_sources/{id}` object fetch (which returns exactly one object — a schema/metadata descriptor, no "count" concept). Refined design:

```
POST /v1/data_sources/{id}/query
Notion-Version: 2026-03-11   (per-call header override only — global client default untouched, per Increment 44)
Body: { "page_size": 1 }
```

Returns `{ results: [...], has_more, next_cursor }` — the same shape already used by the existing `/search`-based methods, so `results.length` as "count" and one safe title (via the same `extractTitle()` logic already in `client.ts`) fit naturally. Zero content dump; env-var-sourced ID (`NOTION_LISTINGS_DATA_SOURCE_ID`), never hard-coded; no create/update/delete/archive anywhere in this design. **Confirmed as the safest available approach for this proof.**

### Four-way disambiguation (honest, not oversimplified)

| Outcome                           | Status                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid ID, database not yet shared | `404 object_not_found` | Go do the sharing step above                                                                                                                                                                                                                                                                                                                                                                                    |
| Wrong/invalid data source ID      | `404 object_not_found` | **Same status as above** — Notion deliberately conflates "not shared" with "doesn't exist" to avoid leaking existence (confirmed, Increment 44's error-reference source). Since the ID was copied directly from Notion's UI, a wrong ID is the less likely of the two — if sharing is confirmed done and still 404, re-copy the ID and check the env var for whitespace/truncation before suspecting a code bug |
| Wrong API version                 | `400` validation error | Shouldn't occur since the proof sends the confirmed-current `2026-03-11` header for this one call; still worth surfacing the raw status/error text in the report                                                                                                                                                                                                                                                |
| Successful read                   | `200 OK`               | `results.length` and one title confirm sharing + readability at once                                                                                                                                                                                                                                                                                                                                            |

Nothing implemented this increment. No live call made against StayWhile's real Notion workspace. OwnerRez, n8n, Nest, August, and Cielo untouched.

---

## Increment 46 — 2026-08-25 (same day, continued): built the one-row read-only Notion data-source proof — implemented, unit-tested/mocked only, NOT run against Production

**Implements Increments 44/45's design exactly.** Additive only — the client's global `NOTION_VERSION` default and every existing Notion method are untouched. No live call has been made against StayWhile's real Notion workspace or against Notion's API at all this increment (only mocked unit tests were run).

### Files changed (7 modified, 1 new)

- `packages/integrations/src/notion/types.ts` — new `NotionDataSourceQueryResult` type (`{ resultCount, firstTitle }`).
- `packages/integrations/src/notion/client.ts` — new `NOTION_DATA_SOURCE_QUERY_VERSION = "2026-03-11"` constant (per-request override only) and new `queryDataSource(dataSourceId, pageSize = 1)` method: one `POST /data_sources/{id}/query` call, reports only count + first row's title, never full content.
- `packages/integrations/src/notion/client.test.ts` — 4 new tests (correct path/header/body, default page size, empty-result handling, error propagation).
- `apps/website/src/domains/integrations/services/integrations.service.ts` — new `getNotionListingsAccessProof(actor)`, mirroring the existing `getNotionHighlights()` pattern exactly: `assertPermission(actor, "integrations:read")` gate, reads `NOTION_API_KEY` + `NOTION_LISTINGS_DATA_SOURCE_ID` from env (neither ever logged), returns a discriminated `NotionListingsAccessProof` (`configured: false` / `ok: true` with count+title / `ok: false` with a classified `reason`). New `classifyNotionProofFailure()` maps HTTP status embedded in the thrown error message to `"unauthorized"` (401) / `"not_found_or_no_access"` (404) / `"version_or_validation_error"` (400) / `"unexpected_error"` (anything else) — exactly the four-way distinction from Increment 45, honestly limited by what Notion's API itself allows (404 covers both "not shared" and "invalid ID," per Notion's own error design).
- `apps/website/src/domains/integrations/services/integrations.service.test.ts` — 8 new tests covering both missing-env-var cases, success, all three classified failure reasons, the unexpected-error fallback, and RBAC denial propagation.
- `.env.example` — added `NOTION_LISTINGS_DATA_SOURCE_ID=""` placeholder with an explanatory comment (name only, no value, matches existing convention).
- `packages/integrations/src/notion/README.md` — new section documenting `queryDataSource()`, the version requirement, and the sharing precondition.
- **New file** `packages/integrations/src/notion/scripts/verify-listings-access.ts` — standalone CLI proof script, same convention as `august/scripts/check.ts`: prints only `configured: yes/no`, `read: success/failure`, `result count`, optional `first title`, and a classified failure reason — never a token, never the data source ID, never row/page content. **Typechecked only, never executed** (even locally) — running it makes a genuine live HTTP call to Notion's real API, which is out of scope until explicitly approved.

### Verification

- `packages/integrations`: focused `client.test.ts` — **12/12 passing** (8 pre-existing + 4 new).
- `website`: focused `integrations.service.test.ts` — **32/32 passing** (24 pre-existing + 8 new).
- `website`: full suite — **312/312 passing, 33 files, zero regressions** (up from 308 at Increment 41; the 4-test difference is this increment's new client-level tests living in the `@stayw/integrations` package, not `website` — the website-side increase of 8 tests is net new here).
- `pnpm --filter @stayw/integrations exec tsc --noEmit` — clean, 0 errors.
- `pnpm --filter website exec tsc --noEmit` — clean, 0 errors.

### Exact command for later Production verification (NOT run this increment)

```
NOTION_API_KEY="<production value>" NOTION_LISTINGS_DATA_SOURCE_ID="<production value>" \
  pnpm --filter @stayw/integrations exec tsx src/notion/scripts/verify-listings-access.ts
```

Real Production credential values are pasted inline into the command only — never written to any file, never committed, never logged by the script. This is the same "paste real values directly into a one-off local invocation" pattern already used for OwnerRez's and August's Production/live checks earlier in this file. Expected outcomes, per Increment 45's four-way table: `configured: no` (an env var is missing) / `read: success` + count/title (database is shared and readable) / `read: failure` + `not_found_or_no_access` (not shared yet, or wrong ID) / `read: failure` + `unauthorized` (bad token) / `read: failure` + `version_or_validation_error` (shouldn't occur, since the script sends the confirmed-current header).

**Explicitly not done this increment**: the proof was not run — not locally with real credentials, not against Production. Sharing the database in Notion's UI (Increment 45) has not been confirmed done. No Notion content was read or modified. OwnerRez, n8n workflows, Nest, August, and Cielo were all untouched.

---

## Increment 47 — 2026-08-25 (same day, continued): `queryDataSource()` implementation checkpoint — strengthened tests, verified clean, still NOT run against Production

**Closes out Increment 46's implementation with the specific rigor requested**: read `client.ts`/`types.ts` fully top-to-bottom (no duplicate exports, no diff artifacts — one `NotionDataSourceQueryResult` definition, one re-export line, `NOTION_VERSION`/`NOTION_DATA_SOURCE_QUERY_VERSION` each used in exactly the one place documented), and added a dedicated fetch-level test proving the header-scoping claim as an actual runtime fact, not just a code-reading inference.

### What was added this increment

- **New file** `packages/integrations/src/notion/notion-version.test.ts` — does **not** mock `HttpClient` (unlike the rest of the suite), instead stubs global `fetch` directly so the real header-merging logic in `core/http-client.ts` actually runs. Proves, on the wire: `connect()` (`/users/me`) sends `Notion-Version: 2022-06-28`; `sync()` (`/search`) sends `2022-06-28`; `queryDataSource()` sends `2026-03-11` for that one call, and an immediately-following `connect()` call on the **same client instance** still sends `2022-06-28` — i.e. the override is genuinely per-call, not a client-instance-level leak.
- `client.test.ts` — added: (1) a constructor-argument capture proving `HttpClient` is still constructed with `Notion-Version: 2022-06-28` as its default; (2) `toHaveBeenCalledTimes(1)` strengthening on the main `queryDataSource` test; (3) a dedicated "read-only by construction" test asserting the method's one call uses `POST` and explicitly is not `PATCH`/`DELETE`.

### Full verification this increment

- Focused: `pnpm --filter @stayw/integrations exec vitest run src/notion/` — **17/17 passing** (2 files: `client.test.ts` 14, `notion-version.test.ts` 3 new).
- `pnpm --filter @stayw/integrations exec tsc --noEmit` — clean, 0 errors.
- `pnpm --filter website exec tsc --noEmit` — clean, 0 errors.
- Full `@stayw/integrations` suite: **116/116 passing, 11 files**, zero regressions.
- Full `website` suite: **312/312 passing, 33 files**, unchanged from Increment 46 (no website-side test changes this increment).

### Confirmed: global Notion client behavior is unchanged

Proven at the fetch level this increment, not just asserted: every existing method (`connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`/`sync`/`listRecentlyEdited`) still sends `Notion-Version: 2022-06-28`. Only `queryDataSource()`'s own single request carries the `2026-03-11` override, and it does not persist onto any subsequent call on the same client instance.

### Files changed this increment (2 modified, 1 new — on top of Increment 46's 7 modified + 1 new)

- `packages/integrations/src/notion/client.test.ts` (+100/-1)
- `packages/integrations/src/notion/client.ts` (+44/-1, from Increment 46 — unchanged this increment beyond what 46 already added)
- **New**: `packages/integrations/src/notion/notion-version.test.ts`

### Exact safe Production verification step (still NOT run)

Unchanged from Increment 46 — same command, same script, still untouched since typechecking:

```
NOTION_API_KEY="<production value>" NOTION_LISTINGS_DATA_SOURCE_ID="<production value>" \
  pnpm --filter @stayw/integrations exec tsx src/notion/scripts/verify-listings-access.ts
```

Real Production values pasted inline only — never written to a file, never committed, never logged.

### What each outcome looks like

- **Success**: `configured: yes`, `read: success`, `result count: <N>`, optional `first title: <safe title>`.
- **Access denied / not shared**: `configured: yes`, `read: failure`, `reason: not_found_or_no_access (database not shared with this integration, or the data source ID is wrong — Notion returns the same status for both, by design)`.
- **Wrong/invalid data source ID**: **identical output to "access denied"** above — Notion's API deliberately returns the same `404 object_not_found` for both, so this script (and Notion itself) cannot distinguish them from the response alone. Practical tell: since the ID was copied directly from Notion's own UI, a wrong ID is the less likely of the two.
- **Version mismatch**: `configured: yes`, `read: failure`, `reason: version_or_validation_error` — shouldn't occur in practice, since the script always sends the confirmed-current `2026-03-11` header for this call.

Nothing was run against Production. No Notion content was read or modified. OwnerRez, n8n workflows, Nest, August, and Cielo remain untouched.

---

## Increment 48 — 2026-08-25 (same day, continued): completed local verification pass — formatted, re-read, git-checked. Still NOT run against Production.

**Final local-verification checkpoint before any Production call.** No new functionality added beyond Increment 46/47's read-only proof — this increment is verification only.

### What was done

- Ran `prettier --write` scoped only to the files this Notion work touched (not the wider working tree). Two files reformatted (`client.test.ts`, `notion/README.md` — whitespace/wrapping only, no logic change); the rest were already clean (`client.ts`, `types.ts`, `notion-version.test.ts`, `integrations.service.ts`, `integrations.service.test.ts` all reported "unchanged").
- Re-ran the focused Notion suite after formatting: **17/17 passing**, unchanged from before formatting.
- Re-ran `pnpm --filter @stayw/integrations exec tsc --noEmit`: clean, 0 errors.
- Re-ran the full `@stayw/integrations` suite: **116/116 passing, 11 files**, zero regressions.
- Read `client.ts`, `types.ts`, `client.test.ts` (261 lines total after formatting), and `notion-version.test.ts` **fully, top-to-bottom, post-format**. Confirmed: one `NotionDataSourceQueryResult` definition, one re-export line, no duplicate imports/exports, no malformed fragments, no leftover diff markers, brace/paren nesting closes cleanly (single `describe("NotionClient")` → nested `describe("listRecentlyEdited")` and `describe("queryDataSource")`, 14 `it()` cases total, matching vitest's own count).
- **Confirmed existing Notion methods still use the default `2022-06-28`** — not by re-reading code again, but re-running the fetch-level `notion-version.test.ts` proof from Increment 47, which still passes: `connect()`/`sync()` still send `2022-06-28`; only `queryDataSource()`'s one call sends `2026-03-11`, and it doesn't leak onto a subsequent call.
- `git diff --check` — run scoped to the Notion-touched files **and** across the entire working tree: **exit code 0, zero whitespace errors, both scopes.**
- `git status` reviewed in full and explicitly split: **8 files modified + 2 new** belong to this Notion work (`.env.example`, `HANDOFF.md`, `integrations.service.ts`/`.test.ts`, `notion/{README.md, client.ts, client.test.ts, types.ts}`, plus new `notion-version.test.ts` and `notion/scripts/verify-listings-access.ts`). Every other modified/untracked path (`.gitignore`, the `users` domain files, `platform/auth`/`platform/identity`/`platform/errors.ts`, `.claude/`, the `packages/database/*.mjs` diagnostic scripts, etc.) was already present in the working tree **before this entire investigation started** — confirmed against the original `git status` snapshot from the start of this session, untouched by any of this work.

### Result

Local verification is complete and clean. Nothing was committed, pushed, or deployed. No Production Notion API call was made. No Notion content was read or modified. The `ownerrez-property-sync` worktree, n8n workflows, Nest, August, and Cielo were not touched.

### Exact next Production step (not executed)

```
NOTION_API_KEY="<production value>" NOTION_LISTINGS_DATA_SOURCE_ID="<production value>" \
  pnpm --filter @stayw/integrations exec tsx src/notion/scripts/verify-listings-access.ts
```

Same command as Increments 46/47 — unchanged, still not run. Real Production values would be pasted inline only, never written to a file, never committed, never logged. Awaiting explicit approval before this is executed.

---

## Increment 49 — 2026-08-25 (same day, continued): OwnerRez inventory (read-only) + `/bookings` 400 root-caused and fixed locally — NOT yet deployed or verified live

**Priority shift, per explicit instruction: Notion paused (waiting on Michelle granting Teamspace Owner access); OwnerRez is now the active priority.** The `ownerrez-property-sync` worktree remains untouched throughout this increment — read-only `git log`/`git status` only, no entry, no edit, no merge.

### OwnerRez read-only inventory (`main` branch only)

- **Code**: `packages/integrations/src/ownerrez/{client.ts, types.ts, README.md, client.test.ts}` (real HTTP client, Basic Auth) + `packages/integrations/scripts/ownerrez-property-inventory.ts` (self-deleting, interactive-credential, read-only — still present, meaning it hasn't been successfully run to completion yet). **Nothing OwnerRez-specific exists under `apps/website/src/domains/properties/`** on `main` — confirmed by direct search, zero files.
- **Env vars**: `OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` (names only, `.env.example`). No hard-coded property mapping anywhere — confirmed by grep.
- **Production credentials**: per this file's own 2026-08-21 record, confirmed present and live at that time (20 real properties). Not re-verified live this increment.
- **Endpoints implemented**: `GET /properties`, `GET /bookings` (+ `since_utc`), `GET /guests/{id}`. No `GET /properties/{id}` detail endpoint. `receiveWebhook()` still throws `NotImplementedError`.
- **Retrievable today**: properties/IDs/names — yes, code-complete. Reservations/bookings/guest status — code exists, but see the 400 below.
- **OwnerRez → database sync**: **none on `main`.** `Property.ownerRezPropertyId`/`Guest.ownerRezGuestId` exist in the schema (confirmed via direct read) but are written/read nowhere outside their own definitions. The real preview/apply/create implementation exists only in the unmerged `worktree-ownerrez-property-sync` worktree (commits `a415919`/`46c4d6e`) — not re-inspected this increment, cited from this file's own prior record only.
- **Tests**: 9 tests on `main` before this increment (now 12 — see fix below). No property-sync tests exist on `main` — those 28 live only in the worktree.
- **Deployed vs. local**: everything on `main` matches Production (`main`'s HEAD was `da8ac61` going into this increment). The worktree's real sync implementation is neither merged nor deployed.

### `/bookings` 400 — root cause found, provable without any live call

Traced the exact code path: `getOwnerRezHighlights()` (`integrations.service.ts:458`) calls `client.listBookings()` with **zero arguments** → `listBookings()` (`client.ts`, pre-fix) built an **empty query string** when `sinceUtc` wasn't supplied → the actual outgoing request was a bare `GET /bookings`, no parameters at all. Confirmed via a repo-wide grep (including the untouched worktree) that **every real caller of `listBookings()` — `getOwnerRezHighlights()` and `sync("INBOUND")` — has always called it bare.** No caller anywhere has ever supplied `sinceUtc`; only the mocked unit test exercised that branch.

**Confirmed against OwnerRez's own current official API documentation** (fetched live, `api.ownerreservations.com/help/v2/bookings/get-bookings`): _"Either `property_ids` or `since_utc` is required."_ A bare, parameter-less `GET /bookings` is exactly the shape OwnerRez's own docs say is invalid — a `400` by design on OwnerRez's side, not a Production-environment, credential, or API-version issue. This is consistent with this file's own earlier admission (Increment 39) that bookings were only ever "proven live in local dev," never previously confirmed against the real Production account — today may be the first time this exact bare call ever actually hit Production.

### Fix implemented — minimal, additive, read-only-preserving (NOT deployed, NOT verified live)

- `packages/integrations/src/ownerrez/client.ts`: added `DEFAULT_BOOKINGS_LOOKBACK_DAYS = 90` and a `defaultSinceUtc()` helper (`Date.now()` minus 90 days, `.toISOString()`). `listBookings(params?)` now always sends `since_utc` — the caller's value if supplied, `defaultSinceUtc()` otherwise. **No change to either call site** (`getOwnerRezHighlights()`, `sync("INBOUND")`) — both call `listBookings()` bare exactly as before, and both now genuinely send a valid `since_utc` by construction, centralized in one place rather than duplicated across callers. `sync()`'s doc comment updated to note `recordsProcessed` now reflects the lookback window, not all-time. **Authentication (Basic Auth/credentials) untouched. No write/mutation endpoint added — `property_ids` was not added, per instruction, since nothing here scopes by property yet.**
- `packages/integrations/src/ownerrez/client.test.ts`: `listBookings` describe block — new tests proving (a) the default 90-day cutoff is sent when called bare (fake-timers, exact assertion), (b) the default is a well-formed ISO-8601 UTC datetime (regex + `Date` parse check), (c) the call is a plain GET with no write-shaped payload (single-arg call, same shape as `listProperties()`). `sync(INBOUND)` test updated to assert the actual request URL now contains `since_utc` (previously only asserted the mocked return value, never the request shape).

### Verification this increment

- Focused: `pnpm --filter @stayw/integrations exec vitest run src/ownerrez/client.test.ts` — **12/12 passing** (9 pre-existing + 3 new; the `sinceUtc`-override test was kept, not counted as new).
- `pnpm --filter @stayw/integrations exec tsc --noEmit` — clean, 0 errors.
- Full `@stayw/integrations` suite: **119/119 passing, 11 files**, zero regressions (up from 116).
- `pnpm --filter website exec tsc --noEmit` — clean, 0 errors.
- Focused `website` `integrations.service.test.ts` — **32/32 passing, unchanged** — confirms `getOwnerRezHighlights()`'s own code didn't need to change and `pickRelevantBookings()`'s sorting/filtering behavior is provably untouched (its tests mock `listBookings` at the module boundary and never needed updating).
- Full `website` suite: **312/312 passing, 33 files**, zero regressions.
- `git diff --check` — **exit code 0**, zero whitespace errors, whole working tree.
- Prettier run on both changed files — both already correctly formatted, no changes needed.

### Files changed this increment (2 modified)

- `packages/integrations/src/ownerrez/client.ts` (+28/-4)
- `packages/integrations/src/ownerrez/client.test.ts` (+69/-6, includes the new nested `describe("listBookings")` block)

### Exact Production verification step (NOT run — awaiting approval)

No standalone script exists yet for this one (unlike Notion's `verify-listings-access.ts`) — the safest read-only live check, once approved, is the same self-deleting-script pattern already used for OwnerRez's own Production credential check (Increment "2026-08-21"): a small, temporary, read-only script calling `listBookings()` bare (now with the fix, so it should send a valid `since_utc` automatically) against real Production credentials, printing only a count and never the credential values, then confirming Production's dashboard "OwnerRez" tile itself no longer shows the 400. Not built or run this increment — a decision for the next approved step.

Nothing deployed, nothing pushed, nothing committed. No live OwnerRez call was made (all verification was via mocked unit tests). No database, Vercel, or n8n changes. The `ownerrez-property-sync` worktree, Notion, n8n, Nest, August, and Cielo were all untouched.

---

## Increment 50 — 2026-08-25 (same day, continued): confirmed Increment 49's OwnerRez fix landed intact — no correction needed

User reported an "Error editing file" message after Increment 49's edit. Re-verified independently this increment (fresh `Read` + separate `grep`/`wc` via Bash, not relying on any cached tool state): `client.ts` is 175 lines, exactly one definition each of `DEFAULT_BOOKINGS_LOOKBACK_DAYS`, `defaultSinceUtc()`, and `listBookings()`, matching open/close braces throughout, no duplicate or partial fragment. **The fix fully landed correctly — no correction was necessary.**

Fresh re-run this increment: focused `client.test.ts` — **12/12 passing**; `tsc --noEmit` — clean; full `@stayw/integrations` suite — **119/119 passing, 11 files**; `git diff --check` — exit 0. All three required proofs (no-arg call includes `since_utc`; explicit override still wins; default is valid ISO) already existed from Increment 49 and re-verified passing — no new tests were needed.

**Files changed — unchanged from Increment 49** (2 modified, nothing new this increment): `packages/integrations/src/ownerrez/client.ts` (+28/-4), `packages/integrations/src/ownerrez/client.test.ts` (+69/-6).

Nothing deployed, pushed, or committed. No live OwnerRez request made. The `ownerrez-property-sync` worktree, Notion, n8n, Nest, August, and Cielo remain untouched.

---

## Increment 51 — 2026-08-25 (same day, continued): FINAL verification checkpoint for the OwnerRez `/bookings` fix — approved, still not deployed

**User has accepted the OwnerRez implementation as correct.** This increment is the closing verification pass before a deploy decision — no code changed.

### Root cause (recap)

`getOwnerRezHighlights()` and `sync("INBOUND")` both call `listBookings()` with zero arguments, producing a bare `GET /bookings` with no query parameters. OwnerRez's own current official API docs (`api.ownerreservations.com/help/v2/bookings/get-bookings`, fetched live) state: _"Either `property_ids` or `since_utc` is required."_ A repo-wide grep (worktree included) confirmed no caller anywhere has ever supplied either parameter — this is a real `400` by design on OwnerRez's side, not a Production/credential/API-version issue.

### The fix (recap)

`packages/integrations/src/ownerrez/client.ts`: `listBookings()` now always sends `since_utc` — the caller's value if supplied, otherwise a new `defaultSinceUtc()` helper (`DEFAULT_BOOKINGS_LOOKBACK_DAYS = 90`, `Date.now()` minus 90 days, `.toISOString()`). Neither real call site needed to change — both call `listBookings()` bare exactly as before, and both now genuinely send a valid parameter by construction.

### Final verification results (this increment, all fresh)

- Full `@stayw/integrations` suite: **119/119 passing, 11 files.**
- `website`'s `integrations.service.test.ts` (covers `getOwnerRezHighlights()`): **32/32 passing, unchanged.**
- `pnpm --filter website exec tsc --noEmit`: clean, 0 errors.
- `git diff --check`: exit code 0, zero whitespace errors.

### Confirmations

- **Exact files changed by this fix — 2 modified, nothing else**: `packages/integrations/src/ownerrez/client.ts` (+28/-4), `packages/integrations/src/ownerrez/client.test.ts` (+69/-6).
- **No write/mutation OwnerRez endpoint added** — confirmed by diffing `client.ts` for `PATCH`/`POST`/`DELETE`/any Prisma call: none introduced. `listBookings()` remains a single `GET`.
- **No database/schema change** — confirmed `git diff --stat` against `packages/database/prisma/schema.prisma` is empty.
- **The isolated `ownerrez-property-sync` worktree remains untouched** — confirmed via `git -C` into the worktree: clean working tree, HEAD still `46c4d6e`, unchanged since Increment 49.

### Exact Production verification step, after deployment (not run yet)

Once this fix is deployed to Production: reload the Production dashboard and check the "OwnerRez" tile. Expected outcomes:

- **Fixed**: the tile now shows the real upcoming-bookings preview (or "0 upcoming" if genuinely none exist in the 90-day window) instead of an error.
- **Still broken**: if it still shows a `400`, the 90-day default itself may be insufficient (e.g., if OwnerRez's real Production account has additional requirements beyond `since_utc`) — would need a fresh, separate diagnosis, not assumed to be the same root cause.
- No standalone script is needed for this check — unlike Notion's proof, this is directly observable on the existing, already-deployed dashboard tile once the fix ships, with zero new tooling.

Nothing deployed, committed, or pushed this increment. No live OwnerRez request made. Notion, n8n, Nest, August, Cielo, and the OwnerRez worktree remain untouched.

---

## Increment 52 — 2026-08-25 (same day, continued): dedicated OwnerRez and Notion dashboard sections — implemented, not committed/deployed

Planned in formal plan mode (research via 2 parallel Explore agents + 1 Plan agent, full detail in `/Users/kristinejoyreyes/.claude-staywhile/plans/witty-chasing-bachman.md`), approved with one revision, then implemented. Purely a read-through UI/service-layer addition — no persistence, no writes, no OwnerRez/Notion client HTTP-behavior change.

### What was built

- **New `/ownerrez` page** (`apps/website/app/(dashboard)/ownerrez/page.tsx`) — shows real OwnerRez properties (via new `getOwnerRezProperties(actor)`) and up to 20 upcoming bookings (via `getOwnerRezHighlights(actor, 20)` — the function gained an optional `limit = 5` param, default unchanged so `dashboard.service.ts`'s existing bare call keeps working). Rendered by new presentational component `OwnerRezOverview.tsx` (`MetricStrip` + two `Table`s, modeled on `ThermostatsList.tsx` — zero write forms).
- **New `/notion` page** (`apps/website/app/(dashboard)/notion/page.tsx`) — status/placeholder only, per the user's approved revision to the plan: does **not** call the live `getNotionListingsAccessProof()` proof on render (that's a real Notion API call — out of scope for a routine status page). Instead calls a new, non-network `getNotionIntegrationConfigStatus(actor)` (checks `NOTION_API_KEY` presence only, no HTTP call) and shows three static facts: integration/token configured; real search pending "View of Listings" access; keyword/property/region search coming next once resolved.
- **`integrations.service.ts`**: added `getOwnerRezProperties` (wraps `OwnerrezClient.listProperties()`, same `IntegrationHighlights<T>` shape as its siblings, uncapped), `getNotionIntegrationConfigStatus` (no network call, see above), and the `limit` param on `getOwnerRezHighlights`. Added `type OwnerrezProperty` to the existing import line.
- **`nav-config.ts`**: added `/ownerrez` and `/notion` to the "Operations" section, right after Reservations — reused existing `calendar`/`plug` `NavIconKey`s, no `packages/ui` change needed.
- **`DashboardSummary.tsx`**: both Home tiles (Notion, OwnerRez) gained a `SectionHeader action={<Link>View all</Link>}` to their new dedicated page (matching the existing "Recent Activity" precedent exactly) and now render `.slice(0, 3)` instead of the full capped-at-5 list — a genuinely lighter Home tile without touching `dashboard.service.ts`.
- **Permissions**: both new pages/functions reuse `integrations:read` — zero RBAC/seed changes, same roles (`admin`/`ops_manager`/`read_only`) see this data identically to how they already do on Home today.

### Verification

- `pnpm --filter website exec tsc --noEmit` — clean, 0 errors.
- Focused `integrations.service.test.ts` — **39/39 passing** (32 pre-existing + 7 new: `getOwnerRezProperties` not-configured/success/error/denied, `getNotionIntegrationConfigStatus` not-configured/configured-no-network-call/denied).
- Full `website` suite — **319/319 passing, 33 files**, zero regressions.
- `next build` — **failed, confirmed unrelated to this work**: `apps/website/env.ts`'s required `N8N_BASE_URL`/`N8N_WEBHOOK_SHARED_SECRET`/`N8N_INBOUND_WEBHOOK_SHARED_SECRET` schema rejects this local `.env.local`'s pre-existing (malformed/incomplete) n8n values, failing to collect page data for `/api/webhooks/n8n` — nothing touched by this increment relates to n8n or that route. Per the explicit instruction not to touch n8n, no workaround was attempted (not even a temporary placeholder-value build, since that file also holds a real local n8n credential). Typecheck + full test suite are the two checks the approved plan itself named as sufficient for this class of change (thin service wrappers, no new business logic).
- Manual browser click-through: **not performed** — no browser tool connected this session (consistent with earlier findings this same session).

### Files changed (5 modified, 3 new)

- NEW: `apps/website/app/(dashboard)/ownerrez/page.tsx`, `apps/website/app/(dashboard)/notion/page.tsx`, `apps/website/src/domains/integrations/components/OwnerRezOverview.tsx`
- MODIFIED: `apps/website/src/domains/integrations/services/integrations.service.ts`, `integrations.service.test.ts`, `apps/website/src/platform/layout/nav-config.ts`, `apps/website/src/domains/dashboard/components/DashboardSummary.tsx`

### Explicitly not done / untouched

No Notion search implemented (placeholder only, per the pause). No persistence/sync of OwnerRez data into the database. `packages/integrations/src/ownerrez/client.ts`/`notion/client.ts` untouched beyond what already shipped (the `since_utc` fix, `queryDataSource()`). `packages/database/prisma/schema.prisma` untouched. The `ownerrez-property-sync` worktree, n8n, Nest, August, and Cielo untouched. Nothing committed, pushed, or deployed this increment.

---

## Increment 53 — 2026-08-25 (same day, continued): AUTHORITATIVE PRODUCTION CHECKPOINT — OwnerRez `/bookings` fix live, Notion access fully verified and read-only capability shipped, both dedicated dashboard sections deployed

**This section is the authoritative current-state summary for OwnerRez, Notion, and the dashboard-sections work as of 2026-08-25.** History above is left intact — nothing rewritten or deleted. Where an older entry conflicts, this section governs.

### OwnerRez

- **Production `/bookings` 400 root cause, confirmed**: `getOwnerRezHighlights()`/`sync("INBOUND")` called `OwnerrezClient.listBookings()` bare (zero query params) — a plain `GET /bookings`. OwnerRez's own official API docs require `property_ids` or `since_utc`; a bare call is invalid by OwnerRez's own design, not a Production/credential/version issue.
- **Fixed**: `listBookings()` now defaults to a rolling 90-day-back `since_utc` cutoff whenever the caller doesn't supply one — centralized in the client, so neither real call site needed to change.
- **Commit `46c6903`** — "Fix OwnerRez bookings request with required since_utc." **Pushed and deployed; Vercel confirmed Ready.**
- **Dedicated `/ownerrez` dashboard section added in commit `2e1f1bd`** — live properties + up to 20 upcoming bookings, via new `getOwnerRezProperties()` and an optional `limit` param on `getOwnerRezHighlights()`.
- **OwnerRez remains strictly read-only** — no database persistence, no sync, no write path added by any of this work. OwnerRez stays the source of truth for the property portfolio; StayWhile's database is untouched by these changes.

### Notion — access now fully verified

- The StayWhile Dashboard's internal Notion integration is configured **read-only by capability**: can read content; cannot update content; cannot insert content.
- **Root cause of the earlier access gap, resolved**: the user was originally only a Teamspace Member (not Owner) in the main StayAWhileWithUs teamspace — insufficient to grant the integration database-level access. This has been resolved; the user is now Workspace Owner.
- **"View of Listings" now shows the StayWhile Dashboard integration under Connections** — the missing sharing step (flagged in Increments 44/45) is complete.
- **Fresh token authentication proven**: `/users/me` → `authenticated: yes`.
- **Direct read-only data source verification proven** (via the approved `verify-listings-access.ts` script, run against real Production credentials): `configured: yes`, `read: success`, `result count: 1`, `first title: Moonlit Cove`.
- **Therefore, fully verified as of this increment**: `NOTION_API_KEY`, `NOTION_LISTINGS_DATA_SOURCE_ID`, database sharing, and real read access are all confirmed working — not merely "configured," actually proven live.
- **No Notion content was created, edited, deleted, moved, archived, or otherwise modified** at any point in this entire investigation, from Increment 40 through this one.

### Notion read-only API implementation — shipped

- Added `NotionClient.queryDataSource(dataSourceId, pageSize)` — one `POST /v1/data_sources/{id}/query` call, `Notion-Version: 2026-03-11` sent as a **per-request header override only**. The verification script uses `page_size: 1`.
- **The client's existing default `Notion-Version: 2022-06-28` behavior is unchanged for every other method** (`/users/me`, `/search`-based `sync()`/`listRecentlyEdited()`) — proven at the fetch level (Increment 47's `notion-version.test.ts`), not just asserted.
- **Commit `dfe3985`** — "Add read-only Notion data source query support." **Pushed; Vercel Production deployment confirmed Ready.**

### Dedicated dashboard sections

- **Commit `2e1f1bd`** — "Add dedicated OwnerRez and Notion dashboard sections."
- **Commit `376f643`** — "Update Notion page after access verification."
- `/ownerrez` and `/notion` are now both part of `main`, deployed.
- Home dashboard keeps lighter (3-item) summary tiles for both, each with a "View all" link into its dedicated section.
- `/notion` now shows: **Notion connection: Connected**; **View of Listings: Read access verified**; **Property/keyword/region search: Next feature.**

### Deployment issue — root-caused and resolved

- Vercel's clean build of `376f643` initially failed: `integrations.service.ts` referenced `NotionClient.queryDataSource()`, but the Notion client files defining that method were still only local/uncommitted (confirmed via direct diff against `origin/main` and an isolated clean-build reproduction in a temporary worktree — exact same error, same line, reproduced before any fix was applied).
- Exact clean-build error: `Property 'queryDataSource' does not exist on type 'NotionClient'.`
- The required Notion read-only client/type/test/docs/script files were committed in `dfe3985` (only those 6 files — nothing else staged).
- **Production now builds successfully and shows Ready**, confirmed via both an isolated pre-commit clean-build reproduction (overlaying the exact staged content onto a fresh worktree) and the real Vercel deployment afterward.

### Current next priorities

1. Production click-through verification of `/ownerrez` and `/notion` (steps already handed to the user; results not yet reported back as of this increment).
2. Build real Notion keyword/property/region search against "View of Listings" — strictly read-only, not started yet.
3. Then return to the isolated `ownerrez-property-sync` worktree for property source-of-truth work (still unmerged, still at commit `46c4d6e`, untouched by everything in this increment).
4. n8n, Nest, August, and Cielo remain untouched by this entire sequence.

### Local credential hygiene

**Record, not yet acted on by this session**: the temporary terminal copies of `NOTION_API_KEY` and `NOTION_LISTINGS_DATA_SOURCE_ID` used for the manual local verification run should be unset from the shell/environment after verification — they were only ever needed for that one-off script invocation. The real values remain correctly set in Vercel Production only; nothing was written to any local file.

---

## Increment 54 — 2026-08-26: OwnerRez 20-property discrepancy root-caused via live Production inspection and fixed (Part 1 of 2); Notion "View of Listings" schema discovered read-only; Notion search deliberately deferred to a separate rollout

### Root cause — proven via live, read-only Production calls (not inferred)

A direct, read-only inspection against real OwnerRez Production credentials (three raw `GET` calls, counts/metadata only, no records or credentials printed) confirmed **two simultaneous, independent defects**, not one:

- `GET /properties?active=true` → `count: 38`, `limit: 20`, `next_page_url` **non-null**.
- `GET /properties?active=false` → `count: 20`, `limit: 20`, `next_page_url: null` (complete in one page).
- Bare `GET /properties` (the code's prior behavior) → identical to `active=true` — confirming OwnerRez's documented `active` default (`true` when omitted, per its live OpenAPI spec) was silently excluding all 20 inactive properties.
- `GET /bookings?since_utc=<90d>` (the code's prior behavior) → `limit: 20`, `next_page_url` **non-null** — the 90-day booking window is _currently_ being silently truncated in Production too, not just a theoretical risk.

**Verified truth: OwnerRez's real portfolio is 58 properties (38 active + 20 inactive).** The dashboard's "20 Total / 20 Active" was page 1 of the paginated active-only result — both the undocumented `active=true` default and unhandled pagination were live, simultaneous causes.

**Also found while implementing the fix**: `OwnerrezPage<T>` had the wrong field name (`next_page` — OwnerRez's real field, confirmed via its OpenAPI spec, is `next_page_url`). Pagination could never have been followed under the old name even if the calling code had tried.

### Fix implemented — `packages/integrations/src/ownerrez/` (client.ts, types.ts, client.test.ts) — NOT committed, NOT deployed

- `OwnerrezPage<T>` corrected to `next_page_url` (+ typed `count`/`limit`/`offset`).
- New private `OwnerrezClient.fetchAllPages<T>()`: follows `next_page_url` to completion, with **two independent safety mechanisms** — a hard 50-page cap, and rejection of any pagination URL already seen in the same call (cycle detection) — never trusts a single guard alone.
- New `resolvePaginationPath()`: validates every `next_page_url` (relative or absolute) resolves to `https://api.ownerreservations.com` **and** stays within the endpoint family being paginated (`/v2/properties` pagination can't wander into `/v2/bookings` or a foreign host) before it is ever fetched — never blindly follows an arbitrary URL a response happens to contain.
- `listProperties()`: now fetches `active=true` and `active=false` explicitly (each fully paginated), merges by `id`, dedupes defensively.
- `listBookings()`: now fully paginated via the same helper. `sync("INBOUND")` inherits this automatically (calls `listBookings()` internally) — no separate change needed there.
- Public method signatures unchanged (`Promise<OwnerrezProperty[]>` / `Promise<OwnerrezBooking[]>`) — `integrations.service.ts`, `dashboard.service.ts`, and `/ownerrez/page.tsx` required **zero** changes.
- Notion, n8n, Nest, August, Cielo, and the `ownerrez-property-sync` worktree were not touched. No database write, no staging/commit/push/deploy.

### Verification, forced fresh this increment

- `packages/integrations/src/ownerrez/client.test.ts`: **24/24 passing** (14 new tests covering active+inactive merge/dedupe, multi-page pagination for both properties and bookings, relative and absolute `next_page_url` resolution, foreign-host rejection, wrong-endpoint-path rejection, repeated-URL rejection, the 50-page cap, and a check that every request stays a bare GET with no write-shaped call introduced).
- `@stayw/integrations` full suite: **131/131 passing** (0 regressions across Notion/August/Cielo/Nest/Asana/Slack/core).
- `@stayw/integrations` `tsc --noEmit`: clean (one implicit-`any` circularity found and fixed with an explicit type annotation during this pass).
- Website tests touching OwnerRez (`dashboard.service.test.ts`, `integrations.service.test.ts`): **49/49 passing**, unchanged — proves the fix is fully transparent to every caller.
- Website `tsc --noEmit`: clean.
- `git diff --check` on the changed files: clean (no whitespace errors).
- **Production build**: attempted, **failed for a reason fully unrelated to this change** — `apps/website/app/api/webhooks/n8n/route.ts`'s env validation fails locally because `.env.local` is missing `N8N_WEBHOOK_SHARED_SECRET`/`N8N_INBOUND_WEBHOOK_SHARED_SECRET` (only `N8N_BASE_URL` is set). This is a pre-existing local-environment gap in the n8n webhook route, not touched or introduced by this session — confirmed by isolating the failure message (pure env-schema validation, zero mention of anything in `ownerrez/`) and by every OwnerRez-relevant test/typecheck passing clean. n8n remains explicitly out of scope this increment; the gap was not worked around or fixed.

### Files changed this increment (3 modified, all in `packages/integrations/src/ownerrez/`)

`client.ts`, `types.ts`, `client.test.ts`. Nothing else.

### Expected Production result once deployed (not yet deployed)

- `/ownerrez`: Total Properties = **58**, Active Properties = **38**, and the 20 previously-invisible inactive properties become visible in the table (an "Inactive" count isn't a separate metric in the current UI — `Total − Active` will equal 20 once this ships, since the UI's existing `activeProperties` filter already computes correctly off whatever array it's given).
- `/bookings`-backed data (dashboard highlights + `/ownerrez`'s "Upcoming bookings"): the 90-day window will return its full, real count instead of being silently capped at 20 raw items before any upcoming/recency filtering is applied.

### Notion — schema discovered this increment (read-only, one live call), search deliberately NOT implemented

Live `GET /v1/data_sources/{NOTION_LISTINGS_DATA_SOURCE_ID}` (`Notion-Version: 2026-03-11`) confirmed "View of Listings"'s real schema: `Name` (title), `Address` (rich_text), `Number of Guests`/`Bathrooms`/`Bedrooms` (number), `Direct booking`/`Airbnb Link`/`VRBO Link` (rich_text), `Google Drive Photos`/`Guidebook` (url). **No `Region` property exists** — confirmed, not assumed. Per explicit direction this increment, Notion search implementation (real listing display, name/keyword search, app-side region filtering via the existing 38-property meeting reference plus the `BOP`/`Miramar Bliss 2` aliases — both already documented above as reference-only, human-confirmed-matching data, explicitly **not** covering the full 58-property OwnerRez portfolio, so unmatched properties must render as "Unknown / Unassigned," never guessed) is fully designed but **deliberately deferred to a separate rollout, after the OwnerRez fix above is deployed and Production-verified.** Full design (exact files, API calls, test plan) is recorded in this session's chat transcript, not yet transcribed into this file since it isn't being built yet.

### Current next priorities (superseded by Increment 55 below)

1. ~~User to review and approve this increment's OwnerRez diff (still uncommitted, undeployed).~~ Done — see Increment 55.
2. ~~Commit, push, deploy; then Production-verify.~~ Done — see Increment 55.
3. Then, as a separate rollout: implement Notion real listing display + name/keyword/region search per the design referenced above.
4. Then return to the isolated `ownerrez-property-sync` worktree (still unmerged, still at commit `46c4d6e`) — now working from a trustworthy property count.
5. n8n, Nest, August, and Cielo remain untouched.

---

## Increment 55 — 2026-08-26 (continued): OwnerRez pagination fix committed, pushed, and Production-verified — COMPLETE

**Commit `e67871e802a1c1c1c74b4ec693929581b66a2a22`** — "Fix OwnerRez property and booking pagination." Contains exactly 3 files: `packages/integrations/src/ownerrez/client.ts`, `types.ts`, `client.test.ts` (the Increment 54 diff, reformatted only by the repo's pre-commit `prettier` hook — no logic change, re-verified 24/24 passing post-commit). Pushed to `origin/main` (`dfe3985..e67871e`), confirmed via `git fetch` that `origin/main` moved to this exact SHA. No other files were staged or committed — HANDOFF.md itself, the users-domain/auth/identity work, and the `packages/database/*.mjs` diagnostic scripts all remain exactly as they were, untouched by this commit.

**Production verification — confirmed by the user directly on the deployed `/ownerrez` page, after this commit reached Production via Vercel's auto-deploy:**

| Metric              | Before this fix        | After this fix (Production, verified) |
| ------------------- | ---------------------- | ------------------------------------- |
| Total Properties    | 20                     | **58**                                |
| Active Properties   | 20                     | **38**                                |
| Inactive Properties | 0 (not visible at all) | **20** (derived: Total − Active)      |
| Upcoming Bookings   | 15                     | **20**                                |

This matches the root cause proven in Increment 54's live inspection exactly: the true portfolio is 38 active + 20 inactive = 58, and the prior code's undocumented `active=true` default plus unhandled pagination were both hiding real data. **OwnerRez full property + booking pagination is now COMPLETE and PRODUCTION-VERIFIED — no further OwnerRez code changes planned or needed at this time.**

### Next priority — Notion real listings + search (separate rollout, not started)

Per the standing plan (Increment 54's "Notion — schema discovered..." section, and this session's chat transcript for full file/test/API-call detail): implement real listing display on `/notion`, replacing the current status-only placeholder, with:

- Property/name search against the confirmed `Name` (title) field.
- Keyword search against `Name`, `Address`, and `Direct booking` (rich_text) — explicitly excluding the link-typed fields (`Airbnb Link`, `VRBO Link`, `Google Drive Photos`, `Guidebook`) from keyword matching.
- App-side region filtering using the existing 38-property meeting reference table (§"Meeting reference — Michelle's 38-property regional structure" above) plus the `BOP → Bird of Paradise` / `Miramar Bliss 2 → Miramar Bliss` aliases — explicitly a **known-subset** mapping, not a match for the full 58-property OwnerRez portfolio just confirmed above; any listing whose name isn't in that table must render as **"Unknown / Unassigned,"** never guessed or inferred.
- Full read-only Notion data-source fetch (paginated via `has_more`/`next_cursor`), no writes, no database persistence, no changes to Notion structure.

Not started. Should reuse the same pagination-safety discipline just proven on OwnerRez (cycle detection + hard page cap) for Notion's own cursor pagination.

### Updated next priorities, in order

1. Implement Notion real listing display + name/keyword/region search (design already agreed, not yet built).
2. Deploy and Production-verify the Notion feature.
3. Return to the isolated `ownerrez-property-sync` worktree (still unmerged, still at commit `46c4d6e`) — now working from a trustworthy, Production-verified property count.
4. n8n, Nest, August, and Cielo remain untouched.

---

## Increment 56 — 2026-08-26 (continued): observed Notion display-name variant recorded; Notion real listing display + search implementation begins

**Observed Notion display-name variant, recorded per explicit user confirmation before any use in code (2026-08-26)**: the user has observed the literal string **`BOP (Birds of Paradise)`** as a real display name in Production Notion — not previously documented anywhere in this file. This is recorded here, before implementation, as a third known-safe match for the same property the existing reference table calls "Bird of Paradise" (Destin region) and the existing alias table already covers under the shorter `BOP`. Per the standing mapping rule (no inference from similarity, ever), this exact string — along with the plain `Birds of Paradise` variant — is added to the app-side region-matching alias/variant table as **exact, literal, case/whitespace-normalized matches only**, alongside the two aliases already documented above (`BOP → Bird of Paradise`, `Miramar Bliss 2 → Miramar Bliss`). No fuzzy or substring matching is introduced. No Notion or OwnerRez record is renamed or modified by this.

Implementation of the approved Notion listing-display + search plan (property/name search, keyword search over Name/Address/non-URL Direct booking, app-side region filtering with "Unknown / Unassigned" fallback, full cursor-paginated retrieval, strictly read-only, no raw Notion property objects reaching the Client Component) begins below this entry.

---

## Increment 57 — 2026-08-26 (continued): Notion listings + search — COMPLETE, committed, deployed, and Production-verified

**Commit `0fa2ad0388a7e6a9c95069e0a412e666e6362e82`** — "Add read-only Notion listings search." 17 files (Notion client pagination/mapping + tests, app-side region config/matching + tests, URL-safety utility + tests, `NotionListingsSearch` component + tests, service-layer `listNotionListings()` + tests, `/notion` page wiring, plus the `@testing-library/react`/`jsdom` dev-dependency additions and matching `vitest.config.mts`/`pnpm-lock.yaml` changes this required — the first React component test in this codebase). `HANDOFF.md` was deliberately excluded from this commit (it carries a large body of unrelated accumulated documentation not yet committed) and remains uncommitted, tracked separately. Pushed to `origin/main` (`e67871e..0fa2ad0`), confirmed via `git fetch` that `origin/main` moved to this exact SHA.

**Production verification — confirmed by the user directly on the deployed `/notion` page, after this commit reached Production via Vercel's auto-deploy:**

- "Notion connection: Connected" and "View of Listings: Read access verified" — both derived from the real live `listNotionListings()` result on this page load, not a hardcoded status string.
- **35 of 35 real Notion listings loaded** — full pagination confirmed working against the real data source (no silent truncation).
- Real listing fields (name, address, bedrooms, bathrooms, guests, direct booking, Airbnb/VRBO/photos/guidebook links) render correctly.
- **Region mapping confirmed working**: e.g. Moonlit Cove → SRQ (exact match against the 38-property reference table).
- **Conservative fallback confirmed working**: e.g. Surfside Solace → "Unknown / Unassigned" in Production, despite "Surfside Solace" being a name listed in the Destin region of the reference table. The exact Notion name did not match the current canonical/alias mapping; the cause has not yet been investigated. **Flagged, not fixed**: if the real Notion display name for this listing is later confirmed by a human, it can be added as an explicit alias/variant the same way `BOP (Birds of Paradise)` was — never inferred or guessed at. Until then, "Unknown / Unassigned" is the correct, safe result, not a bug.
- Name search, keyword search, region filter, and Reset are all present and working; the page remains strictly read-only.

**Standing rule reaffirmed, unchanged**: unknown/unmatched regions must always resolve to "Unknown / Unassigned" — never inferred from address, property name similarity, OwnerRez data, or a nearby mapped property. The Surfside Solace observation above is a live proof of this rule working correctly, not a reason to relax it.

**Explicit note on the two source-system counts — do not conflate them**: Notion's "View of Listings" now confirmed at **35 listings**; OwnerRez confirmed at **58 total properties** (38 active + 20 inactive, per Increment 55). **These are separate source-system counts and must not be assumed to reconcile** — nothing in this project has yet established that every OwnerRez property should have a corresponding Notion listing, or vice versa. Any future reconciliation work between the two must be based on an explicit, human-confirmed mapping decision, not an assumption that the counts should match.

**No application code changed this increment** — this entry is a documentation-only Production-verification checkpoint.

### Updated next priorities, in order (supersedes Increment 55/56's list)

1. ~~Implement Notion real listing display + name/keyword/region search.~~ Done — see this increment.
2. ~~Deploy and Production-verify the Notion feature.~~ Done — see this increment.
3. **Return to the isolated `ownerrez-property-sync` worktree** (still unmerged, still at commit `46c4d6e`) — now working from both a trustworthy, Production-verified OwnerRez property count (58) and a trustworthy, Production-verified Notion listing count (35), tracked as separate systems per the note above.
4. n8n, Nest, August, and Cielo remain untouched.

---

## Increment 58 — 2026-08-26 (continued): OwnerRez read-only match report (narrowed Phase A) shipped, Production-verified; read-only candidate-mapping investigation completed for the 7 known StayWhile properties — nothing linked

### Phase A — COMPLETE, committed, merged, deployed, Production-verified

Investigation this session found the existing `ownerrez-property-sync` worktree (`46c4d6e`) carried real write-capable code (`confirmOwnerRezPropertyMatch`/`createPropertyFromOwnerRez`/`applyOwnerRezPropertyChanges`, a schema migration, `getProperty()`, and the full write-capable UI/actions) mixed into the same file as its read-only match report — an unsafe unit to bring toward Production as-is. Rather than cherry-pick or partially extract from that branch, a **fresh branch (`ownerrez-match-report-preview`) was cut directly from `main`** and a narrower, hand-authored, strictly read-only implementation was built: `matchOwnerRezProperties()` (a new, dedicated service — `ownerrez-match-report.service.ts` — using a narrow Prisma `select` of exactly `id`/`name`/`internalCode`/`ownerRezPropertyId`, never the full `Property` row), a read-only `OwnerRezMatchReportPreview` component, and a new `/properties/ownerrez` page — with source-level and rendered-DOM tests proving zero write-capable imports, forms, buttons, or dialogs anywhere in the route.

- **Commit `93462dfc8dafda796948f0775ee42fb9841c2dd7`** — "Add read-only OwnerRez property match report." 8 files, verified clean (typecheck, full test suites, `git diff --check`, and a clean production build using a temporary local-only fake `.env.local`, deleted immediately after each check).
- Fast-forward merged into `main` (`git merge --ff-only`) — no merge commit, linear history, confirmed zero effect on any unrelated dirty/untracked file in the primary checkout.
- Pushed; deployed via Vercel auto-deploy; **Production-verified directly by the user** on the live `/properties/ownerrez` page.
- The old `ownerrez-property-sync` worktree/branch was **not** used, touched, rebased, or merged for this — it remains exactly as it was (`46c4d6e`, isolated, unmerged), still carrying real write-capable code not yet approved for Production.

### Phase A — confirmed Production truth (live, read-only, verified by the user)

- OwnerRez: **58 total** (38 active, 20 inactive) — matches Increment 55's earlier live pagination fix verification.
- StayWhile: **7 properties**.
- Already linked: **0**.
- Automatic proposed exact-`internal_code` matches: **0** — expected and correct, not a bug: OwnerRez's `internal_code` field holds OwnerRez's own short names (e.g. "Aqua Palm"), not StayWhile's `internalCode` convention (e.g. `AQUA-PALM`), so exact-code auto-proposal structurally can't fire yet regardless of how obvious a name match looks to a human.
- Unmatched OwnerRez: **58**. Unmatched StayWhile: **7**.
- **Phase A verified successfully and remains strictly read-only** — no Confirm/Create/Apply control exists anywhere in the deployed code (confirmed both by direct grep of the full commit diff and by dedicated tests), no migration was applied, no write of any kind occurred.

### Read-only candidate-mapping investigation — completed this session, nothing linked

Using one live, read-only `GET /properties` call (both `active=true`/`active=false`, fully paginated — the same mechanism already proven in Phase A) against the real 58-property OwnerRez portfolio, each of the 7 known StayWhile property names was checked for plausible OwnerRez candidates. **Name/internal_code similarity was used only as a human-review clue — never as an automatic matching rule, and nothing was linked, written, or applied.**

**Six verified-unique candidates** — each checked against the _entire_ 58-property set (not just accepted on first look) and found to have no competing entry anywhere in the dataset:

| StayWhile (internalCode)      | OwnerRez ID | OwnerRez name | Status |
| ----------------------------- | ----------- | ------------- | ------ |
| Aqua Palm (`AQUA-PALM`)       | 386471      | Aqua Palm     | Active |
| Bahamas (`BAHAMAS`)           | 377839      | The Bahamas   | Active |
| Bonjour AMI (`BONJOUR-AMI`)   | 432997      | Bonjour AMI   | Active |
| Island Tides (`ISLAND-TIDES`) | 355021      | Island Tides  | Active |
| Ocean Pearl (`OCEAN-PEARL`)   | 431354      | Ocean Pearl   | Active |
| Sandy Nudes (`SANDY-NUDES`)   | 355024      | Sandy Nudes   | Active |

Island Tides has one near-neighbor in the full dataset — **Island SOS (355022, Active)** — sharing the word "Island." Inspected directly: the second word ("SOS" vs. "Tides") is unmistakably different, confirming this is a distinct, unrelated property, not a competing candidate. All six are **ready to present for explicit human confirmation** — none have been linked.

**Miramar Bliss (`MIRAMAR-BLISS`) — unresolved, genuinely ambiguous, all three candidates preserved, none preferred:**

| OwnerRez ID | OwnerRez name    | internal_code    | Status   |
| ----------- | ---------------- | ---------------- | -------- |
| 389173      | Miramar Bliss    | Miramar Bliss    | Inactive |
| 410682      | Miramar Bliss II | Miramar Bliss II | Inactive |
| 480401      | Miramar-Bliss    | Miramar Bliss 2  | Active   |

**No candidate is designated preferred or correct.** Active status (480401) and the existing Notion-side alias (`Miramar Bliss 2 → Miramar Bliss`, documented in the region-reference section above) are recorded here only as **clues for a human to weigh — not proof, and not a tiebreaker rule.** Whether `389173`/`480401` represent the same physical property at different points in time, and whether `410682` ("II") is a genuinely separate second unit, remains an open question requiring stronger authoritative evidence than name similarity.

**StayWhile Production database credentials were not available in this local environment** (`.env.local`'s `DATABASE_URL`/`DIRECT_URL` point to a local dev database, not Production) — the 7 real `internalCode` values above were provided directly by the user from the deployed Production dashboard, not queried by this session. No Production database credentials were requested or configured as part of this investigation.

**Nothing was linked, written, or applied anywhere in this investigation** — no database write, no OwnerRez write, no code change, no migration.

### Current next priorities, in order (supersedes Increment 57's list)

1. **Present the six verified-unique OwnerRez candidates (Aqua Palm, Bahamas, Bonjour AMI, Island Tides, Ocean Pearl, Sandy Nudes) for explicit human confirmation.**
2. **Do not write or link anything until those mappings are explicitly approved**, one at a time.
3. **Investigate Miramar Bliss separately, using stronger authoritative evidence than name similarity** — do not infer or default to any of the three candidates.
4. **After human approval of the six**, design a narrow Phase B: a one-at-a-time "Confirm Link" write capability, built and verified inside the isolated `ownerrez-property-sync` worktree — kept isolated, **not merged or activated** until separately approved.
5. n8n, Nest, August, and Cielo remain untouched.

**Standing safety rule reaffirmed**: candidate identification is not link approval. No automatic name-based matching, no fuzzy-matching auto-decisions, no bulk linking, no writes of any kind until a human explicitly confirms each individual mapping.
