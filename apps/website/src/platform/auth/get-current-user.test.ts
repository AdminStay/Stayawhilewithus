import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/platform/identity/sync-clerk-user", () => ({
  applyPendingRoleFromInvitation: vi.fn(),
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@stayw/database";

import { getCurrentUser } from "./get-current-user";

import { applyPendingRoleFromInvitation } from "@/platform/identity/sync-clerk-user";

function mockClerkUser(
  overrides: Partial<{
    firstName: string | null;
    lastName: string | null;
    imageUrl: string;
    email: string;
    publicMetadata: unknown;
  }> = {},
) {
  return {
    emailAddresses: [
      {
        id: "email-1",
        emailAddress: overrides.email ?? "admin@stayawhilewithus.com",
      },
    ],
    primaryEmailAddressId: "email-1",
    firstName: overrides.firstName ?? "StayWhile",
    lastName: overrides.lastName ?? "Admin",
    imageUrl: overrides.imageUrl ?? "https://example.com/avatar.png",
    publicMetadata: overrides.publicMetadata,
  };
}

describe("getCurrentUser", () => {
  it("throws when called outside an authenticated request", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    await expect(getCurrentUser()).rejects.toThrow(/outside an authenticated/);
  });

  it("returns the existing row immediately when clerkUserId already matches", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
      status: "ACTIVE",
      deletedAt: null,
    } as never);

    const result = await getCurrentUser();

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk-1" },
    });
    expect(result).toEqual({ userId: "user-1" });
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("throws AccountDeactivatedError when the matched clerkUserId row is deactivated", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
      status: "DEACTIVATED",
      deletedAt: null,
    } as never);

    await expect(getCurrentUser()).rejects.toThrow(/deactivated/i);
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("throws AccountDeactivatedError when the matched clerkUserId row is soft-deleted", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
      status: "ACTIVE",
      deletedAt: new Date(),
    } as never);

    await expect(getCurrentUser()).rejects.toThrow(/deactivated/i);
  });

  it("claims a pre-existing row by email (e.g. the seeded bootstrap admin) instead of creating a second one", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-real-1" } as never);
    // No row yet under this real Clerk id...
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: { getUser: vi.fn().mockResolvedValueOnce(mockClerkUser()) },
    } as never);
    // ...but the seed script already created one for this email, with a
    // placeholder clerkUserId, and it already has role assignments.
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      clerkUserId: "seed_pending_clerk_link",
      email: "admin@stayawhilewithus.com",
      firstName: "StayWhile",
      lastName: "Admin",
      avatarUrl: null,
      status: "ACTIVE",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "seeded-admin-id",
      status: "ACTIVE",
      deletedAt: null,
    } as never);

    const result = await getCurrentUser();

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "admin@stayawhilewithus.com", mode: "insensitive" },
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({
        clerkUserId: "clerk-real-1",
        email: "admin@stayawhilewithus.com",
      }),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    // Same row id as the seeded user — its existing UserRole assignments
    // (e.g. the seeded global "admin" role) carry over automatically.
    expect(result).toEqual({ userId: "seeded-admin-id" });
  });

  it("claims the same row regardless of email casing (Admin@x.com vs admin@x.com)", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-real-2" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: {
        getUser: vi
          .fn()
          .mockResolvedValueOnce(
            mockClerkUser({ email: "Admin@StayAWhileWithUs.com" }),
          ),
      },
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      email: "admin@stayawhilewithus.com",
      status: "ACTIVE",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "seeded-admin-id",
      status: "ACTIVE",
      deletedAt: null,
    } as never);

    const result = await getCurrentUser();

    // Lookup and storage both normalize to lowercase, so mixed-case Clerk
    // input still matches the already-lowercase seeded row.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "admin@stayawhilewithus.com", mode: "insensitive" },
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({ email: "admin@stayawhilewithus.com" }),
    });
    expect(result).toEqual({ userId: "seeded-admin-id" });
  });

  it("throws AccountDeactivatedError when the claimed-by-email row is deactivated", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-real-3" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: { getUser: vi.fn().mockResolvedValueOnce(mockClerkUser()) },
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "former-employee-id",
      email: "admin@stayawhilewithus.com",
      status: "DEACTIVATED",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "former-employee-id",
      status: "DEACTIVATED",
      deletedAt: null,
    } as never);

    await expect(getCurrentUser()).rejects.toThrow(/deactivated/i);
  });

  it("creates a brand-new row (with lowercased email) when neither clerkUserId nor email match anything, and applies any pending role from invitation metadata", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-new-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: {
        getUser: vi.fn().mockResolvedValueOnce(
          mockClerkUser({
            email: "New@StayAWhileWithUs.com",
            publicMetadata: { pendingRoleId: "role-1" },
          }),
        ),
      },
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "brand-new-id",
    } as never);

    const result = await getCurrentUser();

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clerkUserId: "clerk-new-1",
        email: "new@stayawhilewithus.com",
      }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(applyPendingRoleFromInvitation).toHaveBeenCalledWith(
      "brand-new-id",
      { pendingRoleId: "role-1" },
    );
    expect(result).toEqual({ userId: "brand-new-id" });
  });

  it("does not apply any pending role when claiming a pre-existing row by email (not a brand-new creation)", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-real-4" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: {
        getUser: vi
          .fn()
          .mockResolvedValueOnce(
            mockClerkUser({ publicMetadata: { pendingRoleId: "role-1" } }),
          ),
      },
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: "seeded-admin-id",
      email: "admin@stayawhilewithus.com",
      status: "ACTIVE",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "seeded-admin-id",
      status: "ACTIVE",
      deletedAt: null,
    } as never);

    await getCurrentUser();

    expect(applyPendingRoleFromInvitation).not.toHaveBeenCalled();
  });

  it("throws when the Clerk user has no primary email address", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: {
        getUser: vi.fn().mockResolvedValueOnce({
          emailAddresses: [],
          primaryEmailAddressId: null,
          firstName: null,
          lastName: null,
          imageUrl: "",
        }),
      },
    } as never);

    await expect(getCurrentUser()).rejects.toThrow(/no primary email address/);
  });
});
