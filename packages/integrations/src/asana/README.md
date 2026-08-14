# Asana integration

Status: real HTTP client against the Asana API — `connect`/`healthCheck`/`validateCredentials` all call `/users/me`; `sync("INBOUND")` calls `/workspaces` and reports how many the token can see. `receiveWebhook` is still a stub.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself.

**`sync` deliberately does not write anything** — same reasoning as Notion: no single "list everything relevant" endpoint, and which workspace/project should map to `Task.asanaTaskId` isn't decided yet. `sync("OUTBOUND")` rejects outright.

**`receiveWebhook` genuinely can't be implemented yet, not just unwired**: Asana webhook secrets are per-webhook (delivered via `X-Hook-Secret` on the registration handshake), not a single static account secret like Slack's — there's nowhere to store/retrieve that secret until a webhook-registration flow exists.

Credentials: `ASANA_ACCESS_TOKEN` (Bearer auth, personal access token) — see `.env.example`. Not set anywhere in this repo yet; every method above is real code that has never been run against a live Asana account.
