# Notion integration

Status: real HTTP client against the Notion API — `connect`/`healthCheck`/`validateCredentials` all call `/users/me`; `sync("INBOUND")` calls `/search` and reports how many pages/databases the integration token can see.

Capabilities: sync.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once wired into a caller (convention, not schema-enforced) — this package doesn't write that row itself.

**`sync` deliberately does not write anything.** Notion has no single "list everything relevant" endpoint the way OwnerRez has `/bookings` — which pages/databases a StayWhile sync should target, and what StayWhile record they'd map to (`Property.notionPageId` already exists in the schema as a likely target), is a design decision that hasn't been made yet. `sync("OUTBOUND")` rejects outright for the same reason.

Credentials: `NOTION_API_KEY` (Bearer auth, internal integration token) — see `.env.example`. Not set anywhere in this repo yet; every method above is real code that has never been run against a live Notion workspace.
