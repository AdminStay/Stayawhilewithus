import { describe, expect, it, vi } from "vitest";

const { mockListProperties, mockGetProperty, mockRecordAudit } = vi.hoisted(
  () => ({
    mockListProperties: vi.fn(),
    mockGetProperty: vi.fn(),
    mockRecordAudit: vi.fn().mockResolvedValue({}),
  }),
);

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    listProperties: mockListProperties,
    getProperty: mockGetProperty,
  })),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  confirmOwnerRezPropertyMatch,
  matchOwnerRezProperties,
  syncLinkedOwnerRezProperties,
} from "./ownerrez-sync.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };
const PROP_1_ID = "11111111-1111-1111-1111-111111111111";
const PROP_2_ID = "22222222-2222-2222-2222-222222222222";

function withOwnerRezEnv() {
  process.env.OWNERREZ_USERNAME = "stayW";
  process.env.OWNERREZ_API_TOKEN = "token";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function makeProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: PROP_1_ID,
    name: "Ocean Pearl",
    internalCode: "OCEAN-PEARL",
    ownerRezPropertyId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("matchOwnerRezProperties", () => {
  it("returns configured:false without calling OwnerRez when credentials are unset", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await matchOwnerRezProperties(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListProperties).not.toHaveBeenCalled();
  });

  it("buckets an exact ownerRezPropertyId match as alreadyLinked", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const linkedProperty = makeProperty({ ownerRezPropertyId: "42" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      linkedProperty,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      { id: 42, name: "Ocean Pearl", key: "ocean-pearl", active: true },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.alreadyLinked).toEqual([
      {
        property: linkedProperty,
        ownerRezProperty: {
          id: 42,
          name: "Ocean Pearl",
          key: "ocean-pearl",
          active: true,
        },
      },
    ]);
    expect(result.report.proposedMatches).toEqual([]);
  });

  it("proposes a match on internalCode for an unlinked property, never auto-linking it", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const unlinkedProperty = makeProperty();
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      unlinkedProperty,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 99,
        name: "Ocean Pearl OR",
        key: "ocean-pearl-or",
        active: true,
        internal_code: "ocean-pearl",
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.proposedMatches).toHaveLength(1);
    expect(result.report.proposedMatches[0]?.property).toBe(unlinkedProperty);
    expect(result.report.alreadyLinked).toEqual([]);
    expect(result.report.unmatchedStayWhile).toEqual([]);
  });

  it("does not propose a match against a property already linked to a different OwnerRez id", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const linkedToSomethingElse = makeProperty({ ownerRezPropertyId: "7" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      linkedToSomethingElse,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 99,
        name: "Ocean Pearl OR",
        key: "ocean-pearl-or",
        active: true,
        internal_code: "ocean-pearl",
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.proposedMatches).toEqual([]);
    expect(result.report.unmatchedOwnerRez).toHaveLength(1);
  });

  it("reports unmatched on both sides when nothing lines up", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const stayWhileOnly = makeProperty({ internalCode: "AQUA-PALM" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      stayWhileOnly,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 5,
        name: "Bahamas",
        key: "bahamas",
        active: true,
        internal_code: "BAHAMAS",
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.unmatchedOwnerRez).toHaveLength(1);
    expect(result.report.unmatchedStayWhile).toEqual([stayWhileOnly]);
  });
});

describe("confirmOwnerRezPropertyMatch", () => {
  it("links the property and records an audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const property = makeProperty();
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(property as never) // fetch by propertyId
      .mockResolvedValueOnce(null as never); // no existing link to this OwnerRez id
    const updated = { ...property, ownerRezPropertyId: "42" };
    vi.mocked(prisma.property.update).mockResolvedValueOnce(updated as never);

    const result = await confirmOwnerRezPropertyMatch(actor, {
      propertyId: PROP_1_ID,
      ownerRezPropertyId: "42",
    });

    expect(result).toEqual(updated);
    expect(prisma.property.update).toHaveBeenCalledWith({
      where: { id: PROP_1_ID },
      data: { ownerRezPropertyId: "42" },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "property.ownerrez_matched" }),
    );
  });

  it("rejects when the property is already linked to an OwnerRez property", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
      makeProperty({ ownerRezPropertyId: "7" }) as never,
    );

    await expect(
      confirmOwnerRezPropertyMatch(actor, {
        propertyId: PROP_1_ID,
        ownerRezPropertyId: "42",
      }),
    ).rejects.toThrow(/already linked/);
    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  it("rejects when the OwnerRez property is already linked to a different StayWhile property", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(makeProperty() as never)
      .mockResolvedValueOnce(makeProperty({ id: PROP_2_ID }) as never);

    await expect(
      confirmOwnerRezPropertyMatch(actor, {
        propertyId: PROP_1_ID,
        ownerRezPropertyId: "42",
      }),
    ).rejects.toThrow(/already linked to a different/);
    expect(prisma.property.update).not.toHaveBeenCalled();
  });
});

describe("syncLinkedOwnerRezProperties", () => {
  it("throws a clear error when OwnerRez isn't configured, without querying the database", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(syncLinkedOwnerRezProperties(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(prisma.property.findMany).not.toHaveBeenCalled();
  });

  it("only overwrites fields OwnerRez actually returned, leaving absent fields untouched", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const linked = makeProperty({ ownerRezPropertyId: "42" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      linked,
    ] as never);
    mockGetProperty.mockResolvedValueOnce({
      id: 42,
      name: "Ocean Pearl",
      key: "ocean-pearl",
      active: true,
      bedrooms: 3,
      // no address, no bathrooms, no max_guests — must not appear in the update payload
    });
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...linked,
    } as never);

    const result = await syncLinkedOwnerRezProperties(actor);

    expect(result).toEqual({ synced: 1, skipped: [] });
    const call = vi.mocked(prisma.property.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).toMatchObject({
      name: "Ocean Pearl",
      bedroomCount: 3,
      ownerRezActive: true,
    });
    expect(call.data).not.toHaveProperty("addressLine1");
    expect(call.data).not.toHaveProperty("bathroomCount");
    expect(call.data).not.toHaveProperty("maxOccupancy");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "property.ownerrez_synced" }),
    );
  });

  it("derives bathroomCount from full+half counts", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const linked = makeProperty({ ownerRezPropertyId: "42" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      linked,
    ] as never);
    mockGetProperty.mockResolvedValueOnce({
      id: 42,
      name: "Ocean Pearl",
      key: "ocean-pearl",
      active: true,
      bathrooms_full: 2,
      bathrooms_half: 1,
    });
    vi.mocked(prisma.property.update).mockResolvedValueOnce({
      ...linked,
    } as never);

    await syncLinkedOwnerRezProperties(actor);

    const call = vi.mocked(prisma.property.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).toMatchObject({ bathroomCount: 2.5 });
  });

  it("skips a property with a malformed ownerRezPropertyId instead of throwing", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const malformed = makeProperty({ ownerRezPropertyId: "not-a-number" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      malformed,
    ] as never);

    const result = await syncLinkedOwnerRezProperties(actor);

    expect(result.synced).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(mockGetProperty).not.toHaveBeenCalled();
  });

  it("skips a property when the live OwnerRez call fails, without throwing", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const linked = makeProperty({ ownerRezPropertyId: "42" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      linked,
    ] as never);
    mockGetProperty.mockRejectedValueOnce(new Error("404"));

    const result = await syncLinkedOwnerRezProperties(actor);

    expect(result).toEqual({
      synced: 0,
      skipped: [{ propertyId: PROP_1_ID, reason: "404" }],
    });
    expect(prisma.property.update).not.toHaveBeenCalled();
  });
});
