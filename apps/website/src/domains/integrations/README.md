# Integrations domain

Status: implemented — connection status catalog + disconnect, `/integrations` route.

- **Owned model(s)**: `IntegrationConnection`, `IntegrationSyncLog`
- **Permission keys**: `integrations:read`, `integrations:create`, `integrations:update`, `integrations:delete`, `integrations:manage`
- **Shape**: `services/integrations.service.ts` (`listIntegrationConnections`, `disconnectIntegration`), `schemas/integrations.schema.ts`, `components/IntegrationConnectionList.tsx`, `actions.ts`.

**Domain vs. package split**: `packages/integrations` (`@stayw/integrations`) is the reusable _capability_ — provider clients implementing the common SDK interface, no permission checks of its own. This domain owns the business-facing _feature_ built on top: the connection-management UI, with its own `assertPermission` calls. See `03 Documentation/adr/0008-integration-sdk.md`.

**`listIntegrationConnections` idempotently upserts a row for every `IntegrationProvider`** (12 providers) so the page always shows the full catalog, not just whatever happened to have a row — there was no seed data for this table before. Every row starts `DISCONNECTED`; nothing in this domain makes an outbound network call to any provider (no "test connection" button) — doing so with no real credential configured would mean making an unauthenticated request to a live third-party API, which stays out of scope here on purpose. `disconnectIntegration` only ever touches StayWhile's own database (every real client's own `disconnect()` is already a no-op — none hold a server-side session to tear down).

**`client: real` / `client: stub` badge**: surfaces `packages/integrations`' `PROVIDER_CLIENT_STATUS` map directly in the UI — OwnerRez, Slack, Notion, and Asana have real HTTP-calling clients as of 2026-08-07; the other 8 are still structural stubs (see each provider's own package README for exactly why — OAuth design gaps, a paid Nest registration, no public Google Voice API, or physical-device-safety caution for the smart-lock/HVAC vendors).
