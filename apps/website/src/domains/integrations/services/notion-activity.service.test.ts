import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertPermission, mockFindMany } = vi.hoisted(() => ({
  mockAssertPermission: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: mockAssertPermission,
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    notionPageEvent: {
      findMany: mockFindMany,
    },
  },
}));

import { listRecentNotionActivity } from "./notion-activity.service";

const ACTOR = { userId: "user-1" };

describe("listRecentNotionActivity", () => {
  beforeEach(() => {
    mockAssertPermission.mockReset().mockResolvedValue(undefined);
    mockFindMany.mockReset().mockResolvedValue([]);
  });

  it("enforces notion:read before querying anything", async () => {
    await listRecentNotionActivity(ACTOR);
    expect(mockAssertPermission).toHaveBeenCalledWith(ACTOR, "notion:read");
  });

  it("propagates a permission denial and never queries", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("ForbiddenError"));
    await expect(listRecentNotionActivity(ACTOR)).rejects.toThrow(
      "ForbiddenError",
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("orders by most recent first and defaults to a 20-row limit", async () => {
    await listRecentNotionActivity(ACTOR);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { occurredAt: "desc" },
      take: 20,
    });
  });

  it("respects an explicit limit override", async () => {
    await listRecentNotionActivity(ACTOR, 5);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { occurredAt: "desc" },
      take: 5,
    });
  });

  it("reduces changedFieldNames to a count, never exposing the raw ids/values to the caller", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "row-1",
        entityId: "page-1",
        entityType: "page",
        eventType: "page.properties_updated",
        changedFieldNames: ["prop-a", "prop-b", "prop-c"],
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
      },
    ]);

    const result = await listRecentNotionActivity(ACTOR);

    expect(result).toEqual([
      {
        id: "row-1",
        entityId: "page-1",
        entityType: "page",
        eventType: "page.properties_updated",
        changedFieldCount: 3,
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
      },
    ]);
  });

  it("defaults changedFieldCount to 0 when changedFieldNames isn't an array", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "row-1",
        entityId: "page-1",
        entityType: "page",
        eventType: "page.deleted",
        changedFieldNames: null,
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
      },
    ]);

    const result = await listRecentNotionActivity(ACTOR);
    expect(result[0]?.changedFieldCount).toBe(0);
  });
});
