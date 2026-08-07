import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@stayw/database";

import { syncClerkUserFromWebhookEvent } from "./sync-clerk-user";

function userEvent(
  type: "user.created" | "user.updated",
  overrides: Partial<{
    id: string;
    email: string;
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
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never) // no row by clerkUserId
      .mockResolvedValueOnce({
        id: "seeded-admin-id",
        clerkUserId: "seed_pending_clerk_link",
        email: "admin@stayawhilewithus.com",
      } as never); // but one exists by email

    await syncClerkUserFromWebhookEvent(userEvent("user.created"));

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: "admin@stayawhilewithus.com" },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-admin-id" },
      data: expect.objectContaining({ clerkUserId: "clerk-1" }),
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a brand-new row when neither clerkUserId nor email match anything", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "brand-new-id",
    } as never);

    await syncClerkUserFromWebhookEvent(
      userEvent("user.created", {
        id: "clerk-new",
        email: "new@stayawhilewithus.com",
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
