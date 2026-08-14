import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    reservation: { create: vi.fn() },
    reservationGuest: { create: vi.fn() },
  };
  return {
    prisma: {
      reservation: { findMany: vi.fn(), update: vi.fn() },
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
  listReservations,
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
