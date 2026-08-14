# Slack integration

Status: real HTTP client against the Slack Web API — `connect`/`healthCheck`/`validateCredentials` all call `auth.test`; `sendMessage` calls `chat.postMessage`; `receiveWebhook` verifies Slack's own `v0=` HMAC signature scheme (see `verify-signature.ts` — different from the generic HMAC verifier in `../core/webhook-signature.ts`, which Slack doesn't use).

Capabilities: webhook, messaging.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself.

Credentials: `SLACK_BOT_TOKEN` (Bearer auth) + `SLACK_SIGNING_SECRET` (webhook verification) — see `.env.example`. Neither is set anywhere in this repo yet; every method above is real code that has never been run against a live Slack workspace.
