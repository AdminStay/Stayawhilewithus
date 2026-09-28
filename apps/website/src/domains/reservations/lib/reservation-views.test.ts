import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  buildReservationViewWhere,
  calendarDate,
  groupPropertiesByLocalDay,
  localDateInTimeZone,
  pageWindow,
  parseReservationViewParams,
  RESERVATIONS_PAGE_SIZE,
  reservationViewHref,
  reservationViewOrderBy,
  type PropertyDayGroup,
  type ReservationView,
  type ReservationWhere,
} from "./reservation-views";

// ── A tiny evaluator for exactly the Prisma filter shapes the builder emits
// (AND / OR / equality / in / not / lte / gt / lt), so boundaries are tested
// against real rows, not by comparing filter objects.
type Row = {
  id: string;
  propertyId: string;
  status: string;
  checkInDate: Date;
  checkOutDate: Date;
};

function cmp(value: unknown, cond: unknown): boolean {
  const v = value instanceof Date ? value.getTime() : value;
  if (cond instanceof Date) return v === cond.getTime();
  if (cond && typeof cond === "object") {
    return Object.entries(cond).every(([op, raw]) => {
      const c = raw instanceof Date ? raw.getTime() : raw;
      switch (op) {
        case "in":
          return (raw as unknown[]).includes(v);
        case "not":
          return v !== c;
        case "lte":
          return (v as number) <= (c as number);
        case "lt":
          return (v as number) < (c as number);
        case "gt":
          return (v as number) > (c as number);
        case "gte":
          return (v as number) >= (c as number);
        default:
          throw new Error(`unsupported operator ${op}`);
      }
    });
  }
  return v === cond;
}

function matches(row: Row, where: ReservationWhere): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND")
      return (cond as ReservationWhere[]).every((w) => matches(row, w));
    if (key === "OR")
      return (cond as ReservationWhere[]).some((w) => matches(row, w));
    return cmp(row[key as keyof Row], cond);
  });
}

const EAST = "11111111-1111-4111-8111-111111111111"; // America/New_York
const CENTRAL = "22222222-2222-4222-8222-222222222222"; // America/Chicago

let seq = 0;
function res(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  status = "CONFIRMED",
): Row {
  seq += 1;
  return {
    id: `r${seq}`,
    propertyId,
    status,
    checkInDate: calendarDate(checkIn),
    checkOutDate: calendarDate(checkOut),
  };
}

function ids(
  rows: Row[],
  view: ReservationView,
  groups: PropertyDayGroup[],
  opts: { propertyId?: string | null; includeCancelled?: boolean } = {},
): string[] {
  const where = buildReservationViewWhere(view, groups, {
    propertyId: opts.propertyId ?? null,
    includeCancelled: opts.includeCancelled ?? false,
  });
  return rows.filter((r) => matches(r, where)).map((r) => r.id);
}

// Both properties at local today 2026-09-29.
const TODAY = "2026-09-29";
const oneDay: PropertyDayGroup[] = [
  { today: TODAY, propertyIds: [EAST, CENTRAL] },
];

describe("view boundaries (local today = 2026-09-29)", () => {
  const arriveToday = res(EAST, "2026-09-29", "2026-10-02");
  const arriveYesterday = res(EAST, "2026-09-28", "2026-10-01");
  const arriveTomorrow = res(EAST, "2026-09-30", "2026-10-03");
  const departToday = res(CENTRAL, "2026-09-25", "2026-09-29");
  const departTomorrow = res(CENTRAL, "2026-09-26", "2026-09-30");
  const departedYesterday = res(CENTRAL, "2026-09-20", "2026-09-28");
  const arriveIn7 = res(EAST, "2026-10-06", "2026-10-09");
  const arriveIn8 = res(EAST, "2026-10-07", "2026-10-10");
  const rows = [
    arriveToday,
    arriveYesterday,
    arriveTomorrow,
    departToday,
    departTomorrow,
    departedYesterday,
    arriveIn7,
    arriveIn8,
  ];

  it("Arrivals today: check-in exactly today — not yesterday or tomorrow", () => {
    expect(ids(rows, "arrivals", oneDay)).toEqual([arriveToday.id]);
  });

  it("Departures today: check-out exactly today — not tomorrow or yesterday", () => {
    expect(ids(rows, "departures", oneDay)).toEqual([departToday.id]);
  });

  it("In-house now: checked in on/before today and checking out after today (a same-day departure is under Departures)", () => {
    expect(ids(rows, "in-house", oneDay).sort()).toEqual(
      [arriveToday.id, arriveYesterday.id, departTomorrow.id].sort(),
    );
    expect(ids(rows, "in-house", oneDay)).not.toContain(departToday.id);
    expect(ids(rows, "in-house", oneDay)).not.toContain(arriveTomorrow.id);
  });

  it("Upcoming 7 days: tomorrow through today+7 — not today, not today+8", () => {
    expect(ids(rows, "upcoming", oneDay).sort()).toEqual(
      [arriveTomorrow.id, arriveIn7.id].sort(),
    );
  });

  it("All: every non-cancelled reservation, no date rule", () => {
    expect(ids(rows, "all", oneDay)).toHaveLength(rows.length);
  });
});

describe("cancelled and property filters", () => {
  const live = res(EAST, TODAY, "2026-10-01");
  const cancelled = res(EAST, TODAY, "2026-10-01", "CANCELLED");
  const other = res(CENTRAL, TODAY, "2026-10-01");
  const rows = [live, cancelled, other];

  it("cancelled reservations are excluded by default", () => {
    expect(ids(rows, "arrivals", oneDay)).toEqual([live.id, other.id]);
    expect(ids(rows, "all", oneDay)).not.toContain(cancelled.id);
  });

  it("cancelled reservations are included when requested", () => {
    expect(ids(rows, "arrivals", oneDay, { includeCancelled: true })).toContain(
      cancelled.id,
    );
    expect(ids(rows, "all", oneDay, { includeCancelled: true })).toHaveLength(
      3,
    );
  });

  it("property filter restricts every view to that property", () => {
    expect(ids(rows, "arrivals", oneDay, { propertyId: CENTRAL })).toEqual([
      other.id,
    ]);
    expect(ids(rows, "all", oneDay, { propertyId: CENTRAL })).toEqual([
      other.id,
    ]);
  });

  it("a date view with no resolvable property matches nothing", () => {
    expect(ids(rows, "arrivals", [])).toEqual([]);
    expect(ids(rows, "all", [])).toHaveLength(2);
  });
});

describe("timezone / date boundaries", () => {
  it("each property's today comes from its own IANA zone", () => {
    // 2026-09-30 04:30Z = 00:30 in New York (Sep 30), 23:30 in Chicago (Sep 29).
    const now = new Date("2026-09-30T04:30:00.000Z");
    expect(localDateInTimeZone(now, "America/New_York")).toBe("2026-09-30");
    expect(localDateInTimeZone(now, "America/Chicago")).toBe("2026-09-29");
    expect(localDateInTimeZone(now, "UTC")).toBe("2026-09-30");
  });

  it("Eastern and Central properties can have different 'today' at the same instant — each view uses the property's own day", () => {
    const now = new Date("2026-09-30T04:30:00.000Z");
    const { groups, unresolved } = groupPropertiesByLocalDay(
      [
        { id: EAST, name: "East", timezone: "America/New_York" },
        { id: CENTRAL, name: "Central", timezone: "America/Chicago" },
      ],
      now,
    );
    expect(unresolved).toEqual([]);
    expect(groups).toEqual([
      { today: "2026-09-29", propertyIds: [CENTRAL] },
      { today: "2026-09-30", propertyIds: [EAST] },
    ]);
    const eastArrival30 = res(EAST, "2026-09-30", "2026-10-02");
    const eastArrival29 = res(EAST, "2026-09-29", "2026-10-02");
    const centralArrival29 = res(CENTRAL, "2026-09-29", "2026-10-02");
    const centralArrival30 = res(CENTRAL, "2026-09-30", "2026-10-02");
    const rows = [
      eastArrival30,
      eastArrival29,
      centralArrival29,
      centralArrival30,
    ];
    expect(ids(rows, "arrivals", groups).sort()).toEqual(
      [eastArrival30.id, centralArrival29.id].sort(),
    );
    // Central's "tomorrow" (Sep 30) is upcoming there; East's Sep 30 is today.
    expect(ids(rows, "upcoming", groups)).toEqual([centralArrival30.id]);
  });

  it("DST change day still resolves the right calendar date", () => {
    // 2026-11-01 is the US fall-back day.
    expect(
      localDateInTimeZone(
        new Date("2026-11-01T05:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-11-01");
    expect(
      localDateInTimeZone(
        new Date("2026-11-01T03:59:00.000Z"),
        "America/New_York",
      ),
    ).toBe("2026-10-31");
  });

  it("an unresolvable timezone is never guessed: reported and left out of date views", () => {
    const { groups, unresolved } = groupPropertiesByLocalDay(
      [
        { id: EAST, name: "East", timezone: "America/New_York" },
        { id: CENTRAL, name: "Broken", timezone: "Not/AZone" },
      ],
      new Date("2026-09-29T15:00:00.000Z"),
    );
    expect(unresolved).toEqual([{ id: CENTRAL, name: "Broken" }]);
    expect(groups).toEqual([{ today: "2026-09-29", propertyIds: [EAST] }]);
    const brokenArrival = res(CENTRAL, "2026-09-29", "2026-10-01");
    expect(ids([brokenArrival], "arrivals", groups)).toEqual([]);
    expect(ids([brokenArrival], "all", groups)).toEqual([brokenArrival.id]);
  });

  it("calendar arithmetic crosses month ends in UTC", () => {
    expect(addCalendarDays("2026-09-29", 7)).toBe("2026-10-06");
    expect(addCalendarDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(calendarDate("2026-09-29").toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
  });
});

describe("sorting", () => {
  it("arrivals/departures by property, in-house by soonest check-out, upcoming by soonest check-in, all by newest check-in — always ending in id for stable paging", () => {
    expect(reservationViewOrderBy("arrivals")).toEqual([
      { property: { name: "asc" } },
      { id: "asc" },
    ]);
    expect(reservationViewOrderBy("departures")).toEqual([
      { property: { name: "asc" } },
      { id: "asc" },
    ]);
    expect(reservationViewOrderBy("in-house")).toEqual([
      { checkOutDate: "asc" },
      { property: { name: "asc" } },
      { id: "asc" },
    ]);
    expect(reservationViewOrderBy("upcoming")).toEqual([
      { checkInDate: "asc" },
      { property: { name: "asc" } },
      { id: "asc" },
    ]);
    expect(reservationViewOrderBy("all")).toEqual([
      { checkInDate: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("pagination", () => {
  it("50 per page; clamps out-of-range pages; page 1 when empty", () => {
    expect(RESERVATIONS_PAGE_SIZE).toBe(50);
    expect(pageWindow(1, 852)).toEqual({
      page: 1,
      pageCount: 18,
      skip: 0,
      take: 50,
    });
    expect(pageWindow(18, 852)).toEqual({
      page: 18,
      pageCount: 18,
      skip: 850,
      take: 50,
    });
    expect(pageWindow(99, 852).page).toBe(18);
    expect(pageWindow(0, 852).page).toBe(1);
    expect(pageWindow(3, 0)).toEqual({
      page: 1,
      pageCount: 1,
      skip: 0,
      take: 50,
    });
  });
});

describe("URL state", () => {
  it("defaults: All, all properties, cancelled hidden, page 1", () => {
    expect(parseReservationViewParams({})).toEqual({
      view: "all",
      propertyId: null,
      includeCancelled: false,
      page: 1,
    });
  });

  it("parses valid values and ignores malformed ones", () => {
    expect(
      parseReservationViewParams({
        view: "in-house",
        property: EAST,
        cancelled: "1",
        page: "3",
      }),
    ).toEqual({
      view: "in-house",
      propertyId: EAST,
      includeCancelled: true,
      page: 3,
    });
    expect(
      parseReservationViewParams({
        view: "new-bookings",
        property: "not-a-uuid",
        cancelled: "yes",
        page: "-2",
      }),
    ).toEqual({
      view: "all",
      propertyId: null,
      includeCancelled: false,
      page: 1,
    });
  });

  it("there is no 'new bookings' view (import time is not booking time)", () => {
    expect(parseReservationViewParams({ view: "new" }).view).toBe("all");
  });

  it("hrefs round-trip and omit defaults", () => {
    const params = {
      view: "upcoming" as const,
      propertyId: EAST,
      includeCancelled: true,
      page: 2,
    };
    const href = reservationViewHref(params);
    expect(href).toBe(
      `/reservations?view=upcoming&property=${EAST}&cancelled=1&page=2`,
    );
    const query = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseReservationViewParams(query)).toEqual(params);
    expect(
      reservationViewHref({
        view: "all",
        propertyId: null,
        includeCancelled: false,
        page: 1,
      }),
    ).toBe("/reservations?view=all");
  });
});
