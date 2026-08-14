# Yale integration

Status: not implemented (structural stub only). **Deliberately still a stub as of 2026-08-07**: Yale is a physical door lock — an incorrect lock/unlock API call is a real-world safety issue, not just a data bug. Yale/August merged their apps (Yale Home) and the current API surface isn't something this session had high enough confidence to implement correctly from memory. Needs verified, current API docs (or a real test account to validate against) before writing real lock-control code, not just an API key.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once implemented (convention, not schema-enforced).
