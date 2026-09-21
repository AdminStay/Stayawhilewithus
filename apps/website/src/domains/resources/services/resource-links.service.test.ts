import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    resourceLink: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
  createResourceLink,
  deleteResourceLink,
  listResourceLinks,
  updateResourceLink,
} from "./resource-links.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const createInput = {
  name: "Pool maintenance vendor",
  url: "https://example.com/pool-vendor",
  description: "",
  category: "VENDOR" as const,
  propertyId: "",
};

describe("listResourceLinks", () => {
  it("returns only non-deleted resources when granted resource_links:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.resourceLink.findMany).mockResolvedValueOnce([
      { id: "r1" },
    ] as never);

    const result = await listResourceLinks(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "resource_links:read");
    expect(prisma.resourceLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("propagates denial when the actor lacks resource_links:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listResourceLinks(actor)).rejects.toThrow();
    expect(prisma.resourceLink.findMany).not.toHaveBeenCalled();
  });
});

describe("createResourceLink", () => {
  it("creates the resource, converting blank optional fields to undefined, and records an audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "r1", name: "Pool maintenance vendor" };
    vi.mocked(prisma.resourceLink.create).mockResolvedValueOnce(
      created as never,
    );

    const result = await createResourceLink(actor, createInput);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "resource_links:create",
    );
    expect(prisma.resourceLink.create).toHaveBeenCalledWith({
      data: {
        name: "Pool maintenance vendor",
        url: "https://example.com/pool-vendor",
        description: undefined,
        category: "VENDOR",
        propertyId: undefined,
        createdByUserId: actor.userId,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "resource_link.created",
        entityType: "ResourceLink",
        entityId: "r1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks resource_links:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createResourceLink(actor, createInput)).rejects.toThrow();
    expect(prisma.resourceLink.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("updateResourceLink", () => {
  const updateInput = { ...createInput, id: "r1" };

  it("updates the resource and records an audit entry when granted resource_links:update", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "r1", name: "Pool maintenance vendor" };
    vi.mocked(prisma.resourceLink.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await updateResourceLink(actor, updateInput);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "resource_links:update",
    );
    expect(prisma.resourceLink.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        name: "Pool maintenance vendor",
        url: "https://example.com/pool-vendor",
        description: null,
        category: "VENDOR",
        propertyId: null,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "resource_link.updated",
        entityType: "ResourceLink",
        entityId: "r1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies update and performs no writes when the actor lacks resource_links:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(updateResourceLink(actor, updateInput)).rejects.toThrow();
    expect(prisma.resourceLink.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("deleteResourceLink", () => {
  it("soft-deletes (sets deletedAt) rather than removing the row, and records an audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const deleted = { id: "r1", deletedAt: new Date() };
    vi.mocked(prisma.resourceLink.update).mockResolvedValueOnce(
      deleted as never,
    );

    const result = await deleteResourceLink(actor, "r1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "resource_links:delete",
    );
    expect(prisma.resourceLink.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "resource_link.deleted",
        entityType: "ResourceLink",
        entityId: "r1",
      }),
    );
    expect(result).toEqual(deleted);
  });

  it("denies deletion and performs no writes when the actor lacks resource_links:delete", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(deleteResourceLink(actor, "r1")).rejects.toThrow();
    expect(prisma.resourceLink.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
