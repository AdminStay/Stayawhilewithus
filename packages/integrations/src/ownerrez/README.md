# OwnerRez integration

Status: real HTTP client against the v2 API — `connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`/`listProperties`/`listBookings`/`getGuest`/`sync("INBOUND")` all make real requests via `HttpClient` (Basic Auth: `username` + API `token`, not a bearer token). Only `receiveWebhook` is still a stub — OwnerRez's webhook payload shape is an open design question (see `INTEGRATION_INVENTORY.md`), not a credential gap.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself; the caller (e.g. a future domain-level sync job) does.

**`sync("INBOUND")` deliberately does not write to StayWhile's database.** It fetches real bookings from OwnerRez and reports how many it found. OwnerRez is confirmed **production data** (see `HANDOFF.md`) — mapping bookings into `Reservation`/`Guest` rows needs its own identity-matching/dedupe design and explicit write authorization, not just an API token, so that's intentionally left as a separate follow-up rather than bundled into this client. `sync("OUTBOUND")` rejects outright — OwnerRez is the system of record for its own bookings; StayWhile never pushes changes back to it.

Credentials: `OWNERREZ_USERNAME` + `OWNERREZ_API_TOKEN` (both required for Basic Auth — see `.env.example`). Verified live 2026-08-15 (`validateCredentials()` succeeded, `listProperties()`/`listBookings()` confirmed 20 real properties + real recent bookings against the real StayWhile account); every write-capable method is still unimplemented.

**Field-name correction, 2026-08-21**: `OwnerrezProperty`'s active-status field is `active`, not `is_active` — the original type guessed `is_active` from the general v2 doc description and was never checked against a real response, so it silently deserialized to `undefined` on every real property until a live Production credential check surfaced it. Confirmed against OwnerRez's own `active` query filter on this same `GET /properties` endpoint and the documented `active` field on the sibling `listing_sites` resource.

## Hard safety requirement (client-directed, 2026-08-15) — read this before adding any write path

OwnerRez remains **read-only** unless the client explicitly authorizes a specific write operation — this reinforces, not just repeats, the existing "confirmed production data" note above. `sync("OUTBOUND")` stays rejected. Do not implement any OwnerRez `POST`/`PUT`/`PATCH`/`DELETE` call (creating, updating, or cancelling a booking; editing a property) without that explicit authorization.

**Mapping rule**: the same explicit, human-confirmed mapping standard used for `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP` applies here — do not infer an OwnerRez `property_id` ↔ StayWhile `Property` correspondence from name/address similarity alone, even when it looks obvious.

**Before implementing any sync or write functionality here**: the exact proposed reads, the exact proposed property mappings, and the exact proposed writes must be shown to the client and explicitly approved first. Read-only discovery (what this README already documents) does not require that approval; anything that writes to OwnerRez, or writes StayWhile data derived from a guessed mapping, does.
