import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    property: {
      findUnique: vi.fn(),
    },
    userRole: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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
  assignUserRole,
  listAssignableRoles,
  listUsersWithRoles,
  revokeUserRole,
} from "./users.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "admin-1" };

describe("listUsersWithRoles", () => {
  it("returns users with their role assignments when granted users:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u1", email: "a@b.com", userRoles: [] },
    ] as never);

    const result = await listUsersWithRoles(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "users:read");
    expect(result).toEqual([{ id: "u1", email: "a@b.com", userRoles: [] }]);
  });

  it("propagates ForbiddenError when the actor lacks users:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listUsersWithRoles(actor)).rejects.toThrow();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("listAssignableRoles", () => {
  it("returns roles when granted roles:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.role.findMany).mockResolvedValueOnce([
      { id: "r1", name: "admin" },
    ] as never);

    const result = await listAssignableRoles(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "roles:read");
    expect(result).toEqual([{ id: "r1", name: "admin" }]);
  });

  it("propagates ForbiddenError when the actor lacks roles:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listAssignableRoles(actor)).rejects.toThrow();
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });
});

describe("assignUserRole", () => {
  it("creates a new global assignment and audits it when granted roles:manage", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "r1",
      name: "ops_manager",
    } as never);
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce(null);
    const created = { id: "ur1", userId: "u1", roleId: "r1", propertyId: null };
    vi.mocked(prisma.userRole.create).mockResolvedValueOnce(created as never);

    const result = await assignUserRole(actor, "u1", { roleId: "r1" });

    expect(assertPermission).toHaveBeenCalledWith(actor, "roles:manage");
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        roleId: "r1",
        propertyId: null,
        assignedById: actor.userId,
      },
      include: { role: true, property: true },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "user_role.assigned",
        entityType: "UserRole",
        entityId: "ur1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("creates a property-scoped assignment when a propertyId is given", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "r1",
      name: "cleaner",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "p1",
    } as never);
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce(null);
    const created = { id: "ur1", userId: "u1", roleId: "r1", propertyId: "p1" };
    vi.mocked(prisma.userRole.create).mockResolvedValueOnce(created as never);

    const result = await assignUserRole(actor, "u1", {
      roleId: "r1",
      propertyId: "p1",
    });

    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        roleId: "r1",
        propertyId: "p1",
        assignedById: actor.userId,
      },
      include: { role: true, property: true },
    });
    expect(result).toEqual(created);
  });

  it("is idempotent: returns the existing assignment and performs no write when it already exists", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "r1",
      name: "ops_manager",
    } as never);
    const existing = {
      id: "ur1",
      userId: "u1",
      roleId: "r1",
      propertyId: null,
    };
    vi.mocked(prisma.userRole.findFirst).mockResolvedValueOnce(
      existing as never,
    );

    const result = await assignUserRole(actor, "u1", { roleId: "r1" });

    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it("throws NotFoundError when the target user doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      assignUserRole(actor, "missing", { roleId: "r1" }),
    ).rejects.toThrow(/not found/i);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the role doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      assignUserRole(actor, "u1", { roleId: "missing" }),
    ).rejects.toThrow(/not found/i);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the property doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "r1",
      name: "cleaner",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      assignUserRole(actor, "u1", { roleId: "r1", propertyId: "missing" }),
    ).rejects.toThrow(/not found/i);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("denies assignment and performs no writes when the actor lacks roles:manage", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      assignUserRole(actor, "u1", { roleId: "r1" }),
    ).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("revokeUserRole", () => {
  it("deletes a non-admin assignment and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const existing = {
      id: "ur1",
      userId: "u1",
      roleId: "r1",
      propertyId: null,
      role: { id: "r1", name: "ops_manager" },
      property: null,
    };
    vi.mocked(prisma.userRole.findUnique).mockResolvedValueOnce(
      existing as never,
    );
    vi.mocked(prisma.userRole.delete).mockResolvedValueOnce(existing as never);

    const result = await revokeUserRole(actor, "ur1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "roles:manage");
    expect(prisma.userRole.count).not.toHaveBeenCalled();
    expect(prisma.userRole.delete).toHaveBeenCalledWith({
      where: { id: "ur1" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "user_role.revoked",
        entityType: "UserRole",
        entityId: "ur1",
      }),
    );
    expect(result).toEqual(existing);
  });

  it("allows revoking a global admin assignment when another global admin remains", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const existing = {
      id: "ur1",
      userId: "u1",
      roleId: "admin-role",
      propertyId: null,
      role: { id: "admin-role", name: "admin" },
      property: null,
    };
    vi.mocked(prisma.userRole.findUnique).mockResolvedValueOnce(
      existing as never,
    );
    vi.mocked(prisma.userRole.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.userRole.delete).mockResolvedValueOnce(existing as never);

    const result = await revokeUserRole(actor, "ur1");

    expect(prisma.userRole.count).toHaveBeenCalledWith({
      where: { roleId: "admin-role", propertyId: null, id: { not: "ur1" } },
    });
    expect(prisma.userRole.delete).toHaveBeenCalledWith({
      where: { id: "ur1" },
    });
    expect(result).toEqual(existing);
  });

  it("throws ConflictError and performs no delete when revoking the last global admin", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const existing = {
      id: "ur1",
      userId: "u1",
      roleId: "admin-role",
      propertyId: null,
      role: { id: "admin-role", name: "admin" },
      property: null,
    };
    vi.mocked(prisma.userRole.findUnique).mockResolvedValueOnce(
      existing as never,
    );
    vi.mocked(prisma.userRole.count).mockResolvedValueOnce(0);

    await expect(revokeUserRole(actor, "ur1")).rejects.toThrow(
      /last global admin/i,
    );
    expect(prisma.userRole.delete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("allows revoking a property-scoped admin assignment without the last-admin check", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const existing = {
      id: "ur1",
      userId: "u1",
      roleId: "admin-role",
      propertyId: "p1",
      role: { id: "admin-role", name: "admin" },
      property: { id: "p1" },
    };
    vi.mocked(prisma.userRole.findUnique).mockResolvedValueOnce(
      existing as never,
    );
    vi.mocked(prisma.userRole.delete).mockResolvedValueOnce(existing as never);

    await revokeUserRole(actor, "ur1");

    expect(prisma.userRole.count).not.toHaveBeenCalled();
    expect(prisma.userRole.delete).toHaveBeenCalledWith({
      where: { id: "ur1" },
    });
  });

  it("throws NotFoundError when the assignment doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.userRole.findUnique).mockResolvedValueOnce(null as never);

    await expect(revokeUserRole(actor, "missing")).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.userRole.delete).not.toHaveBeenCalled();
  });

  it("denies revocation and performs no writes when the actor lacks roles:manage", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(revokeUserRole(actor, "ur1")).rejects.toThrow();
    expect(prisma.userRole.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.delete).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
