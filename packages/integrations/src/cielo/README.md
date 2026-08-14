# Cielo integration

Status: implemented (real login + device status). `CieloClient` (`./client.ts`) makes real HTTP calls — see "What was verified" below for exactly what that's grounded in.

## What was verified (2026-08-12, corrected from an earlier assessment)

An earlier pass on this integration concluded Cielo had **two separate, incompatible** products/APIs — a newer "Breez Edge"/API-key system, and an older `api.smartcielo.com` session-based system used only by the "MRCOOL SmartHVAC" app — and that we'd need to ask the client which one their hardware used before writing any code. Re-researching this by reading the **current** (2025-maintained) source of [`bodyscape/cielo_home`](https://github.com/bodyscape/cielo_home) — not just its README — shows that earlier conclusion was wrong:

- The integration is explicitly named **"Cielo Home / Mr Cool devices integration"** — one codebase, one login flow, serving both brand names.
- Its account web portal is `home.cielowigle.com` ("Cielo Home" branding); its API base is `api.smartcielo.com`.
- Login is just **email + password** (SHA-256-hashed client-side, matching what the official apps do) against `api.smartcielo.com/user/smarthvac/login/1` — no API key to generate/paste, no separate "Breez Edge" flow found anywhere in the current source.
- The login request uses the MRCOOL app's identity (`MRCOOL SmartHVAC/4.3.0` user-agent + its app key) specifically because that's the endpoint confirmed not to require a reCAPTCHA — that's an implementation detail of _how_ to call the API, not evidence of a second product line.
- Device status comes from `GET /web/devices` — each device reports `deviceStatus` (`1`/`"on"` = reachable) and `macAddress` (stable unique ID) — verified against `CieloHomeDevice.get_status()` in the source. This is a plain REST endpoint, polled on demand — no WebSocket needed for a "what's the status right now" read.

There's no remaining evidence of a second, incompatible Cielo API. `CieloClient` implements this one verified path.

## Given that, is there still anything to double-check?

Yes, but it's a real check, not a guess: **the client should confirm they can log into https://home.cielowigle.com/ with their Cielo account email and password.** If that login works, `CieloClient` applies directly. This is worth confirming rather than assuming, because Cielo WiGle Inc. does own more than one product line and this research is against a third-party integration, not Cielo's own documentation (which doesn't publicly exist).

`CieloCredentials` (`./types.ts`) — `username`/`password`. Same shape as before; unchanged by this correction.

**Verify `CIELO_USERNAME`/`CIELO_PASSWORD` actually work** with a real, read-only connectivity check (logs in, lists devices, reports online/offline — never controls anything, never prints the password):

```
pnpm --filter @stayw/integrations exec tsx src/cielo/scripts/check.ts
```

Capabilities: sync, webhook (webhook remains unimplemented — Cielo's webhook payload shape, if any exists, hasn't been researched; that's a real open question, not a credential gap).

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). `sync()` is read-only and does not write to StayWhile's database — `apps/website/src/domains/smart-devices/services/smart-devices.service.ts`'s `syncCieloDevices()` does the actual `SmartDevice` upsert, using `CieloClient.listDevices()` directly (not `sync()`, which only reports a count, mirroring `OwnerrezClient`'s same split).

## What was previously a blocker and no longer is

The earlier version of this README flagged a real-time WebSocket architecture problem: `wss.smartcielo.com` push updates don't fit this app's serverless request/response model. That's still true if StayWhile ever wants live push updates — but it doesn't block what StayWhile actually needs today (dashboard status that refreshes on a "Sync now" click or a periodic job), since `GET /web/devices` is a normal polled REST call.

## Property assignment

Cielo's device-list response has no property/house grouping field (verified — `GET /web/devices` returns device name + MAC address + status, nothing location-related). `syncCieloDevices()` maps each device's `macAddress` to a StayWhile property via the `CIELO_PROPERTY_MAP` env var (JSON: `{"<macAddress>": "<propertyId>"}`) — see `.env.example`. A device whose MAC address isn't in that map is skipped (not guessed at) and reported back to the caller.
