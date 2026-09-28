/**
 * Operational reservation views for /reservations (2026-09-29, Meeting #5
 * OwnerRez item). Pure: parses the URL state and builds the Prisma filters,
 * so all filtering, counting and paging happen in the database — the page
 * never loads every reservation.
 *
 * "Today" is per property, from Property.timezone (a required IANA zone).
 * Check-in/check-out are @db.Date calendar dates that Prisma round-trips as
 * UTC midnight, so a property's local calendar day "YYYY-MM-DD" is compared
 * as `YYYY-MM-DDT00:00:00Z`. A property whose timezone the platform can't
 * resolve is never guessed: it's left out of the date-based views (and
 * reported), and still appears under All.
 *
 * View rules (T = the property's local today):
 *   arrivals    check-in  = T
 *   departures  check-out = T
 *   in-house    check-in <= T < check-out (staying tonight; guests leaving
 *               today are under Departures)
 *   upcoming    T < check-in <= T + 7 (tomorrow through 7 days out)
 *   all         no date rule
 * Cancelled reservations are excluded unless explicitly included. There is
 * deliberately no "new bookings" view: Reservation.createdAt is when
 * StayWhile imported a booking, not when it was booked in OwnerRez.
 */

export const RESERVATION_VIEWS = [
  "arrivals",
  "in-house",
  "departures",
  "upcoming",
  "all",
] as const;
export type ReservationView = (typeof RESERVATION_VIEWS)[number];

export const RESERVATION_VIEW_LABELS: Record<ReservationView, string> = {
  arrivals: "Arrivals today",
  "in-house": "In-house now",
  departures: "Departures today",
  upcoming: "Upcoming 7 days",
  all: "All",
};

export const UPCOMING_VIEW_DAYS = 7;
export const RESERVATIONS_PAGE_SIZE = 50;

export interface ReservationViewParams {
  view: ReservationView;
  /** Restrict to one property, or null for all. */
  propertyId: string | null;
  includeCancelled: boolean;
  /** 1-based. */
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unknown or malformed values fall back to the defaults: All (the page's previous landing view), all properties, cancelled hidden, page 1. */
export function parseReservationViewParams(
  searchParams: SearchParams,
): ReservationViewParams {
  const view = first(searchParams.view);
  const property = first(searchParams.property);
  const page = Number.parseInt(first(searchParams.page) ?? "", 10);
  return {
    view: (RESERVATION_VIEWS as readonly string[]).includes(view ?? "")
      ? (view as ReservationView)
      : "all",
    propertyId: property && UUID_RE.test(property) ? property : null,
    includeCancelled: first(searchParams.cancelled) === "1",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The URL for a view state; defaults are omitted to keep links short. */
export function reservationViewHref(params: ReservationViewParams): string {
  const query = new URLSearchParams();
  query.set("view", params.view);
  if (params.propertyId) query.set("property", params.propertyId);
  if (params.includeCancelled) query.set("cancelled", "1");
  if (params.page > 1) query.set("page", String(params.page));
  return `/reservations?${query.toString()}`;
}

/** The calendar date "YYYY-MM-DD" at `now` in an IANA zone, or null when the zone can't be resolved. */
export function localDateInTimeZone(
  now: Date,
  timeZone: string,
): string | null {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return null;
  }
}

/** A calendar date as the UTC-midnight Date Prisma uses for @db.Date. */
export function calendarDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function addCalendarDays(ymd: string, days: number): string {
  const d = calendarDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PropertyTimeZoneInput {
  id: string;
  name: string;
  timezone: string;
}

export interface PropertyDayGroup {
  /** Local today for every property in the group. */
  today: string;
  propertyIds: string[];
}

/**
 * Groups properties by their local today (usually one or two groups — e.g.
 * Eastern and Central share a date most of the day). Properties whose
 * timezone can't be resolved are returned separately, never guessed.
 */
export function groupPropertiesByLocalDay(
  properties: PropertyTimeZoneInput[],
  now: Date,
): {
  groups: PropertyDayGroup[];
  unresolved: Array<{ id: string; name: string }>;
} {
  const byDay = new Map<string, string[]>();
  const unresolved: Array<{ id: string; name: string }> = [];
  for (const p of properties) {
    const today = localDateInTimeZone(now, p.timezone);
    if (!today) {
      unresolved.push({ id: p.id, name: p.name });
      continue;
    }
    byDay.set(today, [...(byDay.get(today) ?? []), p.id]);
  }
  return {
    groups: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([today, propertyIds]) => ({ today, propertyIds })),
    unresolved,
  };
}

// Plain-object Prisma filter shapes (kept structural so this file stays
// free of runtime imports and can be unit-tested directly).
export type ReservationWhere = Record<string, unknown>;
export type ReservationOrderBy = Array<Record<string, unknown>>;

function dateRule(view: ReservationView, today: string): ReservationWhere {
  const t = calendarDate(today);
  switch (view) {
    case "arrivals":
      return { checkInDate: t };
    case "departures":
      return { checkOutDate: t };
    case "in-house":
      return { checkInDate: { lte: t }, checkOutDate: { gt: t } };
    case "upcoming":
      return {
        checkInDate: {
          gt: t,
          lte: calendarDate(addCalendarDays(today, UPCOMING_VIEW_DAYS)),
        },
      };
    case "all":
      return {};
  }
}

/**
 * The full filter for one view. Date views apply each property group's own
 * local today; with no resolvable property they match nothing.
 */
export function buildReservationViewWhere(
  view: ReservationView,
  groups: PropertyDayGroup[],
  options: { propertyId: string | null; includeCancelled: boolean },
): ReservationWhere {
  const and: ReservationWhere[] = [];
  if (!options.includeCancelled) and.push({ status: { not: "CANCELLED" } });
  if (options.propertyId) and.push({ propertyId: options.propertyId });
  if (view !== "all") {
    and.push({
      OR: groups.map((g) => ({
        propertyId: { in: g.propertyIds },
        ...dateRule(view, g.today),
      })),
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

/** Ordering per view, always ending in `id` so paging is stable. */
export function reservationViewOrderBy(
  view: ReservationView,
): ReservationOrderBy {
  switch (view) {
    case "arrivals":
      return [{ property: { name: "asc" } }, { id: "asc" }];
    case "departures":
      return [{ property: { name: "asc" } }, { id: "asc" }];
    case "in-house":
      return [
        { checkOutDate: "asc" },
        { property: { name: "asc" } },
        { id: "asc" },
      ];
    case "upcoming":
      return [
        { checkInDate: "asc" },
        { property: { name: "asc" } },
        { id: "asc" },
      ];
    case "all":
      return [{ checkInDate: "desc" }, { id: "asc" }];
  }
}

/** Clamps the requested page to the available range (page 1 when empty). */
export function pageWindow(
  requestedPage: number,
  total: number,
  pageSize: number = RESERVATIONS_PAGE_SIZE,
): { page: number; pageCount: number; skip: number; take: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize, take: pageSize };
}
