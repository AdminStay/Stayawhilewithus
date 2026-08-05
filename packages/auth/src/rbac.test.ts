import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    userRole: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@stayw/database";

import { ForbiddenError } from "./errors";
import { assertPermission, hasPermission } from "./rbac";

function mockUserRoles(
  roles: Array<{ propertyId: string | null; permissionKeys: string[] }>,
) {
  vi.mocked(prisma.userRole.findMany).mockResolvedValue(
    roles.map((r) => ({
      role: {
        rolePermissions: r.permissionKeys.map((key) => ({
          permission: { key },
        })),
      },
      propertyId: r.propertyId,
    })) as never,
  );
}

describe("hasPermission", () => {
  it("grants access via a global role", async () => {
    mockUserRoles([{ propertyId: null, permissionKeys: ["properties:read"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(true);
  });

  it("denies access when the permission is absent", async () => {
    mockUserRoles([{ propertyId: null, permissionKeys: ["properties:read"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:delete"),
    ).resolves.toBe(false);
  });

  it("grants access via a property-scoped role when propertyId matches", async () => {
    mockUserRoles([{ propertyId: "prop-1", permissionKeys: ["tasks:update"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "tasks:update", { propertyId: "prop-1" }),
    ).resolves.toBe(true);
  });
});

describe("assertPermission", () => {
  it("throws ForbiddenError when access is denied", async () => {
    mockUserRoles([]);
    await expect(
      assertPermission({ userId: "u1" }, "properties:delete"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("resolves silently when access is granted", async () => {
    mockUserRoles([
      { propertyId: null, permissionKeys: ["properties:delete"] },
    ]);
    await expect(
      assertPermission({ userId: "u1" }, "properties:delete"),
    ).resolves.toBeUndefined();
  });
});
