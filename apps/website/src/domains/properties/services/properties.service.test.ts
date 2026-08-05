import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/ai-automation", () => ({
  triggerWorkflow: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { triggerWorkflow } from "@stayw/ai-automation";
import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { createProperty, listProperties } from "./properties.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const propertyInput = {
  name: "Test Cabin",
  internalCode: "TC-001",
  addressLine1: "1 Test Way",
  city: "Denver",
  state: "CO",
  postalCode: "80202",
  country: "USA",
  propertyType: "CABIN" as const,
  bedroomCount: 2,
  bathroomCount: 1,
  maxOccupancy: 4,
  timezone: "America/Denver",
};

describe("listProperties", () => {
  it("returns properties when the actor is granted properties:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      { id: "p1" },
    ] as never);

    const result = await listProperties(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:read");
    expect(result).toEqual([{ id: "p1" }]);
  });

  it("propagates ForbiddenError when the actor is denied", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listProperties(actor)).rejects.toThrow();
    expect(prisma.property.findMany).not.toHaveBeenCalled();
  });
});

describe("createProperty", () => {
  it("creates the property, records an audit entry, and triggers a workflow when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const created = { id: "p1", ...propertyInput };
    vi.mocked(prisma.property.create).mockResolvedValueOnce(created as never);

    const result = await createProperty(actor, propertyInput);

    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:create");
    expect(prisma.property.create).toHaveBeenCalledWith({
      data: propertyInput,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "property.created",
        entityType: "Property",
        entityId: "p1",
      }),
    );
    expect(triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: "property.created",
        relatedEntityId: "p1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks properties:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createProperty(actor, propertyInput)).rejects.toThrow();
    expect(prisma.property.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(triggerWorkflow).not.toHaveBeenCalled();
  });
});
