# Properties domain

Owns the `Property` model (see `packages/database/prisma/schema.prisma`).

- **Services**: `services/properties.service.ts` — `listProperties`, `createProperty`.
- **Schemas**: `schemas/properties.schema.ts` — `createPropertySchema`.
- **Components**: `components/PropertyList.tsx`, `components/CreatePropertyForm.tsx`.
- **Actions**: `actions.ts` — `createPropertyAction` (Server Action).
- **Permissions**: `properties:read`, `properties:create`.
- **Route**: `/properties` (`apps/website/app/(dashboard)/properties/page.tsx`, thin — composes this domain's components).

Reference implementation for the domain-folder pattern — see `03 Documentation/adr/0006-domain-driven-folder-structure.md`.
