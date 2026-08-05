# Smart Devices domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `SmartDevice`, `SmartDeviceEvent`
- **Permission keys**: `smart_devices:read`, `smart_devices:create`, `smart_devices:update`, `smart_devices:delete`, `smart_devices:manage`
- **Expected shape when implemented**: `services/smart-devices.service.ts`, `schemas/smart-devices.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Business feature (device status dashboard, event history) built over `@stayw/integrations`'s smart-lock/thermostat provider clients (see `03 Documentation/adr/0008-integration-sdk.md`).
