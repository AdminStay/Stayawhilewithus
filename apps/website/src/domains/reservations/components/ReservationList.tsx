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
  type Tone,
} from "@stayw/ui";
import { CalendarRange } from "lucide-react";

import { updateReservationStatusAction } from "../actions";

import type { Reservation } from "../services/reservations.service";

type ReservationWithRelations = Reservation & {
  property: { name: string };
  primaryGuest: { firstName: string; lastName: string };
};

const STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
] as const;

const STATUS_TONE: Record<(typeof STATUSES)[number], Tone> = {
  PENDING: "gold",
  CONFIRMED: "info",
  CHECKED_IN: "success",
  CHECKED_OUT: "neutral",
  CANCELLED: "error",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString();
}

export function ReservationList({
  reservations,
}: {
  reservations: ReservationWithRelations[];
}) {
  if (reservations.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={CalendarRange}
          title="No reservations yet"
          description="Create your first reservation to get started."
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
        <TableHeaderCell className="text-right">Status</TableHeaderCell>
      </TableHead>
      <TableBody>
        {reservations.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium text-ink">
              {r.property.name}
            </TableCell>
            <TableCell className="text-ink-muted">
              {r.primaryGuest.firstName} {r.primaryGuest.lastName}
            </TableCell>
            <TableCell className="text-ink-muted">
              {formatDate(r.checkInDate)} – {formatDate(r.checkOutDate)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-2">
                {r.status === "CANCELLED" ? (
                  <Badge tone="error">Cancelled</Badge>
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
                          {s}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary" size="sm">
                      Update
                    </Button>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </form>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
