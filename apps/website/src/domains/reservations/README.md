# Reservations domain

Status: implemented (list + create). Depends on Properties and Guests (both implemented).

- **Owned model(s)**: `Reservation`, `ReservationGuest`
- **Permission keys**: `reservations:read`, `reservations:create`, `reservations:update`, `reservations:delete`, `reservations:manage` (update/delete/manage not yet wired to UI)
- **Route**: `/reservations`
- **Manual bookings are `source = DIRECT`** with a generated `externalReservationId` (UUID) — the table's uniqueness key is `[source, externalReservationId]`, and every non-DIRECT source will get a real ID from its provider once OwnerRez/Airbnb sync exists.
- Creating a reservation also writes a `ReservationGuest` row (`isPrimary: true`) in the same transaction, keeping the many-to-many join in sync per the ERD's documented convention.
- **Not yet implemented**: multi-guest add/remove UI, check-in/check-out status transitions, cancellation, `triggerWorkflow` (no n8n workflow exists yet for `reservation.created` — same reasoning as the Guests domain).
