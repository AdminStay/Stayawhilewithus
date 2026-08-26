import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(),
}));

import { clerkClient } from "@clerk/nextjs/server";

import {
  createClerkInvitation,
  listPendingClerkInvitations,
  pendingRoleFromPublicMetadata,
  revokeClerkInvitation,
} from "./invite-clerk-user";

describe("createClerkInvitation", () => {
  it("sends a real Clerk invitation and returns a plain summary", async () => {
    const createInvitation = vi.fn().mockResolvedValueOnce({
      id: "inv_1",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending",
      url: "https://clerk.example/accept/inv_1",
    });
    vi.mocked(clerkClient).mockResolvedValueOnce({
      invitations: { createInvitation },
    } as never);

    const result = await createClerkInvitation("new@stayawhilewithus.com");

    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@stayawhilewithus.com",
      publicMetadata: undefined,
    });
    expect(result).toEqual({
      id: "inv_1",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending",
      url: "https://clerk.example/accept/inv_1",
    });
  });

  it("carries a pending role selection as the invitation's publicMetadata", async () => {
    const createInvitation = vi.fn().mockResolvedValueOnce({
      id: "inv_2",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending",
    });
    vi.mocked(clerkClient).mockResolvedValueOnce({
      invitations: { createInvitation },
    } as never);

    await createClerkInvitation("new@stayawhilewithus.com", {
      roleId: "role-1",
      propertyId: "prop-1",
      invitedByUserId: "admin-1",
    });

    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@stayawhilewithus.com",
      publicMetadata: {
        pendingRoleId: "role-1",
        pendingPropertyId: "prop-1",
        pendingRoleInvitedByUserId: "admin-1",
      },
    });
  });

  it("stores null (not undefined) for an omitted propertyId/invitedByUserId, so a global-scope selection is explicit rather than absent", async () => {
    const createInvitation = vi.fn().mockResolvedValueOnce({
      id: "inv_3",
      emailAddress: "new@stayawhilewithus.com",
      status: "pending",
    });
    vi.mocked(clerkClient).mockResolvedValueOnce({
      invitations: { createInvitation },
    } as never);

    await createClerkInvitation("new@stayawhilewithus.com", {
      roleId: "role-1",
    });

    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@stayawhilewithus.com",
      publicMetadata: {
        pendingRoleId: "role-1",
        pendingPropertyId: null,
        pendingRoleInvitedByUserId: null,
      },
    });
  });
});

describe("pendingRoleFromPublicMetadata", () => {
  it("reads back a full pending role selection", () => {
    expect(
      pendingRoleFromPublicMetadata({
        pendingRoleId: "role-1",
        pendingPropertyId: "prop-1",
        pendingRoleInvitedByUserId: "admin-1",
      }),
    ).toEqual({
      roleId: "role-1",
      propertyId: "prop-1",
      invitedByUserId: "admin-1",
    });
  });

  it("reads back a global (no propertyId) selection", () => {
    expect(
      pendingRoleFromPublicMetadata({
        pendingRoleId: "role-1",
        pendingPropertyId: null,
      }),
    ).toEqual({
      roleId: "role-1",
      propertyId: undefined,
      invitedByUserId: undefined,
    });
  });

  it.each([
    ["null", null],
    ["a string", "not-an-object"],
    ["an empty object", {}],
    ["a non-string pendingRoleId", { pendingRoleId: 123 }],
    ["metadata from something unrelated", { someOtherKey: "value" }],
  ])("returns null for %s", (_label, input) => {
    expect(pendingRoleFromPublicMetadata(input)).toBeNull();
  });
});

describe("listPendingClerkInvitations", () => {
  it("returns only pending invitations as plain summaries", async () => {
    const getInvitationList = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "inv_1",
          emailAddress: "a@x.com",
          status: "pending",
          url: "https://clerk.example/a",
        },
      ],
    });
    vi.mocked(clerkClient).mockResolvedValueOnce({
      invitations: { getInvitationList },
    } as never);

    const result = await listPendingClerkInvitations();

    expect(getInvitationList).toHaveBeenCalledWith({ status: "pending" });
    expect(result).toEqual([
      {
        id: "inv_1",
        emailAddress: "a@x.com",
        status: "pending",
        url: "https://clerk.example/a",
      },
    ]);
  });
});

describe("revokeClerkInvitation", () => {
  it("revokes the invitation by id", async () => {
    const revokeInvitation = vi.fn().mockResolvedValueOnce({});
    vi.mocked(clerkClient).mockResolvedValueOnce({
      invitations: { revokeInvitation },
    } as never);

    await revokeClerkInvitation("inv_1");

    expect(revokeInvitation).toHaveBeenCalledWith("inv_1");
  });
});
