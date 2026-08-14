import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
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
  assignTask,
  completeTask,
  createTask,
  listAssignableUsers,
  listTasks,
} from "./tasks.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const taskInput = {
  title: "Deep clean unit 4B",
  description: "",
  type: "CLEANING" as const,
  priority: "NORMAL" as const,
  propertyId: "",
  dueAt: undefined,
};

describe("listTasks", () => {
  it("returns tasks when the actor is granted tasks:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([
      { id: "t1" },
    ] as never);

    const result = await listTasks(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "tasks:read");
    expect(result).toEqual([{ id: "t1" }]);
  });

  it("propagates denial when the actor lacks tasks:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listTasks(actor)).rejects.toThrow();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe("createTask", () => {
  it("creates the task, converting blank optional fields to undefined, and records an audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "t1", title: "Deep clean unit 4B" };
    vi.mocked(prisma.task.create).mockResolvedValueOnce(created as never);

    const result = await createTask(actor, taskInput);

    expect(assertPermission).toHaveBeenCalledWith(actor, "tasks:create");
    expect(prisma.task.create).toHaveBeenCalledWith({
      data: {
        title: "Deep clean unit 4B",
        description: undefined,
        type: "CLEANING",
        priority: "NORMAL",
        propertyId: undefined,
        dueAt: undefined,
        createdByUserId: actor.userId,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "task.created",
        entityType: "Task",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks tasks:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createTask(actor, taskInput)).rejects.toThrow();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("completeTask", () => {
  it("marks the task done and records an audit entry when the actor is granted tasks:update", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "t1", status: "DONE" };
    vi.mocked(prisma.task.update).mockResolvedValueOnce(updated as never);

    const result = await completeTask(actor, "t1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "tasks:update");
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "DONE", completedAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "task.completed",
        entityType: "Task",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies completion and performs no writes when the actor lacks tasks:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(completeTask(actor, "t1")).rejects.toThrow();
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("listAssignableUsers", () => {
  it("returns active, non-deleted users when granted tasks:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u1" },
    ] as never);

    const result = await listAssignableUsers(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "tasks:read");
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ACTIVE", deletedAt: null },
      }),
    );
    expect(result).toEqual([{ id: "u1" }]);
  });
});

describe("assignTask", () => {
  it("sets assignedToUserId and records an audit entry when granted tasks:update", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "t1", assignedToUserId: "u1" };
    vi.mocked(prisma.task.update).mockResolvedValueOnce(updated as never);

    const result = await assignTask(actor, "t1", "u1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "tasks:update");
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { assignedToUserId: "u1" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "task.assigned",
        entityType: "Task",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("allows unassigning by passing null", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.task.update).mockResolvedValueOnce({
      id: "t1",
      assignedToUserId: null,
    } as never);

    await assignTask(actor, "t1", null);

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { assignedToUserId: null },
    });
  });

  it("denies assignment and performs no writes when the actor lacks tasks:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(assignTask(actor, "t1", "u1")).rejects.toThrow();
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
