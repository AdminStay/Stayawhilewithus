import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: { smartDeviceEvent: { findMany: vi.fn() } },
}));
vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { getRecentUnknownTransitionCounts } from "./lock-health.service";

const actor = { userId: "user-1" };
const NOW = new Date("2026-09-26T00:00:00.000Z");

beforeEach(() => {
  vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.smartDeviceEvent.findMany).mockReset();
});

describe("getRecentUnknownTransitionCounts", () => {
  it("requires smart_devices:read and queries only LOCK_STATE_CHANGED rows from the last 24h for the given locks", async () => {
    vi.mocked(prisma.smartDeviceEvent.findMany).mockResolvedValueOnce([]);

    await getRecentUnknownTransitionCounts(actor, ["sd-1"], NOW);

    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect(prisma.smartDeviceEvent.findMany).toHaveBeenCalledWith({
      where: {
        smartDeviceId: { in: ["sd-1"] },
        eventType: "LOCK_STATE_CHANGED",
        occurredAt: { gte: new Date("2026-09-25T00:00:00.000Z") },
      },
      select: { smartDeviceId: true, payload: true },
    });
  });

  it("counts only transitions INTO unknown, per lock", async () => {
    vi.mocked(prisma.smartDeviceEvent.findMany).mockResolvedValueOnce([
      { smartDeviceId: "sd-1", payload: { from: "locked", to: "unknown" } },
      { smartDeviceId: "sd-1", payload: { from: "unknown", to: "locked" } },
      { smartDeviceId: "sd-1", payload: { from: "locked", to: "unknown" } },
      { smartDeviceId: "sd-2", payload: { from: "locked", to: "unlocked" } },
    ] as never);

    const counts = await getRecentUnknownTransitionCounts(
      actor,
      ["sd-1", "sd-2"],
      NOW,
    );

    expect(counts.get("sd-1")).toBe(2);
    expect(counts.has("sd-2")).toBe(false);
  });

  it("makes no query for an empty id list", async () => {
    const counts = await getRecentUnknownTransitionCounts(actor, [], NOW);
    expect(counts.size).toBe(0);
    expect(prisma.smartDeviceEvent.findMany).not.toHaveBeenCalled();
  });
});
