# Nest integration

Status: not implemented (structural stub only). **Deliberately still a stub as of 2026-08-07**: modern Nest integration goes through Google's Smart Device Management (SDM) API, which requires registering a project in the Device Access Console — a **mandatory paid ($5) one-time registration fee**. That's a real-money action this session isn't authorized to take, not a missing API key.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once implemented (convention, not schema-enforced).
