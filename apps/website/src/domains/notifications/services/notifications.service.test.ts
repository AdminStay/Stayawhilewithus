import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
  listNotifications,
  markNotificationRead,
} from "./notifications.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

describe("listNotifications", () => {
  it("returns only the actor's own notifications when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([
      { id: "n1" },
    ] as never);

    const result = await listNotifications(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "notifications:read");
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: actor.userId } }),
    );
    expect(result).toEqual([{ id: "n1" }]);
  });

  it("propagates denial when the actor lacks notifications:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listNotifications(actor)).rejects.toThrow();
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });
});

describe("markNotificationRead", () => {
  it("sets readAt and audits it when the notification belongs to the actor", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
      id: "n1",
      userId: actor.userId,
    } as never);
    const updated = { id: "n1", readAt: new Date() };
    vi.mocked(prisma.notification.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await markNotificationRead(actor, "n1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "notifications:update",
    );
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { readAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "notification.read",
        entityType: "Notification",
        entityId: "n1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("throws NotFoundError and performs no writes when the notification belongs to another user", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
      id: "n1",
      userId: "someone-else",
    } as never);

    await expect(markNotificationRead(actor, "n1")).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("denies the update and performs no writes when the actor lacks notifications:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(markNotificationRead(actor, "n1")).rejects.toThrow();
    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
