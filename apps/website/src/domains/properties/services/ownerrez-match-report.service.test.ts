import { describe, expect, it, vi } from "vitest";

const { mockListProperties } = vi.hoisted(() => ({
  mockListProperties: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    listProperties: mockListProperties,
  })),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { matchOwnerRezProperties } from "./ownerrez-match-report.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };
const PROP_1_ID = "11111111-1111-1111-1111-111111111111";

function withOwnerRezEnv() {
  process.env.OWNERREZ_USERNAME = "stayW";
  process.env.OWNERREZ_API_TOKEN = "token";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

// Matches the narrow StayWhilePropertySummary shape exactly — the real
// Prisma `select` only ever returns these four fields, never a full
// Property row (see the "narrowest possible select" test below).
function makeProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: PROP_1_ID,
    name: "Ocean Pearl",
    internalCode: "OCEAN-PEARL",
    ownerRezPropertyId: null,
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

  it("queries StayWhile properties with the narrowest possible select — only id/name/internalCode/ownerRezPropertyId, never the full row", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([] as never);
    mockListProperties.mockResolvedValueOnce([]);

    await matchOwnerRezProperties(actor);

    expect(prisma.property.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        internalCode: true,
        ownerRezPropertyId: true,
      },
    });
  });

  it("buckets an exact ownerRezPropertyId match as alreadyLinked", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      makeProperty({ ownerRezPropertyId: "42" }),
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      { id: 42, name: "Ocean Pearl", key: "ocean-pearl", active: true },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.alreadyLinked).toHaveLength(1);
    expect(result.report.proposedMatches).toEqual([]);
    expect(result.report.unmatchedOwnerRez).toEqual([]);
  });

  it("proposes a match on internal_code for an unlinked property, never auto-linking it", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      makeProperty(),
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 99,
        name: "Ocean Pearl (OwnerRez)",
        key: "ocean-pearl",
        active: true,
        internal_code: "OCEAN-PEARL",
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.proposedMatches).toHaveLength(1);
    expect(result.report.alreadyLinked).toEqual([]);
  });

  it("does not propose a match against a property already linked to a different OwnerRez id", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      makeProperty({ ownerRezPropertyId: "7" }),
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 99,
        name: "Ocean Pearl (OwnerRez)",
        key: "ocean-pearl",
        active: true,
        internal_code: "OCEAN-PEARL",
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

  it("no name-only matching: an identical name with a different internal_code stays unmatched on both sides", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const stayWhileProperty = makeProperty({
      name: "Ocean Pearl",
      internalCode: "AQUA-PALM",
    });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      stayWhileProperty,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 99,
        name: "Ocean Pearl", // same name, deliberately
        key: "ocean-pearl",
        active: true,
        internal_code: "BAHAMAS", // different internal_code
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.alreadyLinked).toEqual([]);
    expect(result.report.proposedMatches).toEqual([]);
    expect(result.report.unmatchedOwnerRez).toHaveLength(1);
    expect(result.report.unmatchedStayWhile).toEqual([stayWhileProperty]);
  });

  it("surfaces an inactive OwnerRez property in unmatchedOwnerRez rather than filtering it out", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([] as never);
    mockListProperties.mockResolvedValueOnce([
      { id: 7, name: "Old Cabin", key: "old-cabin", active: false },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.unmatchedOwnerRez).toHaveLength(1);
    expect(result.report.unmatchedOwnerRez[0]).toEqual(
      expect.objectContaining({ id: 7, active: false }),
    );
  });

  it("surfaces an inactive OwnerRez property as a proposed match too — active status never filters the report", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const stayWhileProperty = makeProperty({ internalCode: "OLD-CABIN" });
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      stayWhileProperty,
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      {
        id: 7,
        name: "Old Cabin",
        key: "old-cabin",
        active: false,
        internal_code: "OLD-CABIN",
      },
    ]);

    const result = await matchOwnerRezProperties(actor);

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.report.proposedMatches).toHaveLength(1);
    expect(result.report.proposedMatches[0]?.ownerRezProperty.active).toBe(
      false,
    );
  });

  it("is read-only: the mocked Prisma client exposes no update/create method at all, so any write attempt would hard-fail the test rather than silently succeed", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      makeProperty({ ownerRezPropertyId: "42" }),
    ] as never);
    mockListProperties.mockResolvedValueOnce([
      { id: 42, name: "Ocean Pearl", key: "ocean-pearl", active: true },
    ]);

    await matchOwnerRezProperties(actor);

    // The @stayw/database mock above defines only property.findMany —
    // no update/create exists on it. If matchOwnerRezProperties ever
    // attempted either, this test would throw a TypeError instead of
    // reaching this point.
    expect(prisma.property.findMany).toHaveBeenCalledTimes(1);
    expect(mockListProperties).toHaveBeenCalledTimes(1);
  });

  it("propagates denial when the actor lacks properties:read", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(matchOwnerRezProperties(actor)).rejects.toThrow();
    expect(mockListProperties).not.toHaveBeenCalled();
  });
});
