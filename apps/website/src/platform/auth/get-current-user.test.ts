import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@stayw/database";

import { getCurrentUser } from "./get-current-user";

function mockClerkUser(
  overrides: Partial<{
    firstName: string | null;
    lastName: string | null;
    imageUrl: string;
  }> = {},
) {
  return {
    emailAddresses: [
      { id: "email-1", emailAddress: "admin@stayawhilewithus.com" },
    ],
    primaryEmailAddressId: "email-1",
    firstName: overrides.firstName ?? "StayWhile",
    lastName: overrides.lastName ?? "Admin",
    imageUrl: overrides.imageUrl ?? "https://example.com/avatar.png",
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
    } as never);

    const result = await getCurrentUser();

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk-1" },
    });
    expect(result).toEqual({ userId: "user-1" });
    expect(clerkClient).not.toHaveBeenCalled();
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
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "seeded-admin-id",
      clerkUserId: "seed_pending_clerk_link",
      email: "admin@stayawhilewithus.com",
      firstName: "StayWhile",
      lastName: "Admin",
      avatarUrl: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: "seeded-admin-id",
    } as never);

    const result = await getCurrentUser();

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: "admin@stayawhilewithus.com" },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({ clerkUserId: "clerk-real-1" }),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    // Same row id as the seeded user — its existing UserRole assignments
    // (e.g. the seeded global "admin" role) carry over automatically.
    expect(result).toEqual({ userId: "seeded-admin-id" });
  });

  it("creates a brand-new row when neither clerkUserId nor email match anything", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "clerk-new-1" } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(clerkClient).mockResolvedValueOnce({
      users: {
        getUser: vi.fn().mockResolvedValueOnce({
          ...mockClerkUser(),
          emailAddresses: [
            { id: "email-2", emailAddress: "new@stayawhilewithus.com" },
          ],
          primaryEmailAddressId: "email-2",
        }),
      },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
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
    expect(result).toEqual({ userId: "brand-new-id" });
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
