import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
    },
    property: {
      findUnique: vi.fn(),
    },
    userRole: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { prisma } from "@stayw/database";

import {
  applyPendingRoleFromInvitation,
  syncClerkUserFromWebhookEvent,
} from "./sync-clerk-user";

import { recordAudit } from "@/platform/audit/record-audit";

function userEvent(
  type: "user.created" | "user.updated",
  overrides: Partial<{
    id: string;
    email: string;
    public_metadata: unknown;
  }> = {},
) {
  return {
    type,
    data: {
      id: overrides.id ?? "clerk-1",
      email_addresses: [
        {
          id: "email-1",
          email_address: overrides.email ?? "admin@stayawhilewithus.com",
        },
      ],
      primary_email_address_id: "email-1",
      first_name: "StayWhile",
      last_name: "Admin",
      image_url: "https://example.com/avatar.png",
      public_metadata: overrides.public_metadata,
    },
  } as never;
}

describe("syncClerkUserFromWebhookEvent", () => {
  it("updates the existing row when clerkUserId already matches", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
    } as never);

    await syncClerkUserFromWebhookEvent(userEvent("user.updated"));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk-1" },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ email: "admin@stayawhilewithus.com" }),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("claims a pre-existing row by email (e.g. the seeded bootstrap admin) instead of creating a second one", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never); // no row by clerkUserId
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      clerkUserId: "seed_pending_clerk_link",
      email: "admin@stayawhilewithus.com",
    } as never); // but one exists by email

    await syncClerkUserFromWebhookEvent(userEvent("user.created"));

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "admin@stayawhilewithus.com", mode: "insensitive" },
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({
        clerkUserId: "clerk-1",
        email: "admin@stayawhilewithus.com",
      }),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("claims the same row regardless of email casing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      email: "admin@stayawhilewithus.com",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.created", { email: "Admin@StayAWhileWithUs.com" }),
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "admin@stayawhilewithus.com", mode: "insensitive" },
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({ email: "admin@stayawhilewithus.com" }),
    });
  });

  it("creates a brand-new row (with lowercased email) when neither clerkUserId nor email match anything", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "brand-new-id",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.created", {
        id: "clerk-new",
        email: "New@StayAWhileWithUs.com",
      }),
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clerkUserId: "clerk-new",
        email: "new@stayawhilewithus.com",
      }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("applies a pending role from the invitation's publicMetadata only on brand-new creation", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "brand-new-id",
    } as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "role-1",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "prop-1",
    } as never);
    vi.mocked(prisma.userRole.create).mockResolvedValueOnce({
      id: "userrole-1",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.created", {
        id: "clerk-new",
        email: "new@stayawhilewithus.com",
        public_metadata: {
          pendingRoleId: "role-1",
          pendingPropertyId: "prop-1",
          pendingRoleInvitedByUserId: "admin-1",
        },
      }),
    );

    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: "brand-new-id",
        roleId: "role-1",
        propertyId: "prop-1",
        assignedById: "admin-1",
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        actorType: "SYSTEM",
        action: "user_role.assigned_from_invitation",
        entityType: "UserRole",
        entityId: "userrole-1",
      }),
    );
  });

  it("does not apply any pending role when claiming a pre-existing row by email (not a brand-new creation)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      email: "admin@stayawhilewithus.com",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.created", {
        public_metadata: { pendingRoleId: "role-1" },
      }),
    );

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("does not apply any pending role on a plain update to an already-synced row", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.updated", {
        public_metadata: { pendingRoleId: "role-1" },
      }),
    );

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("does nothing when the event has no primary email address", async () => {
    const event = {
      type: "user.created",
      data: {
        id: "clerk-1",
        email_addresses: [],
        primary_email_address_id: null,
        first_name: null,
        last_name: null,
        image_url: "",
      },
    } as never;

    await syncClerkUserFromWebhookEvent(event);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("soft-deletes on user.deleted", async () => {
    vi.mocked(prisma.user.update).mockResolvedValueOnce({} as never);

    await syncClerkUserFromWebhookEvent({
      type: "user.deleted",
      data: { id: "clerk-1" },
    } as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk-1" },
      data: expect.objectContaining({ status: "DEACTIVATED" }),
    });
  });

  it("swallows the error when the deleted Clerk user was never synced locally", async () => {
    vi.mocked(prisma.user.update).mockRejectedValueOnce(new Error("not found"));

    await expect(
      syncClerkUserFromWebhookEvent({
        type: "user.deleted",
        data: { id: "clerk-never-synced" },
      } as never),
    ).resolves.toBeUndefined();
  });

  it("ignores unrecognized event types", async () => {
    await syncClerkUserFromWebhookEvent({
      type: "session.created",
      data: {},
    } as never);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("applyPendingRoleFromInvitation", () => {
  it("does nothing when publicMetadata carries no pending role", async () => {
    await applyPendingRoleFromInvitation("user-1", null);
    await applyPendingRoleFromInvitation("user-1", undefined);
    await applyPendingRoleFromInvitation("user-1", { someOtherKey: "value" });

    expect(prisma.role.findUnique).not.toHaveBeenCalled();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("skips silently (does not throw) when the pending role no longer exists", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce(null);

    await expect(
      applyPendingRoleFromInvitation("user-1", {
        pendingRoleId: "deleted-role",
      }),
    ).resolves.toBeUndefined();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("skips silently (does not throw) when the pending property no longer exists", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "role-1",
    } as never);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null);

    await expect(
      applyPendingRoleFromInvitation("user-1", {
        pendingRoleId: "role-1",
        pendingPropertyId: "deleted-property",
      }),
    ).resolves.toBeUndefined();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("applies a global (no propertyId) pending role with no invitedByUserId as a system-attributed grant", async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: "role-1",
    } as never);
    vi.mocked(prisma.userRole.create).mockResolvedValueOnce({
      id: "userrole-1",
    } as never);

    await applyPendingRoleFromInvitation("user-1", {
      pendingRoleId: "role-1",
    });

    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        roleId: "role-1",
        propertyId: null,
        assignedById: null,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: undefined, actorType: "SYSTEM" }),
    );
  });
});
