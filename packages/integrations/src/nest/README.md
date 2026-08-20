# Nest integration

Status: **real, read-only HTTP client** against Google's Smart Device Management (SDM) API — `connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`/`listDevices`/`sync("INBOUND")` all make real requests (OAuth 2.0 refresh-token flow, not a bearer/API-key). Only `receiveWebhook` is still a stub — Google's SDM Pub/Sub event shape is a separate design question, not a credential gap. **No write/command path exists yet** — `ExecuteCommand` (setpoint/mode/fan control) is a deliberate later phase, gated on a real per-device capability dump (see `HANDOFF.md`'s device-capability-audit section), not on anything missing from this client.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced).

## Real registration completed 2026-08-19 (see `HANDOFF.md` Increment 31)

- Consumer Google Account owns the registration.
- One-time US$5 Device Access registration fee: **paid**.
- Google Cloud project (`StayWhile Nest Integ`) with the SDM API enabled.
- OAuth 2.0 Web application client, consent screen scoped to `https://www.googleapis.com/auth/sdm.service`, `access_type=offline` (required for a refresh token).
- Device Access project created and linked to the OAuth client.
- Partner Connections Manager (PCM) three-legged consent flow completed by the Nest-owning account.

Credentials: `NEST_CLIENT_ID` + `NEST_CLIENT_SECRET` + `NEST_PROJECT_ID` + `NEST_REFRESH_TOKEN` (all four required — see `.env.example`). Present in `apps/website/.env.local` since 2026-08-19; **Vercel Production presence not yet confirmed** as of this note.

## What "real" means here, precisely

- `listDevices()` calls `GET /enterprises/{project}/devices` with a live-refreshed OAuth access token (cached in-memory per client instance, refreshed ~1 minute before its ~1-hour expiry).
- `parseNestDevice()` (exported from `client.ts`) only ever sets a field when the corresponding SDM trait is actually present in that specific device's response — a device missing e.g. `sdm.devices.traits.Humidity` gets `ambientHumidityPercent: undefined`, never a fabricated value. The full, unmodified trait map is also carried on `rawTraits` for future capability-flag computation.
- **The account's actual device/trait inventory is not yet durably known.** A prior one-off, uncommitted discovery script found 33 devices on 2026-08-19, but that result was never persisted (see `HANDOFF.md`) — this client replaces that stub, but a fresh, real, _persisted_ discovery run (via `discoverNestDevices()` in `apps/website`) is still needed before anything can be said about which traits StayWhile's real thermostats report.

## Mapping rule — same standard as every other provider

No `NEST_PROPERTY_MAP` env var, ever, and no name-based guessing of which StayWhile property a discovered thermostat belongs to. Discovered devices land in the `ProviderDevice` staging table (Discovered → Unmapped); an admin explicitly maps each one to a real `Property` from the dashboard before it becomes a live `SmartDevice`. See `apps/website/src/domains/smart-devices/services/provider-devices.service.ts`.
