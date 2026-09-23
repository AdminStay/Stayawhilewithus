import { describe, expect, it, vi } from "vitest";

const { globalAuditLogCreateMock } = vi.hoisted(() => ({
  globalAuditLogCreateMock: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    auditLog: { create: globalAuditLogCreateMock },
  },
}));

import { prisma } from "@stayw/database";

import { recordAudit } from "./record-audit";

const baseInput = {
  actorUserId: "user-1",
  actorType: "USER" as const,
  action: "smart_device.retired",
  entityType: "SmartDevice",
  entityId: "device-1",
};

describe("recordAudit", () => {
  it("with no second argument, writes through the global prisma singleton — every existing one-argument call site is unaffected", async () => {
    await recordAudit(baseInput);

    expect(globalAuditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "smart_device.retired",
          entityType: "SmartDevice",
          entityId: "device-1",
          actorUserId: "user-1",
          actorType: "USER",
        }),
      }),
    );
  });

  it("with an explicit transaction client, writes through that client instead of the global prisma singleton", async () => {
    const txAuditLogCreateMock = vi.fn().mockResolvedValue({ id: "audit-2" });
    const tx = {
      auditLog: { create: txAuditLogCreateMock },
    } as unknown as typeof prisma;

    await recordAudit(baseInput, tx);

    expect(txAuditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "smart_device.retired",
          entityId: "device-1",
        }),
      }),
    );
    expect(globalAuditLogCreateMock).not.toHaveBeenCalled();
  });
});
