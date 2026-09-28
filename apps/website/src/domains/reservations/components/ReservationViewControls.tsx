import { Button, Select } from "@stayw/ui";
import Link from "next/link";

import {
  RESERVATION_VIEW_LABELS,
  RESERVATION_VIEWS,
  reservationViewHref,
  type ReservationViewParams,
  type ReservationView,
} from "../lib/reservation-views";

/**
 * View tabs (with counts) and the property / show-cancelled filter for
 * /reservations (2026-09-29). Plain links and a GET form: the URL holds the
 * whole state, and the server does all filtering.
 */
export function ReservationViewControls({
  params,
  counts,
  properties,
}: {
  params: ReservationViewParams;
  counts: Record<ReservationView, number>;
  properties: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="mb-4 space-y-3">
      <nav aria-label="Reservation views" className="flex flex-wrap gap-2">
        {RESERVATION_VIEWS.map((view) => (
          <Link
            key={view}
            href={reservationViewHref({ ...params, view, page: 1 })}
            aria-current={view === params.view ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              view === params.view
                ? "bg-forest-600 text-white"
                : "bg-surface-muted text-ink-muted hover:text-ink"
            }`}
          >
            {RESERVATION_VIEW_LABELS[view]} ({counts[view]})
          </Link>
        ))}
      </nav>

      <form
        method="get"
        action="/reservations"
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="view" value={params.view} />
        <Select
          name="property"
          aria-label="Filter by property"
          defaultValue={params.propertyId ?? ""}
          className="w-auto"
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            name="cancelled"
            value="1"
            defaultChecked={params.includeCancelled}
          />
          Show cancelled
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
      </form>
    </div>
  );
}

/** Previous / next page links, shown only when there is more than one page. */
export function ReservationPagination({
  params,
  page,
  pageCount,
  pageSize,
  total,
}: {
  params: ReservationViewParams;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const linkClass =
    "rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface-muted";
  return (
    <nav
      aria-label="Reservation pages"
      className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-muted"
    >
      <span>
        Showing {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link
            href={reservationViewHref({ ...params, page: page - 1 })}
            className={linkClass}
          >
            Previous
          </Link>
        )}
        <span className="px-1 py-1.5">
          Page {page} of {pageCount}
        </span>
        {page < pageCount && (
          <Link
            href={reservationViewHref({ ...params, page: page + 1 })}
            className={linkClass}
          >
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}
