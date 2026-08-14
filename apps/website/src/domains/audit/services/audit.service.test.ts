import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    auditLog: { findMany: vi.fn() },
    workflowExecution: { findMany: vi.fn() },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { listAuditLogs, listWorkflowExecutions } from "./audit.service";

const actor = { userId: "user-1" };

describe("listAuditLogs", () => {
  it("returns recent audit entries with actor relation when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { id: "log1" },
    ] as never);

    const result = await listAuditLogs(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "audit_logs:read");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { occurredAt: "desc" },
        include: { actorUser: true },
      }),
    );
    expect(result).toEqual([{ id: "log1" }]);
  });

  it("propagates denial when the actor lacks audit_logs:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listAuditLogs(actor)).rejects.toThrow();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("listWorkflowExecutions", () => {
  it("returns recent workflow executions when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.workflowExecution.findMany).mockResolvedValueOnce([
      { id: "we1" },
    ] as never);

    const result = await listWorkflowExecutions(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "audit_logs:read");
    expect(prisma.workflowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startedAt: "desc" } }),
    );
    expect(result).toEqual([{ id: "we1" }]);
  });

  it("propagates denial when the actor lacks audit_logs:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listWorkflowExecutions(actor)).rejects.toThrow();
    expect(prisma.workflowExecution.findMany).not.toHaveBeenCalled();
  });
});
