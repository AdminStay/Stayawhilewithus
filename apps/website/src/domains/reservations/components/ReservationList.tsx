import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { CalendarRange } from "lucide-react";

import { updateReservationStatusAction } from "../actions";
import {
  formatReservationDate,
  nightsLabel,
  RESERVATION_STATUS_TONE,
  reservationNights,
  reservationStatusLabel,
} from "../lib/reservation-summary";
import type { Reservation } from "../services/reservations.service";

import { OwnerRezLink } from "@/domains/integrations/components/OwnerRezLink";
import {
  ownerRezPropertyUrl,
  ownerRezReservationUrl,
} from "@/domains/integrations/lib/ownerrez-links";

type ReservationWithRelations = Reservation & {
  property: { name: string; ownerRezPropertyId?: string | null };
  primaryGuest: { firstName: string; lastName: string };
};

const STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
] as const;

export function ReservationList({
  reservations,
  emptyTitle = "No reservations yet",
  emptyDescription = "Create your first reservation to get started.",
}: {
  reservations: ReservationWithRelations[];
  /** Empty-state copy — /reservations passes view-specific text (2026-09-29). */
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (reservations.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={CalendarRange}
          title={emptyTitle}
          description={emptyDescription}
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Property</TableHeaderCell>
        <TableHeaderCell>Guest</TableHeaderCell>
        <TableHeaderCell>Dates</TableHeaderCell>
        <TableHeaderCell>Nights</TableHeaderCell>
        <TableHeaderCell className="text-right">Status</TableHeaderCell>
      </TableHead>
      <TableBody>
        {reservations.map((r) => {
          const bookingUrl = ownerRezReservationUrl(r);
          const statusBadge = (
            <Badge tone={RESERVATION_STATUS_TONE[r.status] ?? "neutral"}>
              {reservationStatusLabel(r.status)}
            </Badge>
          );
          return (
            <TableRow key={r.id}>
              <TableCell className="font-medium text-ink">
                {r.property.name}
                {ownerRezPropertyUrl(r.property.ownerRezPropertyId) && (
                  <OwnerRezLink
                    href={ownerRezPropertyUrl(r.property.ownerRezPropertyId)!}
                    label="OwnerRez"
                    title={`Open ${r.property.name} in OwnerRez`}
                  />
                )}
              </TableCell>
              <TableCell className="text-ink-muted">
                {r.primaryGuest.firstName} {r.primaryGuest.lastName}
              </TableCell>
              <TableCell className="whitespace-nowrap text-ink-muted">
                {formatReservationDate(r.checkInDate)} –{" "}
                {formatReservationDate(r.checkOutDate)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-ink-muted">
                {nightsLabel(reservationNights(r.checkInDate, r.checkOutDate))}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  {r.source === "OWNERREZ" || r.status === "CANCELLED" ? (
                    // OwnerRez is the source of truth (Meeting #6): its
                    // bookings are read-only here and change in OwnerRez.
                    // Cancelled OwnerRez bookings keep their link too.
                    <span className="flex items-center gap-2">
                      {r.source === "OWNERREZ" && r.status !== "CANCELLED" && (
                        <span className="text-xs text-ink-muted">
                          Managed in OwnerRez
                        </span>
                      )}
                      {bookingUrl && (
                        <OwnerRezLink
                          href={bookingUrl}
                          label="Open in OwnerRez"
                          title="Open this booking in OwnerRez"
                        />
                      )}
                      {statusBadge}
                    </span>
                  ) : (
                    <form
                      action={updateReservationStatusAction}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="reservationId" value={r.id} />
                      <Select
                        name="status"
                        defaultValue={r.status}
                        className="py-1.5 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {reservationStatusLabel(s)}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="secondary" size="sm">
                        Update
                      </Button>
                      {statusBadge}
                    </form>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
