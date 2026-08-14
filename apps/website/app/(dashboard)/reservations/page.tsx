import { DialogTrigger, Metric, MetricStrip, PageHeader } from "@stayw/ui";
import { TrendingUp, Wallet } from "lucide-react";

import { listGuests } from "@/domains/guests/services/guests.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { CreateReservationForm } from "@/domains/reservations/components/CreateReservationForm";
import { ReservationList } from "@/domains/reservations/components/ReservationList";
import {
  listReservations,
  type Reservation,
} from "@/domains/reservations/services/reservations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

// Revenue/ADR count real, realized-or-committed stays — pending inquiries
// and cancellations don't count as revenue. Deprioritized off the main
// dashboard per client direction (2026-08-11) but kept reachable here,
// where the underlying reservation data already lives.
const REVENUE_STATUSES = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function computeRevenueMetrics(reservations: Reservation[]) {
  const counted = reservations.filter((r) => REVENUE_STATUSES.has(r.status));
  const revenue = counted.reduce((sum, r) => sum + Number(r.totalAmount), 0);
  const nights = counted.reduce(
    (sum, r) => sum + nightsBetween(r.checkInDate, r.checkOutDate),
    0,
  );
  return { revenue, adr: nights > 0 ? revenue / nights : 0 };
}

export default async function ReservationsPage() {
  const actor = await getCurrentUser();
  const [reservations, properties, guests] = await Promise.all([
    listReservations(actor),
    listProperties(actor),
    listGuests(actor),
  ]);

  const { revenue, adr } = computeRevenueMetrics(reservations);

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${reservations.length} ${reservations.length === 1 ? "reservation" : "reservations"} on the books`}
        actions={
          <DialogTrigger label="Create reservation" title="Create reservation">
            <CreateReservationForm properties={properties} guests={guests} />
          </DialogTrigger>
        }
      />
      <MetricStrip xlColumns={3} className="mb-8">
        <Metric
          label="Revenue"
          value={formatCurrency(revenue)}
          icon={Wallet}
          hint="Confirmed & checked-in/out"
        />
        <Metric
          label="ADR"
          value={formatCurrency(adr)}
          icon={TrendingUp}
          hint="Average daily rate"
        />
      </MetricStrip>
      <ReservationList reservations={reservations} />
    </div>
  );
}
