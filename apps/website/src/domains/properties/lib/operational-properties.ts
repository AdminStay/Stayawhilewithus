/**
 * Which properties appear in operational views (reservations, the dashboard
 * home's arrivals/departures/in-house) — Meeting #6 decision, 2026-10-02.
 *
 * ACTIVE and ONBOARDING are both operational: in Production most live,
 * booked properties are still ONBOARDING (31 of 39 on 2026-10-02, every one
 * with upcoming reservations), so hiding ONBOARDING would hide real guests.
 * INACTIVE, OFFBOARDED and soft-deleted properties are excluded.
 *
 * A view rule only: Property.status is never changed by it.
 */
export const OPERATIONAL_PROPERTY_STATUSES = ["ACTIVE", "ONBOARDING"] as const;

export function isOperationalProperty(property: {
  status: string;
  deletedAt?: Date | null;
}): boolean {
  return (
    !property.deletedAt &&
    (OPERATIONAL_PROPERTY_STATUSES as readonly string[]).includes(
      property.status,
    )
  );
}

/** The same rule as a Prisma `Property` filter (structural, no runtime import). */
export const OPERATIONAL_PROPERTY_WHERE = {
  deletedAt: null,
  status: { in: [...OPERATIONAL_PROPERTY_STATUSES] },
} as const;
