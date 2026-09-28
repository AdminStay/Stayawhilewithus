# Nest integration

Status (updated 2026-09-27, Nest Phase 1): a **real** HTTP client for Google's Smart Device Management (SDM) API, with read paths and a guarded command path. **Production Nest access is currently broken** (see "Current authorization limitation"). **No physical command has ever been sent to a real thermostat.**

Implements `BaseIntegrationClient` from `@stayw/integrations/core` (see `03 Documentation/adr/0008-integration-sdk.md`). Only `receiveWebhook` is still a stub (SDM Pub/Sub events are a separate design question).

## Credentials (names only)

`NEST_CLIENT_ID`, `NEST_CLIENT_SECRET`, `NEST_PROJECT_ID`, `NEST_REFRESH_TOKEN`: all four required, read from the server environment (see `.env.example`). This is **one Google account** under one Device Access project. Multiple accounts are not supported yet (planned Phase 2: one Device Access project, one refresh token per Google account).

Google-side setup (2026-08-19): consumer Google account; US$5 Device Access registration; Google Cloud project `StayWhile Nest Integ` with the SDM API; OAuth 2.0 web client (`sdm.service` scope, `access_type=offline`); Device Access project in the **Sandbox** tier (5-structure cap; 4 in use); Partner Connections Manager (PCM) consent by the Nest-owning account.

## What the client does

- **OAuth:** refresh-token grant against `oauth2.googleapis.com/token`; the access token is kept in memory per client instance and refreshed ~1 minute before expiry. A failed refresh throws `NestOAuthRefreshError`, whose `.message` is generic and whose `.diagnostic` holds only Google's standard `error`/`error_description` plus presence/whitespace flags (never a credential value).
- **Reads:** `listDevices()` (`GET /enterprises/{project}/devices`) and `getDevice(id)`. `parseNestDevice()` only sets a field when that trait is actually present; the full trait map is kept on `rawTraits`.
- **Commands** (`sdm.devices.commands.*` via `:executeCommand`): `setHeatSetpoint`, `setCoolSetpoint`, `setHeatCoolRange`, `setThermostatMode`, `setFanTimer`. `validateNestCommand()` + `computeNestDeviceCapabilities()` check a command against a device's real traits (including Eco mode and heat < cool).

## How the app uses it (`apps/website/src/domains/smart-devices`)

- **Discovery** (`discoverNestDevices()`, `provider-devices.service.ts`): automatic. Every device Google returns is upserted into the `ProviderDevice` staging table as discovered/unmapped/disabled. No hard-coded device list.
- **Mapping:** an admin explicitly maps each discovered thermostat to a real `Property` and enables it from the dashboard, which creates its `SmartDevice`. No `NEST_PROPERTY_MAP` env var, ever, and no name-based guessing. Unmapped is safer than a wrong mapping.
- **Refresh** (`refreshNestTelemetry()`, `thermostat-refresh.service.ts`): the manual Refresh on `/thermostats`. One bulk `listDevices()` call; updates only enabled + mapped rows; never creates, maps or deletes anything, and never calls a command. **Every attempt is recorded** as an `IntegrationSyncLog` row (`entityType: "NestTelemetryRefresh"`) with a fixed, sanitized result: `SUCCEEDED`, or `FAILED` with `NEST_AUTH_EXPIRED` (Google `invalid_grant`), `NEST_PROVIDER_ERROR` (+ HTTP status), `NEST_NOT_CONFIGURED` or `NEST_REFRESH_FAILED`. No token, credential, Google error text or request path is ever stored.
- **Freshness on `/thermostats`:** a Nest health banner (needs reauthorization / last refresh failed / readings stale) with last successful refresh, last attempted refresh and newest reading time; each row older than 24 h shows "Stale reading". Old telemetry is never presented as current.
- **Commands** (`sendNestThermostatCommand()`, `nest-commands.service.ts`), in order:
  1. mapping chain (mapped, enabled, live property);
  2. property-scoped `thermostats:manage` RBAC;
  3. **global kill switch**;
  4. per-device duplicate-command lock;
  5. a fresh capability read from Google;
  6. the command;
  7. a confirming read;
  8. audit on every outcome.

## Physical-command safety — kill switch (default OFF)

`thermostat-control-settings.service.ts` stores `thermostatControl.enabled` on the Nest `IntegrationConnection.metadata` (no migration). **Only an explicit `true` turns it on**; a missing value, a missing connection or anything else means OFF, so existing admins get no live controls when this ships.

- While OFF, `sendNestThermostatCommand()` refuses every command right after RBAC: before the duplicate-command lock, before a `NestClient` is created, and before any Google request (capability read or command). The refusal is audit-logged as `REJECTED`.
- While OFF, `/thermostats` shows "Remote control is OFF" instead of any control.
- Toggling needs a **global** `thermostats:manage` grant (admin only), asks for confirmation and is audit-logged (`nest.thermostat_control.set_enabled`).
- This switch is independent of the August lock kill switch.

## Current authorization limitation (Production)

- Since 2026-09-10 every Nest refresh fails: Google returns `invalid_grant` ("Token has been expired or revoked") for `NEST_REFRESH_TOKEN`, so no Nest data, discovery or command can succeed.
- Likely trigger: the OAuth consent screen is in **Testing** status (7-day refresh-token lifetime).
- Re-consent is blocked:
  - generic OAuth consent gives a token with 0 devices (device access comes only via PCM);
  - PCM consent fails with "Can't link to StayWhile Nest Integ".
- Escalated as Google Device Access Issue 561849351.
- **Until it's resolved:** no OAuth/PCM retries, no unlinking/removing access, no replacing the Production token, no Production Nest refresh/discovery, no mapping changes, no commands.
- **Restoration order afterwards:** reconnect → full inventory → reconcile counts/mappings → verify telemetry → OAuth "In production" → automatic refresh → manual refresh → only then a first controlled command with explicit approval.
