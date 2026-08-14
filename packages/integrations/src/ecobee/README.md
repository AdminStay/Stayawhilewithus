# Ecobee integration

Status: not implemented (structural stub only). **Deliberately still a stub as of 2026-08-07**: Ecobee auth is a PIN-based OAuth2 flow (authorize → PIN → poll for token → refresh), not a static API key — the current `EcobeeCredentials` shape (`apiKey`) doesn't match what real implementation needs, and there's no token-storage/refresh design yet. Same complexity class as Gmail; needs that design decision before real code, not just a credential.

Capabilities: sync, webhook.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once implemented (convention, not schema-enforced).
