import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    reservation: { create: vi.fn() },
    reservationGuest: { create: vi.fn() },
  };
  return {
    prisma: {
      reservation: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  createReservation,
  listReservationRevenueRows,
  listReservations,
  listReservationView,
  updateReservationStatus,
} from "./reservations.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const reservationInput = {
  propertyId: "prop-1",
  primaryGuestId: "guest-1",
  checkInDate: new Date("2026-09-01"),
  checkOutDate: new Date("2026-09-05"),
  adults: 2,
  children: 0,
  pets: 0,
  totalAmount: 500,
  specialRequests: "",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx;

describe("listReservations", () => {
  it("returns reservations with property/guest relations when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
      { id: "r1" },
    ] as never);

    const result = await listReservations(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "reservations:read");
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { property: true, primaryGuest: true },
      }),
    );
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("propagates denial when the actor lacks reservations:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listReservations(actor)).rejects.toThrow();
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });
});

describe("createReservation", () => {
  it("creates the reservation as source=DIRECT plus a primary ReservationGuest row, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "r1", ...reservationInput };
    vi.mocked(tx.reservation.create).mockResolvedValueOnce(created as never);
    vi.mocked(tx.reservationGuest.create).mockResolvedValueOnce({} as never);

    const result = await createReservation(actor, reservationInput);

    expect(assertPermission).toHaveBeenCalledWith(actor, "reservations:create");
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyId: "prop-1",
        primaryGuestId: "guest-1",
        source: "DIRECT",
        externalReservationId: expect.any(String),
      }),
    });
    expect(tx.reservationGuest.create).toHaveBeenCalledWith({
      data: { reservationId: "r1", guestId: "guest-1", isPrimary: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "reservation.created",
        entityType: "Reservation",
        entityId: "r1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks reservations:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createReservation(actor, reservationInput)).rejects.toThrow();
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("updateReservationStatus", () => {
  it("updates the status and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "r1", status: "CANCELLED" };
    vi.mocked(prisma.reservation.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await updateReservationStatus(actor, "r1", {
      status: "CANCELLED",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "reservations:update");
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "CANCELLED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "reservation.status_updated",
        entityType: "Reservation",
        entityId: "r1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies the update and performs no writes when the actor lacks reservations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      updateReservationStatus(actor, "r1", { status: "CANCELLED" }),
    ).rejects.toThrow();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("listReservationView — Meeting #6 tabs, server-side (2026-10-02)", () => {
  const EAST = "11111111-1111-4111-8111-111111111111";
  const PROPERTIES = [
    {
      id: EAST,
      name: "Aqua Palm",
      timezone: "America/New_York",
      status: "ONBOARDING",
      deletedAt: null,
    },
  ];
  const OPERATIONAL = {
    property: { deletedAt: null, status: { in: ["ACTIVE", "ONBOARDING"] } },
  };
  const NOW = new Date("2026-09-29T15:00:00.000Z");
  const params = (over: Record<string, unknown> = {}) => ({
    view: "all" as const,
    propertyId: null,
    includeCancelled: false,
    page: 1,
    ...over,
  });

  // Counts arrive in RESERVATION_LISTS order:
  // check-ins, check-outs, in-house, this-week, upcoming, all.
  function setup(counts: number[], ...rowLists: unknown[][]) {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.reservation.count).mockReset();
    for (const c of counts) {
      vi.mocked(prisma.reservation.count).mockResolvedValueOnce(c as never);
    }
    const findMany = vi.mocked(prisma.reservation.findMany).mockReset();
    for (const rows of rowLists.length ? rowLists : [[]]) {
      findMany.mockResolvedValueOnce(rows as never);
    }
  }

  it("requires reservations:read and makes no query when denied", async () => {
    vi.mocked(assertPermission)
      .mockReset()
      .mockRejectedValueOnce(new Error("ForbiddenError"));
    vi.mocked(prisma.reservation.count).mockReset();
    vi.mocked(prisma.reservation.findMany).mockReset();
    await expect(
      listReservationView(actor, params(), PROPERTIES, NOW),
    ).rejects.toThrow();
    expect(prisma.reservation.count).not.toHaveBeenCalled();
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

  it("counts every list in the database (6 counts), sums Today, and fetches one page of the selected tab", async () => {
    setup([2, 1, 7, 12, 410, 852], [{ id: "r1" }]);
    const result = await listReservationView(
      actor,
      params({ view: "all", page: 3 }),
      PROPERTIES,
      NOW,
    );
    expect(prisma.reservation.count).toHaveBeenCalledTimes(6);
    expect(result.counts).toEqual({
      today: 3,
      "in-house": 7,
      "this-week": 12,
      upcoming: 410,
      all: 852,
    });
    expect(prisma.reservation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: { AND: [OPERATIONAL, { status: { not: "CANCELLED" } }] },
      orderBy: [{ checkInDate: "desc" }, { id: "asc" }],
      skip: 100,
      take: 50,
      include: { property: true, primaryGuest: true },
    });
    expect(result).toMatchObject({
      total: 852,
      page: 3,
      pageCount: 18,
      pageSize: 50,
      localDays: ["2026-09-29"],
      unresolvedTimezoneProperties: [],
    });
  });

  it("Today returns two unpaged lists — check-ins and check-outs — by the property's local today", async () => {
    setup(
      [2, 1, 0, 0, 0, 3],
      [{ id: "in-1" }, { id: "in-2" }],
      [{ id: "out-1" }],
    );
    const result = await listReservationView(
      actor,
      params({ view: "today", propertyId: EAST, includeCancelled: true }),
      PROPERTIES,
      NOW,
    );
    const t = new Date("2026-09-29T00:00:00.000Z");
    expect(prisma.reservation.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [
          OPERATIONAL,
          { propertyId: EAST },
          { OR: [{ propertyId: { in: [EAST] }, checkInDate: t }] },
        ],
      },
      orderBy: [{ property: { name: "asc" } }, { id: "asc" }],
      take: 200,
      include: { property: true, primaryGuest: true },
    });
    expect(prisma.reservation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          AND: [
            OPERATIONAL,
            { propertyId: EAST },
            { OR: [{ propertyId: { in: [EAST] }, checkOutDate: t }] },
          ],
        },
      }),
    );
    expect(result.checkIns.map((r) => r.id)).toEqual(["in-1", "in-2"]);
    expect(result.checkOuts.map((r) => r.id)).toEqual(["out-1"]);
    expect(result).toMatchObject({ total: 3, rows: [] });
  });

  it("Upcoming is every arrival after the local today; This week is the next 7 days", async () => {
    setup([0, 0, 0, 0, 0, 0]);
    await listReservationView(
      actor,
      params({ view: "upcoming" }),
      PROPERTIES,
      NOW,
    );
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            OPERATIONAL,
            { status: { not: "CANCELLED" } },
            {
              OR: [
                {
                  propertyId: { in: [EAST] },
                  checkInDate: { gt: new Date("2026-09-29T00:00:00.000Z") },
                },
              ],
            },
          ],
        },
      }),
    );
    setup([0, 0, 0, 0, 0, 0]);
    await listReservationView(
      actor,
      params({ view: "this-week" }),
      PROPERTIES,
      NOW,
    );
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  propertyId: { in: [EAST] },
                  checkInDate: {
                    gt: new Date("2026-09-29T00:00:00.000Z"),
                    lte: new Date("2026-10-06T00:00:00.000Z"),
                  },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("non-operational properties take no part in the date groups", async () => {
    setup([0, 0, 0, 0, 0, 0]);
    const result = await listReservationView(
      actor,
      params({ view: "in-house" }),
      [
        ...PROPERTIES,
        {
          id: "p-inactive",
          name: "Old",
          timezone: "America/Chicago",
          status: "INACTIVE",
          deletedAt: null,
        },
        {
          id: "p-gone",
          name: "Gone",
          timezone: "America/Chicago",
          status: "ACTIVE",
          deletedAt: new Date("2026-09-01"),
        },
      ],
      NOW,
    );
    expect(result.localDays).toEqual(["2026-09-29"]);
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  propertyId: { in: [EAST] },
                  checkInDate: { lte: new Date("2026-09-29T00:00:00.000Z") },
                  checkOutDate: { gt: new Date("2026-09-29T00:00:00.000Z") },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("an out-of-range page is clamped to the last page; an empty tab returns page 1 and no rows", async () => {
    setup([0, 0, 0, 0, 0, 60]);
    const clamped = await listReservationView(
      actor,
      params({ page: 9 }),
      PROPERTIES,
      NOW,
    );
    expect(clamped.page).toBe(2);
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 50 }),
    );

    setup([0, 0, 0, 0, 0, 0], []);
    const empty = await listReservationView(
      actor,
      params({ view: "in-house" }),
      PROPERTIES,
      NOW,
    );
    expect(empty).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });

  it("a property with an unresolvable timezone is reported, never guessed", async () => {
    setup([0, 0, 0, 0, 0, 5], [], []);
    const result = await listReservationView(
      actor,
      params({ view: "today" }),
      [
        ...PROPERTIES,
        {
          id: "p-bad",
          name: "Broken",
          timezone: "Bad/Zone",
          status: "ACTIVE",
          deletedAt: null,
        },
      ],
      NOW,
    );
    expect(result.unresolvedTimezoneProperties).toEqual([
      { id: "p-bad", name: "Broken" },
    ]);
  });

  it("is read-only: never writes", async () => {
    setup([0, 0, 0, 0, 0, 0]);
    await listReservationView(actor, params(), PROPERTIES, NOW);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("listReservationRevenueRows", () => {
  it("reads only the fields the revenue/ADR metrics need, after reservations:read", async () => {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.reservation.findMany)
      .mockReset()
      .mockResolvedValueOnce([]);
    await listReservationRevenueRows(actor);
    expect(assertPermission).toHaveBeenCalledWith(actor, "reservations:read");
    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      select: {
        status: true,
        totalAmount: true,
        checkInDate: true,
        checkOutDate: true,
      },
    });
  });
});
