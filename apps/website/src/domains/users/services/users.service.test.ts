import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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

vi.mock("@/platform/identity/invite-clerk-user", () => ({
  createClerkInvitation: vi.fn(),
  listPendingClerkInvitations: vi.fn(),
  revokeClerkInvitation: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  assignUserRole,
  deactivateTeamMember,
  inviteTeamMember,
  listAssignableRoles,
  listPendingInvitations,
  listUsersWithRoles,
  revokeInvitation,
  revokeUserRole,
} from "./users.service";

import { recordAudit } from "@/platform/audit/record-audit";
import {
  createClerkInvitation,
  listPendingClerkInvitations,
  revokeClerkInvitation,
} from "@/platform/identity/invite-clerk-user";

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
  it("returns roles with their granted permissions when granted roles:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const rolesWithPermissions = [
      {
        id: "r1",
        name: "admin",
        rolePermissions: [
          { permission: { key: "properties:read" } },
          { permission: { key: "properties:manage" } },
        ],
      },
    ];
    vi.mocked(prisma.role.findMany).mockResolvedValueOnce(
      rolesWithPermissions as never,
    );

    const result = await listAssignableRoles(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "roles:read");
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      include: { rolePermissions: { include: { permission: true } } },
    });
    expect(result).toEqual(rolesWithPermissions);
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

describe("inviteTeamMember", () => {
  it("sends a Clerk invitation and audits it when granted users:create", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    const invitation = {
      id: "inv1",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending" as const,
      url: "https://clerk.example/accept/inv1",
    };
    vi.mocked(createClerkInvitation).mockResolvedValueOnce(invitation);

    const result = await inviteTeamMember(actor, {
      email: "New@StayAWhileWithUs.com",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "users:create");
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "new@stayawhilewithus.com", mode: "insensitive" },
      },
    });
    expect(createClerkInvitation).toHaveBeenCalledWith(
      "new@stayawhilewithus.com",
      undefined,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "team_member.invited",
        entityType: "ClerkInvitation",
        entityId: "inv1",
      }),
    );
    expect(result).toEqual(invitation);
  });

  it("validates and carries a pending role selection onto the invitation when roleId is given", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "role-1",
      name: "ops_manager",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "prop-1",
    } as never);
    const invitation = {
      id: "inv2",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending" as const,
    };
    vi.mocked(createClerkInvitation).mockResolvedValueOnce(invitation);

    await inviteTeamMember(actor, {
      email: "new@stayawhilewithus.com",
      roleId: "role-1",
      propertyId: "prop-1",
    });

    expect(prisma.role.findUnique).toHaveBeenCalledWith({
      where: { id: "role-1" },
    });
    expect(prisma.property.findUnique).toHaveBeenCalledWith({
      where: { id: "prop-1" },
    });
    expect(createClerkInvitation).toHaveBeenCalledWith(
      "new@stayawhilewithus.com",
      { roleId: "role-1", propertyId: "prop-1", invitedByUserId: actor.userId },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          email: "new@stayawhilewithus.com",
          roleId: "role-1",
          propertyId: "prop-1",
        },
      }),
    );
  });

  it("throws NotFoundError and sends no invitation when the given roleId doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce(null);

    await expect(
      inviteTeamMember(actor, {
        email: "new@stayawhilewithus.com",
        roleId: "missing-role",
      }),
    ).rejects.toThrow(/not found/i);
    expect(createClerkInvitation).not.toHaveBeenCalled();
  });

  it("throws NotFoundError and sends no invitation when the given propertyId doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "role-1",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null);

    await expect(
      inviteTeamMember(actor, {
        email: "new@stayawhilewithus.com",
        roleId: "role-1",
        propertyId: "missing-property",
      }),
    ).rejects.toThrow(/not found/i);
    expect(createClerkInvitation).not.toHaveBeenCalled();
  });

  it("throws ConflictError and sends no invitation when a user with that email already exists", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "u1",
    } as never);

    await expect(
      inviteTeamMember(actor, { email: "existing@stayawhilewithus.com" }),
    ).rejects.toThrow(/already exists/i);
    expect(createClerkInvitation).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("denies inviting and sends no invitation when the actor lacks users:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      inviteTeamMember(actor, { email: "new@stayawhilewithus.com" }),
    ).rejects.toThrow();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(createClerkInvitation).not.toHaveBeenCalled();
  });
});

describe("listPendingInvitations", () => {
  it("returns pending invitations when granted users:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(listPendingClerkInvitations).mockResolvedValueOnce([
      { id: "inv1", emailAddress: "a@b.com", status: "pending" },
    ]);

    const result = await listPendingInvitations(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "users:read");
    expect(result).toEqual([
      { id: "inv1", emailAddress: "a@b.com", status: "pending" },
    ]);
  });

  it("propagates ForbiddenError when the actor lacks users:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listPendingInvitations(actor)).rejects.toThrow();
    expect(listPendingClerkInvitations).not.toHaveBeenCalled();
  });
});

describe("revokeInvitation", () => {
  it("revokes the invitation and audits it when granted users:delete", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(revokeClerkInvitation).mockResolvedValueOnce(undefined);

    await revokeInvitation(actor, "inv1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "users:delete");
    expect(revokeClerkInvitation).toHaveBeenCalledWith("inv1");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "team_member.invitation_revoked",
        entityType: "ClerkInvitation",
        entityId: "inv1",
      }),
    );
  });

  it("denies revocation and performs no writes when the actor lacks users:delete", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(revokeInvitation(actor, "inv1")).rejects.toThrow();
    expect(revokeClerkInvitation).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("deactivateTeamMember", () => {
  it("deactivates a non-admin user (status only, not deletedAt) and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      userRoles: [
        { roleId: "ops-role", propertyId: null, role: { name: "ops_manager" } },
      ],
    } as never);
    const deactivated = { id: "u1", status: "DEACTIVATED" };
    vi.mocked(prisma.user.update).mockResolvedValueOnce(deactivated as never);

    const result = await deactivateTeamMember(actor, "u1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "users:delete");
    expect(prisma.userRole.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { status: "DEACTIVATED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "team_member.deactivated",
        entityType: "User",
        entityId: "u1",
      }),
    );
    expect(result).toEqual(deactivated);
  });

  it("allows deactivating a global admin when another global admin remains", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      userRoles: [
        { roleId: "admin-role", propertyId: null, role: { name: "admin" } },
      ],
    } as never);
    vi.mocked(prisma.userRole.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "u1",
      status: "DEACTIVATED",
    } as never);

    await deactivateTeamMember(actor, "u1");

    expect(prisma.userRole.count).toHaveBeenCalledWith({
      where: { roleId: "admin-role", propertyId: null, userId: { not: "u1" } },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { status: "DEACTIVATED" },
    });
  });

  it("throws ConflictError and performs no update when deactivating the last global admin", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      userRoles: [
        { roleId: "admin-role", propertyId: null, role: { name: "admin" } },
      ],
    } as never);
    vi.mocked(prisma.userRole.count).mockResolvedValueOnce(0);

    await expect(deactivateTeamMember(actor, "u1")).rejects.toThrow(
      /last global admin/i,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("allows deactivating a user whose admin grant is property-scoped, without the last-admin check", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      userRoles: [
        { roleId: "admin-role", propertyId: "p1", role: { name: "admin" } },
      ],
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "u1",
      status: "DEACTIVATED",
    } as never);

    await deactivateTeamMember(actor, "u1");

    expect(prisma.userRole.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { status: "DEACTIVATED" },
    });
  });

  it("throws NotFoundError when the target user doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    await expect(deactivateTeamMember(actor, "missing")).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("denies deactivation and performs no writes when the actor lacks users:delete", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(deactivateTeamMember(actor, "u1")).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
