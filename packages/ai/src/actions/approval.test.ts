import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    aiAction: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
  Prisma: {},
}));

import { prisma } from "@stayw/database";

import {
  approveAction,
  listPendingActions,
  listRecentResolvedActions,
  markActionExecuted,
  markActionFailed,
  proposeAction,
  rejectAction,
} from "./approval";
import { InvalidActionStateError } from "./errors";

describe("proposeAction", () => {
  it("creates a PENDING action defaulting riskLevel to STANDARD", async () => {
    vi.mocked(prisma.aiAction.create).mockResolvedValue({ id: "a1" } as never);

    await proposeAction({
      toolName: "guests.message",
      proposedInput: { body: "hi" },
    });

    expect(prisma.aiAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toolName: "guests.message",
        status: "PENDING",
        riskLevel: "STANDARD",
      }),
    });
  });
});

describe("approveAction / rejectAction", () => {
  it("approves a PENDING action", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "PENDING",
    } as never);
    vi.mocked(prisma.aiAction.update).mockResolvedValue({ id: "a1" } as never);

    await approveAction("a1", "user-1");

    expect(prisma.aiAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a1" },
        data: expect.objectContaining({ status: "APPROVED" }),
      }),
    );
  });

  it("refuses to approve an action that isn't PENDING", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "EXECUTED",
    } as never);

    await expect(approveAction("a1", "user-1")).rejects.toThrow(
      InvalidActionStateError,
    );
    expect(prisma.aiAction.update).not.toHaveBeenCalled();
  });

  it("refuses to reject an action that isn't PENDING", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "REJECTED",
    } as never);

    await expect(rejectAction("a1", "user-1", "not needed")).rejects.toThrow(
      InvalidActionStateError,
    );
  });
});

describe("markActionExecuted / markActionFailed", () => {
  it("marks an APPROVED action executed", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "APPROVED",
    } as never);
    vi.mocked(prisma.aiAction.update).mockResolvedValue({ id: "a1" } as never);

    await markActionExecuted("a1", { messageId: "m1" });

    expect(prisma.aiAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXECUTED" }),
      }),
    );
  });

  it("refuses to mark a non-APPROVED action executed", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "PENDING",
    } as never);

    await expect(markActionExecuted("a1", {})).rejects.toThrow(
      InvalidActionStateError,
    );
  });

  it("refuses to mark a non-APPROVED action failed", async () => {
    vi.mocked(prisma.aiAction.findUniqueOrThrow).mockResolvedValue({
      id: "a1",
      status: "PENDING",
    } as never);

    await expect(markActionFailed("a1", "boom")).rejects.toThrow(
      InvalidActionStateError,
    );
  });
});

describe("listPendingActions", () => {
  it("queries only PENDING actions ordered oldest-first", async () => {
    vi.mocked(prisma.aiAction.findMany).mockResolvedValue([] as never);

    await listPendingActions();

    expect(prisma.aiAction.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("listRecentResolvedActions", () => {
  it("queries EXECUTED/EXECUTION_FAILED/REJECTED actions ordered newest-first, defaulting to 20", async () => {
    vi.mocked(prisma.aiAction.findMany).mockResolvedValue([] as never);

    await listRecentResolvedActions();

    expect(prisma.aiAction.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["EXECUTED", "EXECUTION_FAILED", "REJECTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
  });

  it("honors a custom limit", async () => {
    vi.mocked(prisma.aiAction.findMany).mockResolvedValue([] as never);

    await listRecentResolvedActions(5);

    expect(prisma.aiAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });
});
