# Communications domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `MessageThread`, `Message`
- **Permission keys**: `messages:read`, `messages:create`, `messages:update`, `messages:delete`, `messages:manage`
- **Expected shape when implemented**: `services/communications.service.ts`, `schemas/communications.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Folder name intentionally differs from the permission resource name (`messages`, not `communications`) — the resource name matches the owned model, the folder name matches the user-facing feature area.
