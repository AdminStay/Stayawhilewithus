# Gmail integration

Status: not implemented (structural stub only). **Deliberately still a stub as of 2026-08-07**, not just unwired: Gmail requires a full OAuth2 flow (consent screen, refresh-token storage — neither exists in this repo's env vars or schema yet), and registering that OAuth app means logging into an external Google account/console, which puts real implementation outside what can be built as a gated adapter the way OwnerRez/Slack/Notion/Asana were this session.

Capabilities: webhook, messaging.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once implemented (convention, not schema-enforced).
