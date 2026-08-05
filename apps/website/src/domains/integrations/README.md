# Integrations domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `IntegrationConnection`, `IntegrationSyncLog`
- **Permission keys**: `integrations:read`, `integrations:create`, `integrations:update`, `integrations:delete`, `integrations:manage`
- **Expected shape when implemented**: `services/integrations.service.ts`, `schemas/integrations.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

**Domain vs. package split**: `packages/integrations` (`@stayw/integrations`) is the reusable _capability_ — provider clients implementing the common SDK interface, no permission checks of its own. This domain owns the business-facing _feature_ built on top: the connection-management UI (connect/disconnect a provider, view sync history), with its own `assertPermission` calls. See `03 Documentation/adr/0008-integration-sdk.md`.
