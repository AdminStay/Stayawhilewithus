import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: { userRole: { findFirst: vi.fn() } },
}));

import { prisma } from "@stayw/database";

import { isGlobalAdmin } from "./is-global-admin";

const actor = { userId: "user-1" };

describe("isGlobalAdmin", () => {
  it("looks for an unexpired, GLOBAL (propertyId null) admin role for the actor", async () => {
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce({
      id: "ur-1",
    } as never);

    expect(await isGlobalAdmin(actor)).toBe(true);
    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        propertyId: null,
        role: { name: "admin" },
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      select: { id: true },
    });
  });

  it("is false without such a role (other roles, property-scoped or expired admin)", async () => {
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce(null);

    expect(await isGlobalAdmin(actor)).toBe(false);
  });
});
