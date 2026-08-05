# Reservations domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `Reservation`, `ReservationGuest`
- **Permission keys**: `reservations:read`, `reservations:create`, `reservations:update`, `reservations:delete`, `reservations:manage`
- **Expected shape when implemented**: `services/reservations.service.ts`, `schemas/reservations.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).
