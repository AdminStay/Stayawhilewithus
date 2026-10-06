import type { Tone } from "@stayw/ui";

import {
  calendarDay,
  DEFAULT_RESERVATION_VIEW,
  reservationViewHref,
} from "./reservation-views";

/**
 * Display helpers for the dashboard reservation summary (Phase 6). Pure and
 * read-only — no query, no OwnerRez call, no write.
 */

/** Same tones as /reservations' ReservationList. */
export const RESERVATION_STATUS_TONE: Record<string, Tone> = {
  PENDING: "gold",
  CONFIRMED: "info",
  CHECKED_IN: "success",
  CHECKED_OUT: "neutral",
  CANCELLED: "error",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nights between check-in and check-out. Both are @db.Date values (midnight
 * UTC), so the calendar days are compared in UTC — never shifted by the
 * server's timezone. Never negative.
 */
export function reservationNights(
  checkInDate: Date,
  checkOutDate: Date,
): number {
  const nights = Math.round(
    (Date.parse(`${calendarDay(checkOutDate)}T00:00:00Z`) -
      Date.parse(`${calendarDay(checkInDate)}T00:00:00Z`)) /
      DAY_MS,
  );
  return Math.max(0, nights);
}

export function nightsLabel(nights: number): string {
  return nights === 1 ? "1 night" : `${nights} nights`;
}

/** "View all" from the dashboard → /reservations' Today view (no filters). */
export const TODAY_RESERVATIONS_HREF = reservationViewHref({
  view: DEFAULT_RESERVATION_VIEW,
  propertyId: null,
  includeCancelled: false,
  page: 1,
});
