import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    maintenanceRequest: { findUnique: vi.fn(), update: vi.fn() },
    task: { create: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      maintenanceRequest: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
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
  assignMaintenanceRequest,
  createMaintenanceRequest,
  listMaintenanceRequests,
  resolveMaintenanceRequest,
} from "./maintenance.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx;

const requestInput = {
  propertyId: "prop-1",
  category: "PLUMBING" as const,
  severity: "HIGH" as const,
  description: "Kitchen sink is leaking",
};

describe("listMaintenanceRequests", () => {
  it("returns requests with property/task relations when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.maintenanceRequest.findMany).mockResolvedValueOnce([
      { id: "mr1" },
    ] as never);

    const result = await listMaintenanceRequests(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "maintenance_requests:read",
    );
    expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { property: true, task: true },
      }),
    );
    expect(result).toEqual([{ id: "mr1" }]);
  });

  it("propagates denial when the actor lacks maintenance_requests:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listMaintenanceRequests(actor)).rejects.toThrow();
    expect(prisma.maintenanceRequest.findMany).not.toHaveBeenCalled();
  });
});

describe("createMaintenanceRequest", () => {
  it("creates an OPEN request attributed to the reporting user, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "mr1", ...requestInput, status: "OPEN" };
    vi.mocked(prisma.maintenanceRequest.create).mockResolvedValueOnce(
      created as never,
    );

    const result = await createMaintenanceRequest(actor, requestInput);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "maintenance_requests:create",
    );
    expect(prisma.maintenanceRequest.create).toHaveBeenCalledWith({
      data: {
        propertyId: "prop-1",
        category: "PLUMBING",
        severity: "HIGH",
        description: "Kitchen sink is leaking",
        reportedByUserId: actor.userId,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "maintenance_request.created",
        entityType: "MaintenanceRequest",
        entityId: "mr1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks maintenance_requests:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      createMaintenanceRequest(actor, requestInput),
    ).rejects.toThrow();
    expect(prisma.maintenanceRequest.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("resolveMaintenanceRequest", () => {
  it("marks the request RESOLVED with notes and a timestamp, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "mr1", status: "RESOLVED" };
    vi.mocked(prisma.maintenanceRequest.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await resolveMaintenanceRequest(actor, "mr1", {
      resolutionNotes: "Replaced the fitting",
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "maintenance_requests:update",
    );
    expect(prisma.maintenanceRequest.update).toHaveBeenCalledWith({
      where: { id: "mr1" },
      data: {
        status: "RESOLVED",
        resolutionNotes: "Replaced the fitting",
        resolvedAt: expect.any(Date),
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "maintenance_request.resolved",
        entityType: "MaintenanceRequest",
        entityId: "mr1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies resolution and performs no writes when the actor lacks maintenance_requests:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      resolveMaintenanceRequest(actor, "mr1", { resolutionNotes: "" }),
    ).rejects.toThrow();
    expect(prisma.maintenanceRequest.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("assignMaintenanceRequest", () => {
  it("creates a backing Task on first assignment and moves the request to IN_PROGRESS", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(tx.maintenanceRequest.findUnique).mockResolvedValueOnce({
      id: "mr1",
      taskId: null,
      category: "PLUMBING",
      propertyId: "prop-1",
    } as never);
    vi.mocked(tx.task.create).mockResolvedValueOnce({ id: "task-1" } as never);
    const updated = { id: "mr1", taskId: "task-1", status: "IN_PROGRESS" };
    vi.mocked(tx.maintenanceRequest.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await assignMaintenanceRequest(actor, "mr1", {
      assignedToUserId: "u1",
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "maintenance_requests:update",
    );
    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "MAINTENANCE",
        propertyId: "prop-1",
        assignedToUserId: "u1",
        createdByUserId: actor.userId,
      }),
    });
    expect(tx.maintenanceRequest.update).toHaveBeenCalledWith({
      where: { id: "mr1" },
      data: { taskId: "task-1", status: "IN_PROGRESS" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "maintenance_request.assigned",
        entityType: "MaintenanceRequest",
        entityId: "mr1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("reassigns the existing Task instead of creating a new one when taskId is already set", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(tx.maintenanceRequest.findUnique).mockResolvedValueOnce({
      id: "mr1",
      taskId: "task-1",
      category: "PLUMBING",
      propertyId: "prop-1",
    } as never);
    vi.mocked(tx.maintenanceRequest.update).mockResolvedValueOnce({
      id: "mr1",
      taskId: "task-1",
      status: "IN_PROGRESS",
    } as never);

    await assignMaintenanceRequest(actor, "mr1", { assignedToUserId: "u2" });

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { assignedToUserId: "u2" },
    });
  });

  it("throws NotFoundError and performs no writes when the request doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(tx.maintenanceRequest.findUnique).mockResolvedValueOnce(
      null as never,
    );

    await expect(
      assignMaintenanceRequest(actor, "missing", { assignedToUserId: "u1" }),
    ).rejects.toThrow(/not found/i);
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.maintenanceRequest.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("denies assignment and performs no writes when the actor lacks maintenance_requests:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      assignMaintenanceRequest(actor, "mr1", { assignedToUserId: "u1" }),
    ).rejects.toThrow();
    expect(tx.maintenanceRequest.findUnique).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
