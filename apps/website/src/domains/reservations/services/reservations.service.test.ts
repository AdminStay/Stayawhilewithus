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

describe("listReservationView — operational views, server-side (2026-09-29)", () => {
  const EAST = "11111111-1111-4111-8111-111111111111";
  const PROPERTIES = [
    { id: EAST, name: "Aqua Palm", timezone: "America/New_York" },
  ];
  const NOW = new Date("2026-09-29T15:00:00.000Z");
  const params = (over: Record<string, unknown> = {}) => ({
    view: "all" as const,
    propertyId: null,
    includeCancelled: false,
    page: 1,
    ...over,
  });

  function setup(counts: number[], rows: unknown[] = []) {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.reservation.count).mockReset();
    for (const c of counts) {
      vi.mocked(prisma.reservation.count).mockResolvedValueOnce(c as never);
    }
    vi.mocked(prisma.reservation.findMany)
      .mockReset()
      .mockResolvedValueOnce(rows as never);
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

  it("counts every view in the database (5 counts) and fetches only one page of the selected view", async () => {
    // counts in RESERVATION_VIEWS order: arrivals, in-house, departures, upcoming, all
    setup([2, 7, 1, 12, 852], [{ id: "r1" }]);
    const result = await listReservationView(
      actor,
      params({ view: "all", page: 3 }),
      PROPERTIES,
      NOW,
    );
    expect(prisma.reservation.count).toHaveBeenCalledTimes(5);
    expect(result.counts).toEqual({
      arrivals: 2,
      "in-house": 7,
      departures: 1,
      upcoming: 12,
      all: 852,
    });
    expect(prisma.reservation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: { AND: [{ status: { not: "CANCELLED" } }] },
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

  it("a date view filters by the property's local today, with the property/cancelled filters applied", async () => {
    setup([1, 0, 0, 0, 3]);
    await listReservationView(
      actor,
      params({ view: "arrivals", propertyId: EAST, includeCancelled: true }),
      PROPERTIES,
      NOW,
    );
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { propertyId: EAST },
            {
              OR: [
                {
                  propertyId: { in: [EAST] },
                  checkInDate: new Date("2026-09-29T00:00:00.000Z"),
                },
              ],
            },
          ],
        },
        orderBy: [{ property: { name: "asc" } }, { id: "asc" }],
        skip: 0,
        take: 50,
      }),
    );
  });

  it("an out-of-range page is clamped to the last page; an empty view returns page 1 and no rows", async () => {
    setup([0, 0, 0, 0, 60]);
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

    setup([0, 0, 0, 0, 0], []);
    const empty = await listReservationView(
      actor,
      params({ view: "arrivals" }),
      PROPERTIES,
      NOW,
    );
    expect(empty).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });

  it("a property with an unresolvable timezone is reported, never guessed", async () => {
    setup([0, 0, 0, 0, 5]);
    const result = await listReservationView(
      actor,
      params({ view: "arrivals" }),
      [...PROPERTIES, { id: "p-bad", name: "Broken", timezone: "Bad/Zone" }],
      NOW,
    );
    expect(result.unresolvedTimezoneProperties).toEqual([
      { id: "p-bad", name: "Broken" },
    ]);
  });

  it("is read-only: never writes", async () => {
    setup([0, 0, 0, 0, 0]);
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
