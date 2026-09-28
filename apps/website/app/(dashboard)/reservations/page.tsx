import { hasPermission } from "@stayw/auth";
import {
  Card,
  DialogTrigger,
  Metric,
  MetricStrip,
  PageHeader,
} from "@stayw/ui";
import { TrendingUp, Wallet } from "lucide-react";

import { listGuests } from "@/domains/guests/services/guests.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import {
  previewOwnerRezSyncAction,
  syncOwnerRezReservationsAction,
} from "@/domains/reservations/actions";
import { CreateReservationForm } from "@/domains/reservations/components/CreateReservationForm";
import { OwnerRezSyncStatusLine } from "@/domains/reservations/components/OwnerRezSyncStatusLine";
import { PreviewOwnerRezSyncButton } from "@/domains/reservations/components/PreviewOwnerRezSyncButton";
import { ReservationList } from "@/domains/reservations/components/ReservationList";
import {
  ReservationPagination,
  ReservationViewControls,
} from "@/domains/reservations/components/ReservationViewControls";
import { SyncOwnerRezReservationsButton } from "@/domains/reservations/components/SyncOwnerRezReservationsButton";
import { getOwnerRezSyncStatus } from "@/domains/reservations/services/ownerrez-sync-status.service";
import {
  parseReservationViewParams,
  RESERVATION_VIEW_LABELS,
  type ReservationView,
} from "@/domains/reservations/lib/reservation-views";
import {
  listReservationRevenueRows,
  listReservationView,
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

type RevenueRow = {
  status: string;
  totalAmount: unknown;
  checkInDate: Date;
  checkOutDate: Date;
};

function computeRevenueMetrics(reservations: RevenueRow[]) {
  const counted = reservations.filter((r) => REVENUE_STATUSES.has(r.status));
  const revenue = counted.reduce((sum, r) => sum + Number(r.totalAmount), 0);
  const nights = counted.reduce(
    (sum, r) => sum + nightsBetween(r.checkInDate, r.checkOutDate),
    0,
  );
  return { revenue, adr: nights > 0 ? revenue / nights : 0 };
}

const EMPTY_STATE: Record<ReservationView, string> = {
  arrivals: "No arrivals today.",
  "in-house": "No guests in house right now.",
  departures: "No departures today.",
  upcoming: "No arrivals in the next 7 days.",
  all: "No reservations match these filters.",
};

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentUser();
  const params = parseReservationViewParams(await searchParams);
  const [reservations, properties, guests, canSyncOwnerRez] = await Promise.all(
    [
      listReservationRevenueRows(actor),
      listProperties(actor),
      listGuests(actor),
      hasPermission(actor, "reservations:update"),
    ],
  );
  // 2026-09-30: read-only sync status (database only, no OwnerRez call).
  const ownerRezSyncStatus = canSyncOwnerRez
    ? await getOwnerRezSyncStatus(actor)
    : null;
  // Operational views (2026-09-29): one filtered, paged page of rows plus
  // per-view counts, all computed in the database.
  const view = await listReservationView(actor, params, properties);
  const viewParams = { ...params, page: view.page };

  const { revenue, adr } = computeRevenueMetrics(reservations);

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${reservations.length} ${reservations.length === 1 ? "reservation" : "reservations"} on the books`}
        actions={
          <>
            <DialogTrigger
              label="Create reservation"
              title="Create reservation"
            >
              <CreateReservationForm properties={properties} guests={guests} />
            </DialogTrigger>
          </>
        }
      />
      {/* 2026-09-28: Preview (read-only) and Sync (writes, confirmed) side by
          side in the page body — not the header's actions slot — with room
          for the preview results. */}
      {canSyncOwnerRez && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-ink">OwnerRez sync</h2>
          {ownerRezSyncStatus && (
            <div className="mb-4">
              <OwnerRezSyncStatusLine status={ownerRezSyncStatus} />
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <PreviewOwnerRezSyncButton action={previewOwnerRezSyncAction} />
            <SyncOwnerRezReservationsButton
              action={syncOwnerRezReservationsAction}
            />
          </div>
        </Card>
      )}
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
      <ReservationViewControls
        params={viewParams}
        counts={view.counts}
        properties={[...properties]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ id: p.id, name: p.name }))}
      />
      {params.view !== "all" &&
        view.unresolvedTimezoneProperties.length > 0 && (
          <p className="mb-3 text-xs text-warning-600">
            Not included in date views (property timezone couldn&apos;t be
            read):{" "}
            {view.unresolvedTimezoneProperties.map((p) => p.name).join(", ")}.
            Their reservations still appear under All.
          </p>
        )}
      <ReservationList
        reservations={view.rows}
        emptyTitle={RESERVATION_VIEW_LABELS[params.view]}
        emptyDescription={EMPTY_STATE[params.view]}
      />
      <ReservationPagination
        params={viewParams}
        page={view.page}
        pageCount={view.pageCount}
        pageSize={view.pageSize}
        total={view.total}
      />
    </div>
  );
}
