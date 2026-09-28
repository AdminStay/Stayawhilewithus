import type {
  OwnerRezNonGuestCounts,
  OwnerRezReservationSyncPlan,
} from "../services/ownerrez-reservation-sync.service";

/**
 * Operator-facing summary of a read-only OwnerRez sync preview (2026-09-28).
 * Pure — computed from the plan previewOwnerRezReservationSync() already
 * returns, so the page receives a small summary instead of every booking.
 */
export interface OwnerRezPreviewSummary {
  /** Bookings OwnerRez returned (recent changes ∪ stays departing yesterday or later). */
  bookingsEvaluated: number;
  /** Real guest bookings on linked properties with a recognized status — what a sync would write (create + update). */
  eligibleGuestBookings: number;
  toCreate: number;
  /** Already in StayWhile; a sync refreshes them (unchanged vs changed is not computed). */
  toUpdate: number;
  /** Of the bookings a sync would write: by OwnerRez status. */
  writable: { active: number; cancelled: number; other: number };
  /** Of the bookings a sync would write: departing today or later (in-house + upcoming). */
  currentOrUpcoming: number;
  unmatchedPropertyBookings: number;
  unrecognizedStatusBookings: number;
  /** Records that are not guest reservations (blocked-off time, holds, owner stays, unknown type), by kind — never imported. */
  nonGuest: OwnerRezNonGuestCounts;
  nonGuestTotal: number;
  /** OwnerRez properties with bookings but no linked StayWhile property (by OwnerRez id only — no guessing). */
  unmatchedProperties: Array<{
    ownerRezPropertyId: number;
    bookings: number;
    nextArrival: string | null;
  }>;
  unrecognizedStatuses: Array<{ status: string; bookings: number }>;
}

export function summarizeOwnerRezPreview(
  plan: OwnerRezReservationSyncPlan,
  now: Date,
): OwnerRezPreviewSummary {
  const writable = [...plan.toCreate, ...plan.toUpdate];
  const today = now.toISOString().slice(0, 10);

  const byStatus = { active: 0, cancelled: 0, other: 0 };
  for (const item of writable) {
    const status = item.status.toLowerCase();
    if (status === "active") byStatus.active++;
    else if (status === "canceled" || status === "cancelled")
      byStatus.cancelled++;
    else byStatus.other++;
  }

  const unmatched = new Map<
    number,
    { bookings: number; next: string | null }
  >();
  for (const item of plan.unmatchedProperty) {
    const entry = unmatched.get(item.ownerRezPropertyId) ?? {
      bookings: 0,
      next: null,
    };
    entry.bookings++;
    if (
      item.departure.slice(0, 10) >= today &&
      (entry.next === null || item.arrival < entry.next)
    ) {
      entry.next = item.arrival;
    }
    unmatched.set(item.ownerRezPropertyId, entry);
  }

  const nonGuest: OwnerRezNonGuestCounts = {
    block: 0,
    quote_hold: 0,
    linked_availability: 0,
    owner: 0,
    unknown: 0,
  };
  for (const item of plan.nonGuest) nonGuest[item.kind]++;

  const statuses = new Map<string, number>();
  for (const item of plan.unrecognizedStatus) {
    statuses.set(item.status, (statuses.get(item.status) ?? 0) + 1);
  }

  return {
    bookingsEvaluated: plan.totalFetched,
    eligibleGuestBookings: writable.length,
    toCreate: plan.toCreate.length,
    toUpdate: plan.toUpdate.length,
    writable: byStatus,
    currentOrUpcoming: writable.filter(
      (item) => item.departure.slice(0, 10) >= today,
    ).length,
    unmatchedPropertyBookings: plan.unmatchedProperty.length,
    unrecognizedStatusBookings: plan.unrecognizedStatus.length,
    nonGuest,
    nonGuestTotal: plan.nonGuest.length,
    unmatchedProperties: [...unmatched.entries()]
      .map(([ownerRezPropertyId, v]) => ({
        ownerRezPropertyId,
        bookings: v.bookings,
        nextArrival: v.next,
      }))
      .sort(
        (a, b) =>
          b.bookings - a.bookings ||
          a.ownerRezPropertyId - b.ownerRezPropertyId,
      ),
    unrecognizedStatuses: [...statuses.entries()]
      .map(([status, bookings]) => ({ status, bookings }))
      .sort((a, b) => b.bookings - a.bookings),
  };
}
