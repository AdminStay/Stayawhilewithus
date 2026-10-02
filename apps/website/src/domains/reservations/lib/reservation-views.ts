import { OPERATIONAL_PROPERTY_WHERE } from "@/domains/properties/lib/operational-properties";

/**
 * Operational reservation views for /reservations (2026-09-29, Meeting #5;
 * reorganised for Meeting #6 on 2026-10-02). Pure: parses the URL state and
 * builds the Prisma filters, so all filtering, counting and paging happen in
 * the database — the page never loads every reservation.
 *
 * "Today" is per property, from Property.timezone (a required IANA zone).
 * Check-in/check-out are @db.Date calendar dates that Prisma round-trips as
 * UTC midnight, so a property's local calendar day "YYYY-MM-DD" is compared
 * as `YYYY-MM-DDT00:00:00Z`. A property whose timezone the platform can't
 * resolve is never guessed: it's left out of the date-based views (and
 * reported), and still appears under All.
 *
 * Tabs (T = the property's local today):
 *   today       two lists: Check-ins (check-in = T) and Check-outs
 *               (check-out = T)
 *   in-house    check-in <= T < check-out (staying tonight; guests leaving
 *               today are under Today → Check-outs)
 *   this-week   T < check-in <= T + 7 (tomorrow through 7 days out)
 *   upcoming    check-in > T (every future arrival)
 *   all         no date rule
 * Every view shows operational properties only (ACTIVE or ONBOARDING, not
 * deleted — see properties/lib/operational-properties.ts). Cancelled
 * reservations are excluded unless explicitly included. There is
 * deliberately no "new bookings" view yet: Reservation.createdAt is when
 * StayWhile imported a booking, not when it was booked in OwnerRez.
 */

export const RESERVATION_VIEWS = [
  "today",
  "in-house",
  "this-week",
  "upcoming",
  "all",
] as const;
export type ReservationView = (typeof RESERVATION_VIEWS)[number];

export const DEFAULT_RESERVATION_VIEW: ReservationView = "today";

export const RESERVATION_VIEW_LABELS: Record<ReservationView, string> = {
  today: "Today",
  "in-house": "In-house",
  "this-week": "This week",
  upcoming: "Upcoming",
  all: "All",
};

/**
 * The individual row lists behind the tabs. "today" is two lists; every
 * other tab is one list of the same name.
 */
export const RESERVATION_LISTS = [
  "check-ins",
  "check-outs",
  "in-house",
  "this-week",
  "upcoming",
  "all",
] as const;
export type ReservationListKind = (typeof RESERVATION_LISTS)[number];

/** Which lists make up each tab (Today's count is check-ins + check-outs). */
export const VIEW_LISTS: Record<ReservationView, ReservationListKind[]> = {
  today: ["check-ins", "check-outs"],
  "in-house": ["in-house"],
  "this-week": ["this-week"],
  upcoming: ["upcoming"],
  all: ["all"],
};

/** Views from the unreleased 2026-09-29 branch, kept working as links. */
const LEGACY_VIEWS: Record<string, ReservationView> = {
  arrivals: "today",
  departures: "today",
};

export const THIS_WEEK_DAYS = 7;
export const RESERVATIONS_PAGE_SIZE = 50;
/** Today's two lists aren't paged; each shows at most this many rows. */
export const TODAY_LIST_LIMIT = 200;

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

/** Unknown or malformed values fall back to the defaults: Today, all properties, cancelled hidden, page 1. */
export function parseReservationViewParams(
  searchParams: SearchParams,
): ReservationViewParams {
  const view = first(searchParams.view);
  const property = first(searchParams.property);
  const page = Number.parseInt(first(searchParams.page) ?? "", 10);
  return {
    view: (RESERVATION_VIEWS as readonly string[]).includes(view ?? "")
      ? (view as ReservationView)
      : (LEGACY_VIEWS[view ?? ""] ?? DEFAULT_RESERVATION_VIEW),
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

function dateRule(
  list: Exclude<ReservationListKind, "all">,
  today: string,
): ReservationWhere {
  const t = calendarDate(today);
  switch (list) {
    case "check-ins":
      return { checkInDate: t };
    case "check-outs":
      return { checkOutDate: t };
    case "in-house":
      return { checkInDate: { lte: t }, checkOutDate: { gt: t } };
    case "this-week":
      return {
        checkInDate: {
          gt: t,
          lte: calendarDate(addCalendarDays(today, THIS_WEEK_DAYS)),
        },
      };
    case "upcoming":
      return { checkInDate: { gt: t } };
  }
}

/**
 * The full filter for one list. Every list is limited to operational
 * properties; date lists apply each property group's own local today and
 * match nothing when no property's timezone resolves.
 */
export function buildReservationListWhere(
  list: ReservationListKind,
  groups: PropertyDayGroup[],
  options: { propertyId: string | null; includeCancelled: boolean },
): ReservationWhere {
  const and: ReservationWhere[] = [{ property: OPERATIONAL_PROPERTY_WHERE }];
  if (!options.includeCancelled) and.push({ status: { not: "CANCELLED" } });
  if (options.propertyId) and.push({ propertyId: options.propertyId });
  if (list !== "all") {
    and.push({
      OR: groups.map((g) => ({
        propertyId: { in: g.propertyIds },
        ...dateRule(list, g.today),
      })),
    });
  }
  return { AND: and };
}

/** Ordering per list, always ending in `id` so paging is stable. */
export function reservationListOrderBy(
  list: ReservationListKind,
): ReservationOrderBy {
  switch (list) {
    case "check-ins":
    case "check-outs":
      return [{ property: { name: "asc" } }, { id: "asc" }];
    case "in-house":
      return [
        { checkOutDate: "asc" },
        { property: { name: "asc" } },
        { id: "asc" },
      ];
    case "this-week":
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

/** "YYYY-MM-DD" of a @db.Date value (Prisma returns it as UTC midnight). */
export function calendarDay(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}
