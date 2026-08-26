import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findUnique: vi.fn(),
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

import { APPROVED_OWNERREZ_LINKS } from "../config/ownerrez-approved-links";

import { confirmOwnerRezLink } from "./ownerrez-link.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };
const PROPERTY_ID = "11111111-1111-1111-1111-111111111111";

function makeUnlinkedProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPERTY_ID,
    name: "Aqua Palm",
    internalCode: "AQUA-PALM",
    ownerRezPropertyId: null,
    deletedAt: null,
    ...overrides,
  };
}

function uniqueConstraintError() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
  });
}

describe("APPROVED_OWNERREZ_LINKS", () => {
  it("contains exactly the six human-approved mappings", () => {
    expect(APPROVED_OWNERREZ_LINKS).toHaveLength(6);
    expect(
      APPROVED_OWNERREZ_LINKS.map((l) => l.propertyInternalCode).sort(),
    ).toEqual(
      [
        "AQUA-PALM",
        "BAHAMAS",
        "BONJOUR-AMI",
        "ISLAND-TIDES",
        "OCEAN-PEARL",
        "SANDY-NUDES",
      ].sort(),
    );
  });

  it("does not contain Miramar Bliss under any internal code", () => {
    expect(
      APPROVED_OWNERREZ_LINKS.find(
        (l) => l.propertyInternalCode === "MIRAMAR-BLISS",
      ),
    ).toBeUndefined();
    expect(
      APPROVED_OWNERREZ_LINKS.some((l) =>
        l.ownerRezPropertyName.toLowerCase().includes("miramar"),
      ),
    ).toBe(false);
  });
});

describe("confirmOwnerRezLink", () => {
  it.each(APPROVED_OWNERREZ_LINKS)(
    "links $propertyInternalCode to OwnerRez $ownerRezPropertyId and records a narrow audit entry",
    async (approved) => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      const property = makeUnlinkedProperty({
        internalCode: approved.propertyInternalCode,
        name: approved.ownerRezPropertyName,
      });
      vi.mocked(prisma.property.findUnique)
        .mockResolvedValueOnce(property as never) // load property
        .mockResolvedValueOnce(null as never); // no existing conflicting link
      const updated = {
        ...property,
        ownerRezPropertyId: approved.ownerRezPropertyId,
      };
      vi.mocked(prisma.property.update).mockResolvedValueOnce(updated as never);

      const result = await confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: approved.ownerRezPropertyId,
      });

      expect(assertPermission).toHaveBeenCalledWith(actor, "properties:update");
      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: PROPERTY_ID },
        data: { ownerRezPropertyId: approved.ownerRezPropertyId },
      });
      // The single-field update call's `data` has exactly one key.
      expect(
        Object.keys(vi.mocked(prisma.property.update).mock.calls[0]![0].data),
      ).toEqual(["ownerRezPropertyId"]);

      expect(recordAudit).toHaveBeenCalledWith({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "property.ownerrez_matched",
        entityType: "Property",
        entityId: PROPERTY_ID,
        beforeState: { ownerRezPropertyId: null },
        afterState: { ownerRezPropertyId: approved.ownerRezPropertyId },
        metadata: {
          propertyName: property.name,
          propertyInternalCode: approved.propertyInternalCode,
          ownerRezPropertyId: approved.ownerRezPropertyId,
          ownerRezPropertyName: approved.ownerRezPropertyName,
        },
      });
      expect(result).toEqual(updated);
    },
  );

  it.each(["389173", "410682", "480401"])(
    "rejects Miramar Bliss even for its real OwnerRez candidate id %s — the service itself refuses it, not just the UI",
    async (miramarOwnerRezId) => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
        makeUnlinkedProperty({
          name: "Miramar Bliss",
          internalCode: "MIRAMAR-BLISS",
        }) as never,
      );

      await expect(
        confirmOwnerRezLink(actor, {
          propertyId: PROPERTY_ID,
          ownerRezPropertyId: miramarOwnerRezId,
        }),
      ).rejects.toThrow("not approved for OwnerRez linking");

      expect(prisma.property.update).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it("rejects a tampered OwnerRez ID for an otherwise-approved property", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
      makeUnlinkedProperty({ internalCode: "AQUA-PALM" }) as never,
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "999999", // not Aqua Palm's approved 386471
      }),
    ).rejects.toThrow("does not match the approved mapping");

    expect(prisma.property.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects an internalCode with no approved entry at all", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
      makeUnlinkedProperty({
        internalCode: "SOME-OTHER-PROPERTY",
        name: "Some Other Property",
      }) as never,
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "123456",
      }),
    ).rejects.toThrow("not approved for OwnerRez linking");

    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  it("rejects a property that is already linked", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
      makeUnlinkedProperty({ ownerRezPropertyId: "555555" }) as never,
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("already linked to an OwnerRez property");

    expect(prisma.property.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects when the approved OwnerRez id is already linked to a different StayWhile property (pre-check)", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(makeUnlinkedProperty() as never) // the target property
      .mockResolvedValueOnce({
        id: "different-property-id",
        ownerRezPropertyId: "386471",
      } as never); // conflicting existing link

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("already linked to a different StayWhile property");

    expect(prisma.property.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("translates a Prisma unique-constraint race (P2002) into the same safe domain error, never a raw exception", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(makeUnlinkedProperty() as never)
      .mockResolvedValueOnce(null as never); // pre-check passes...
    vi.mocked(prisma.property.update).mockRejectedValueOnce(
      uniqueConstraintError(),
    ); // ...but a concurrent request wins the race

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("already linked to a different StayWhile property");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated database error from the update call", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(makeUnlinkedProperty() as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.property.update).mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("connection reset");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("denies the confirmation and performs no reads or writes when the actor lacks properties:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("ForbiddenError");

    expect(prisma.property.findUnique).not.toHaveBeenCalled();
    expect(prisma.property.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects when the property does not exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("Property not found");

    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  it("rejects when the property is soft-deleted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
      makeUnlinkedProperty({ deletedAt: new Date() }) as never,
    );

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow("Property not found");

    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed propertyId before any database call", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: "not-a-uuid",
        ownerRezPropertyId: "386471",
      }),
    ).rejects.toThrow();

    expect(prisma.property.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an empty ownerRezPropertyId before any database call", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(
      confirmOwnerRezLink(actor, {
        propertyId: PROPERTY_ID,
        ownerRezPropertyId: "",
      }),
    ).rejects.toThrow();

    expect(prisma.property.findUnique).not.toHaveBeenCalled();
  });
});
