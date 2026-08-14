# August integration

Status: implemented (real lock status). `AugustClient` (`./client.ts`) makes real HTTP calls against `api-production.august.com` — the endpoints, headers, and response shapes are ported directly from [`Yale-Libs/yalexs`](https://github.com/Yale-Libs/yalexs) (the actively-maintained fork Home Assistant's official August integration now runs on), verified by reading its source (`yalexs/api_common.py`, `yalexs/const.py`, `yalexs/lock.py`), not guessed.

**2026-08-14 correction**: this integration was originally ported from `snjoetw/py-august`, which hasn't been pushed to since 2022-01-31. August rotated their app-identification values (the `x-august-api-key` value and the client `User-Agent`) server-side at some point since then, and started requiring an `x-august-branding`/`x-august-country` header pair that `py-august` never sent — real login attempts were failing with a bare `404 Not Found` on `/session` as a result, not a credentials problem. Re-ported against `yalexs` (last pushed 2026-08-10) fixes this: current API key, current User-Agent, the two added headers, and a `smsHashString` field on phone-based verification-code requests that was previously missing. If a 404 recurs in the future, `yalexs` rotating its constants again is the first thing to check before assuming credentials are wrong.

**2026-08-14, same day, second finding**: after the 404 fix above, two real accounts both got `403 Forbidden` instead. `yalexs/const.py` defines two brand configs — `august` and `yale_access` — that share the exact same host, API key, and every other header; the **only** difference is the `x-august-branding` header value (`"august"` vs `"yale"`). Accounts originally created under the August brand have in some cases been migrated server-side (by Yale) to Yale Access branding without the account holder doing anything, and there's no way to know in advance which one a given account now needs. `scripts/login.ts` now tries both automatically against the same entered password (no re-prompting, no extra credential exposure) and persists whichever one worked as `AUGUST_BRAND` in `.env.local`; `AugustClient`/`check.ts`/`syncAugustDevices()` all read it back. If both brands still 403, that's a real credentials/account problem, not a code gap — the two most likely explanations at that point are a genuinely wrong password, or the account being enrolled through an employer/property-management SSO flow that this direct-login endpoint doesn't support at all (would need August/Yale support to confirm).

**2026-08-14, same day, third finding**: both brands above then failed identically with a _definitive_ body, not just a status code: `{"code":"Forbidden","message":"API key is not valid"}`. That exact error text is independently reported by real users in `github.com/Yale-Libs/yalexs` issues [#99](https://github.com/Yale-Libs/yalexs/issues/99) and [#150](https://github.com/Yale-Libs/yalexs/issues/150), confirmed there to come specifically from an API-key/host mismatch (a maintainer in #99 verified it only appears "when having an invalid X-August-Api-Key"). `yalexs/const.py` actually defines **four** brands, not two — `august` and `yale_access` share one API key and host, but `yale_august` and `yale_global` each have their **own** API key, and `yale_global` uses an entirely different host (`api.aaecosystem.com`, not `api-production.august.com`) and different header names (`x-api-key`/`x-access-token`/`x-branding` instead of the `x-august-*` names). The original fix only tried the first two. All four are now defined once, in `../types.ts`'s `AUGUST_BRAND_CONFIGS` (shared by `client.ts` and `scripts/login.ts` so the two can't drift apart), and `login.ts` tries all four in order, persisting whichever one actually works as `AUGUST_BRAND`. `yale_august`/`yale_global` are flagged in yalexs's own `Brand` enum as normally requiring OAuth (a different login flow than the plain password one this script implements) — trying the plain flow against them first is still the correct, lowest-risk diagnostic step (same account, same single password entry), but if all four brands are exhausted and still rejected, that's a genuine sign the account may need the OAuth-based Yale Home app flow, which this integration does not implement.

## The one-time interactive step

August has no official public developer API. Its auth model is genuinely not a static API key:

1. First login needs `identifier` (email or phone) + `password`, and then a **human enters a 6-digit verification code** sent to that email/phone. This is a real interactive step — nothing server-side can complete it unattended.
2. That login produces an `installId` and an `accessToken`. Reusing the same `installId` on later logins skips the verification-code step (August's server remembers that install has already been validated).
3. `accessToken` isn't indefinitely long-lived — expect to need periodic re-login (with the same `installId`) to refresh it.

**Run this step yourself, locally — never through a chat with anyone, including an AI assistant:**

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts
```

(`packages/integrations/src/august/scripts/login.ts`.) It asks for your August email/phone and password (password input is masked, never echoed or logged), sends the request, and — if this is the first login for this install — prompts for the 6-digit code August just texted/emailed you. On success it writes `AUGUST_IDENTIFIER`, `AUGUST_INSTALL_ID`, and `AUGUST_ACCESS_TOKEN` directly into `apps/website/.env.local`. It never prints the access token back out — only confirms it was written. When the token eventually expires, just re-run the same script; the saved `installId` means you won't be asked for the verification code again.

`AugustCredentials` (`./types.ts`) models the result of that flow — `identifier` + `installId` + `accessToken`, not a single static key.

**After running the login script, verify it actually worked** with a real, read-only connectivity check (validates credentials, lists locks, fetches each lock's battery/online status — never locks/unlocks anything, never prints the token):

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts
```

## What `AugustClient` does with those values

Once `AUGUST_ACCESS_TOKEN` is set, `AugustClient` is a normal read-only REST client:

- `listLocks()` — `GET /users/locks/mine`, every lock the account can see.
- `getLockDetail(lockId)` — `GET /locks/{lockId}` — battery (`battery`, a 0–1 fraction in the raw response, converted to 0–100 here) and connectivity. Connectivity comes from the lock's WiFi **Bridge/Connect hub** status (py-august's `bridge_is_online`), _not_ locked/unlocked state — StayWhile only needs "is this lock reachable," not remote lock control, so lock/unlock endpoints are deliberately not implemented here.

`apps/website/src/domains/smart-devices/services/smart-devices.service.ts`'s `syncAugustDevices()` calls these directly (not `sync()`, which only reports a count — same split as `OwnerrezClient`) and upserts into `SmartDevice`.

## Property assignment

August's lock-list/detail responses include a `HouseID`, but there's no verified, reliable way to turn that into a human-readable house name or address — `py-august`'s `get_houses()` call is not correctly wired in the library itself (missing URL in its own request builder), and the alternate `get_house(house_id)` endpoint's response shape isn't documented or exercised anywhere in the library. Rather than guess at an unverified endpoint, `syncAugustDevices()` maps each lock's `houseId` to a StayWhile property via the `AUGUST_PROPERTY_MAP` env var (JSON: `{"<houseId>": "<propertyId>"}`) — see `.env.example`. A lock whose house ID isn't in that map is skipped (not guessed at) and reported back to the caller; run a sync once to see the house IDs your locks actually have, then fill in the mapping.

Capabilities: sync, webhook (webhook remains unimplemented — no August webhook payload shape has been researched).

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`).
