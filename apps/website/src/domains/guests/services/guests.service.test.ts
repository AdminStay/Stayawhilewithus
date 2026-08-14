import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    guest: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  createGuest,
  deleteGuest,
  listGuests,
  updateGuest,
} from "./guests.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const guestInput = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "",
  notes: "",
};

describe("listGuests", () => {
  it("returns guests when the actor is granted guests:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.guest.findMany).mockResolvedValueOnce([
      { id: "g1" },
    ] as never);

    const result = await listGuests(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "guests:read");
    expect(result).toEqual([{ id: "g1" }]);
  });

  it("propagates denial when the actor lacks guests:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listGuests(actor)).rejects.toThrow();
    expect(prisma.guest.findMany).not.toHaveBeenCalled();
  });
});

describe("createGuest", () => {
  it("creates the guest, converting blank optional fields to undefined, and records an audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "g1", firstName: "Ada", lastName: "Lovelace" };
    vi.mocked(prisma.guest.create).mockResolvedValueOnce(created as never);

    const result = await createGuest(actor, guestInput);

    expect(assertPermission).toHaveBeenCalledWith(actor, "guests:create");
    expect(prisma.guest.create).toHaveBeenCalledWith({
      data: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: undefined,
        notes: undefined,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "guest.created",
        entityType: "Guest",
        entityId: "g1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks guests:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createGuest(actor, guestInput)).rejects.toThrow();
    expect(prisma.guest.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("updateGuest", () => {
  it("updates the guest, converting blank optional fields to undefined, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "g1", firstName: "Ada", lastName: "Byron" };
    vi.mocked(prisma.guest.update).mockResolvedValueOnce(updated as never);

    const result = await updateGuest(actor, "g1", {
      ...guestInput,
      lastName: "Byron",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "guests:update");
    expect(prisma.guest.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: {
        firstName: "Ada",
        lastName: "Byron",
        email: "ada@example.com",
        phone: undefined,
        notes: undefined,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "guest.updated",
        entityType: "Guest",
        entityId: "g1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies the update and performs no writes when the actor lacks guests:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(updateGuest(actor, "g1", guestInput)).rejects.toThrow();
    expect(prisma.guest.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("deleteGuest", () => {
  it("soft-deletes the guest by setting deletedAt, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const deleted = { id: "g1", deletedAt: new Date() };
    vi.mocked(prisma.guest.update).mockResolvedValueOnce(deleted as never);

    const result = await deleteGuest(actor, "g1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "guests:delete");
    expect(prisma.guest.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "guest.deleted",
        entityType: "Guest",
        entityId: "g1",
      }),
    );
    expect(result).toEqual(deleted);
  });

  it("denies deletion and performs no writes when the actor lacks guests:delete", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(deleteGuest(actor, "g1")).rejects.toThrow();
    expect(prisma.guest.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
