/**
 * "Open in OwnerRez" links (Meeting #6). The ONLY place OwnerRez web URLs
 * are built. Both patterns come from real links Michelle supplied
 * (2026-10-03) — nothing here is guessed:
 *
 *   booking:  https://secure.ownerreservations.com/bookings/19458918
 *   property: https://app.ownerrez.com/properties/386471/info
 *
 * Navigation only: these are plain links; nothing calls OwnerRez's API.
 * An id that isn't a positive whole number (e.g. a DIRECT reservation's
 * generated UUID, an empty value, "0") gets no link at all rather than a
 * malformed one.
 */

const OWNERREZ_BOOKING_URL_PREFIX =
  "https://secure.ownerreservations.com/bookings/";
const OWNERREZ_PROPERTY_URL_PREFIX = "https://app.ownerrez.com/properties/";
const OWNERREZ_PROPERTY_URL_SUFFIX = "/info";

/** A positive whole-number OwnerRez id as a string, or null. */
function ownerRezId(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const value = String(id).trim();
  return /^[1-9]\d*$/.test(value) ? value : null;
}

export function ownerRezBookingUrl(
  bookingId: string | number | null | undefined,
): string | null {
  const id = ownerRezId(bookingId);
  return id ? `${OWNERREZ_BOOKING_URL_PREFIX}${id}` : null;
}

export function ownerRezPropertyUrl(
  propertyId: string | number | null | undefined,
): string | null {
  const id = ownerRezId(propertyId);
  return id
    ? `${OWNERREZ_PROPERTY_URL_PREFIX}${id}${OWNERREZ_PROPERTY_URL_SUFFIX}`
    : null;
}

/**
 * The booking link for a StayWhile reservation — only when it came from
 * OwnerRez (`source === "OWNERREZ"`), whose externalReservationId IS the
 * OwnerRez booking id. Other sources never get an OwnerRez link.
 */
export function ownerRezReservationUrl(reservation: {
  source: string;
  externalReservationId: string;
}): string | null {
  return reservation.source === "OWNERREZ"
    ? ownerRezBookingUrl(reservation.externalReservationId)
    : null;
}
