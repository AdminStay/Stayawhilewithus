# OwnerRez integration

Status: real HTTP client against the v2 API — `connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`/`listProperties`/`listBookings`/`getGuest`/`sync("INBOUND")` all make real requests via `HttpClient` (Basic Auth: `username` + API `token`, not a bearer token). Only `receiveWebhook` is still a stub — OwnerRez's webhook payload shape is an open design question (see `INTEGRATION_INVENTORY.md`), not a credential gap.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself; the caller (e.g. a future domain-level sync job) does.

**`sync("INBOUND")` deliberately does not write to StayWhile's database.** It fetches real bookings from OwnerRez and reports how many it found. OwnerRez is confirmed **production data** (see `HANDOFF.md`) — mapping bookings into `Reservation`/`Guest` rows needs its own identity-matching/dedupe design and explicit write authorization, not just an API token, so that's intentionally left as a separate follow-up rather than bundled into this client. `sync("OUTBOUND")` rejects outright — OwnerRez is the system of record for its own bookings; StayWhile never pushes changes back to it.

Credentials: `OWNERREZ_USERNAME` + `OWNERREZ_API_TOKEN` (both required for Basic Auth — see `.env.example`). Neither is set anywhere in this repo yet; every method above is real code that has never been run against a live account.
