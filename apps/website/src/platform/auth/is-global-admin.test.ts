import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: { userRole: { findFirst: vi.fn() } },
}));

import { prisma } from "@stayw/database";

import { hasGlobalRole, isGlobalAdmin } from "./is-global-admin";

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
        role: { name: { in: ["admin"] } },
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

describe("hasGlobalRole (2026-10-07)", () => {
  it("matches any of the named roles, held globally and unexpired", async () => {
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce({
      id: "ur-2",
    } as never);

    expect(await hasGlobalRole(actor, ["admin", "staff"])).toBe(true);
    expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        propertyId: null,
        role: { name: { in: ["admin", "staff"] } },
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      select: { id: true },
    });
  });

  it("is false (and makes no query) for an empty role list", async () => {
    expect(await hasGlobalRole(actor, [])).toBe(false);
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

  it("is false when no matching role exists (e.g. a not-yet-created 'staff' role)", async () => {
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce(null);

    expect(await hasGlobalRole(actor, ["staff"])).toBe(false);
  });
});
