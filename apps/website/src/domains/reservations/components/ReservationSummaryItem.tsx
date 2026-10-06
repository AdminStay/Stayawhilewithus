import { Badge } from "@stayw/ui";

import {
  nightsLabel,
  RESERVATION_STATUS_TONE,
  reservationNights,
  reservationStatusLabel,
} from "../lib/reservation-summary";

import { OwnerRezLink } from "@/domains/integrations/components/OwnerRezLink";
import { ownerRezReservationUrl } from "@/domains/integrations/lib/ownerrez-links";

/**
 * One reservation in the dashboard's "Today's Check-ins & Check-outs"
 * summary (Phase 6): guest, status, property, nights and — for OwnerRez
 * bookings only — a link to the booking in OwnerRez. Display only: no
 * status control, no write, no OwnerRez call (OwnerRez stays read-only;
 * the link just opens OwnerRez in a new tab).
 */
export function ReservationSummaryItem({
  reservation: r,
}: {
  reservation: {
    status: string;
    source: string;
    externalReservationId: string;
    checkInDate: Date;
    checkOutDate: Date;
    property: { name: string } | null;
    primaryGuest: { firstName: string; lastName: string } | null;
  };
}) {
  const guest = r.primaryGuest
    ? `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`
    : "Guest";
  const bookingUrl = ownerRezReservationUrl(r);

  return (
    <li className="space-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{guest}</span>
        <Badge tone={RESERVATION_STATUS_TONE[r.status] ?? "neutral"}>
          {reservationStatusLabel(r.status)}
        </Badge>
      </div>
      <div className="text-xs text-ink-muted">
        <span>{r.property?.name ?? "Property"}</span>
        <span aria-hidden="true"> · </span>
        <span>
          {nightsLabel(reservationNights(r.checkInDate, r.checkOutDate))}
        </span>
        {bookingUrl && (
          <OwnerRezLink
            href={bookingUrl}
            label="Open in OwnerRez"
            title="Open this booking in OwnerRez"
          />
        )}
      </div>
    </li>
  );
}
