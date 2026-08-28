import { describe, expect, it, vi } from "vitest";

const { mockGetProperty } = vi.hoisted(() => ({
  mockGetProperty: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    getProperty: mockGetProperty,
  })),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  createPropertyFromOwnerRez,
  enrichUnmatchedOwnerRezProperties,
} from "./ownerrez-onboarding.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

function withOwnerRezEnv() {
  process.env.OWNERREZ_USERNAME = "stayW";
  process.env.OWNERREZ_API_TOKEN = "token";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function uniqueConstraintError() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
  });
}

function makeOwnerRezProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: 431354,
    name: "Ocean Pearl",
    key: "ocean-pearl",
    active: true,
    internal_code: "OCEAN-PEARL",
    ...overrides,
  };
}

function makeFullDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 431354,
    name: "Ocean Pearl",
    key: "ocean-pearl",
    active: true,
    internal_code: "OCEAN-PEARL",
    address: {
      street1: "2330 Kings Point Dr",
      city: "Largo",
      state: "FL",
      postal_code: "33774",
      country: "US",
    },
    bedrooms: 6,
    bathrooms_full: 4,
    bathrooms_half: 1,
    max_guests: 14,
    time_zone: "America/New_York",
    property_type: "House",
    ...overrides,
  };
}

describe("enrichUnmatchedOwnerRezProperties", () => {
  it("splits into active/inactive and fetches detail only for active properties", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const active = makeOwnerRezProperty({ id: 1, active: true });
    const inactive = makeOwnerRezProperty({ id: 2, active: false });
    mockGetProperty.mockResolvedValueOnce(makeFullDetail({ id: 1 }));

    const report = await enrichUnmatchedOwnerRezProperties(actor, [
      active,
      inactive,
    ]);

    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:read");
    expect(mockGetProperty).toHaveBeenCalledTimes(1);
    expect(mockGetProperty).toHaveBeenCalledWith(1);
    expect(report.active).toHaveLength(1);
    expect(report.active[0]!.detail).not.toBeNull();
    expect(report.inactive).toHaveLength(1);
    expect(report.inactive[0]!.detail).toBeNull();
    restoreEnv();
  });

  it("never fetches more than DETAIL_CONCURRENCY (5) details at once", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    let inFlight = 0;
    let maxInFlight = 0;
    mockGetProperty.mockImplementation(async (id: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return makeFullDetail({ id });
    });
    const active = Array.from({ length: 12 }, (_, i) =>
      makeOwnerRezProperty({ id: i + 1, active: true }),
    );

    await enrichUnmatchedOwnerRezProperties(actor, active);

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(mockGetProperty).toHaveBeenCalledTimes(12);
    restoreEnv();
  });

  it("a failed detail fetch for one property leaves its detail null without affecting its batch-mates", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockGetProperty
      .mockResolvedValueOnce(makeFullDetail({ id: 1 }))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(makeFullDetail({ id: 3 }));
    const active = [1, 2, 3].map((id) =>
      makeOwnerRezProperty({ id, active: true }),
    );

    const report = await enrichUnmatchedOwnerRezProperties(actor, active);

    expect(
      report.active.find((s) => s.ownerRezProperty.id === 1)!.detail,
    ).not.toBeNull();
    expect(
      report.active.find((s) => s.ownerRezProperty.id === 2)!.detail,
    ).toBeNull();
    expect(
      report.active.find((s) => s.ownerRezProperty.id === 3)!.detail,
    ).not.toBeNull();
    restoreEnv();
  });

  it("returns every active property with a null detail, and never calls OwnerRez, when not configured", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const active = makeOwnerRezProperty({ active: true });

    const report = await enrichUnmatchedOwnerRezProperties(actor, [active]);

    expect(mockGetProperty).not.toHaveBeenCalled();
    expect(report.active).toEqual([{ ownerRezProperty: active, detail: null }]);
  });
});

describe("createPropertyFromOwnerRez", () => {
  it("creates a Property with fields mapped from OwnerRez's detail response, at ONBOARDING status", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(null as never) // no existing ownerRezPropertyId link
      .mockResolvedValueOnce(null as never); // no existing internalCode
    mockGetProperty.mockResolvedValueOnce(makeFullDetail());
    const created = { id: "new-property-uuid" };
    vi.mocked(prisma.property.create).mockResolvedValueOnce(created as never);

    const result = await createPropertyFromOwnerRez(actor, {
      ownerRezPropertyId: "431354",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:create");
    expect(prisma.property.create).toHaveBeenCalledWith({
      data: {
        name: "Ocean Pearl",
        internalCode: "OCEAN-PEARL",
        addressLine1: "2330 Kings Point Dr",
        addressLine2: undefined,
        city: "Largo",
        state: "FL",
        postalCode: "33774",
        country: "US",
        latitude: undefined,
        longitude: undefined,
        propertyType: "OTHER",
        bedroomCount: 6,
        bathroomCount: 4.5,
        maxOccupancy: 14,
        timezone: "America/New_York",
        ownerRezPropertyId: "431354",
        status: "ONBOARDING",
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "property.created_from_ownerrez",
        entityType: "Property",
        entityId: "new-property-uuid",
      }),
    );
    expect(result).toEqual(created);
    restoreEnv();
  });

  it.each([
    ["name", { name: undefined }],
    ["internal_code", { internal_code: undefined }],
    ["address.street1", { address: { city: "Largo" } }],
    ["bedrooms", { bedrooms: undefined }],
    ["max_guests", { max_guests: undefined }],
  ])(
    "refuses to create and names the missing field when %s is absent from OwnerRez's detail",
    async (label, overrides) => {
      withOwnerRezEnv();
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
        null as never,
      );
      mockGetProperty.mockResolvedValueOnce(makeFullDetail(overrides));

      await expect(
        createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
      ).rejects.toThrow(new RegExp(label.replace(".", "\\.")));

      expect(prisma.property.create).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
      restoreEnv();
    },
  );

  describe("timezone fallback", () => {
    it("uses OwnerRez's own time_zone as-is when present, ignoring any submitted override", async () => {
      withOwnerRezEnv();
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);
      mockGetProperty.mockResolvedValueOnce(
        makeFullDetail({ time_zone: "America/New_York" }),
      );
      vi.mocked(prisma.property.create).mockResolvedValueOnce({} as never);

      await createPropertyFromOwnerRez(actor, {
        ownerRezPropertyId: "431354",
        timezoneOverride: "America/Chicago",
      });

      expect(prisma.property.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ timezone: "America/New_York" }),
        }),
      );
      restoreEnv();
    });

    it("rejects when time_zone is absent and no timezoneOverride was provided, without inferring anything from the property's real address", async () => {
      withOwnerRezEnv();
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
        null as never,
      );
      // Real, fully-populated address (Bradenton, FL) — proves the
      // rejection isn't a side effect of missing address data, and that a
      // real address never gets used to guess a timezone.
      mockGetProperty.mockResolvedValueOnce(
        makeFullDetail({
          time_zone: undefined,
          address: {
            street1: "2012 37th St W",
            city: "Bradenton",
            state: "FL",
            postal_code: "34205",
            country: "US",
          },
        }),
      );

      await expect(
        createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
      ).rejects.toThrow(/timezone is not set/i);

      expect(prisma.property.create).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
      restoreEnv();
    });

    it("uses a valid admin-selected timezoneOverride as the fallback when OwnerRez's own time_zone is absent", async () => {
      withOwnerRezEnv();
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);
      mockGetProperty.mockResolvedValueOnce(
        makeFullDetail({ time_zone: undefined }),
      );
      vi.mocked(prisma.property.create).mockResolvedValueOnce({} as never);

      await createPropertyFromOwnerRez(actor, {
        ownerRezPropertyId: "431354",
        timezoneOverride: "America/Chicago",
      });

      expect(prisma.property.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ timezone: "America/Chicago" }),
        }),
      );
      restoreEnv();
    });

    it("rejects an unsupported timezoneOverride value not on the curated allowlist", async () => {
      withOwnerRezEnv();
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(
        null as never,
      );
      mockGetProperty.mockResolvedValueOnce(
        makeFullDetail({ time_zone: undefined }),
      );

      await expect(
        createPropertyFromOwnerRez(actor, {
          ownerRezPropertyId: "431354",
          timezoneOverride: "Mars/OlympusMons",
        }),
      ).rejects.toThrow(/not a supported onboarding timezone/i);

      expect(prisma.property.create).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
      restoreEnv();
    });
  });

  it("accepts bathrooms_full alone with no bathrooms_half (treats missing half as zero)", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    mockGetProperty.mockResolvedValueOnce(
      makeFullDetail({ bathrooms_full: 3, bathrooms_half: undefined }),
    );
    vi.mocked(prisma.property.create).mockResolvedValueOnce({} as never);

    await createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" });

    expect(prisma.property.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bathroomCount: 3 }),
      }),
    );
    restoreEnv();
  });

  it("rejects when this OwnerRez property is already linked to a StayWhile property", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "existing",
    } as never);

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
    ).rejects.toThrow("already linked");

    expect(mockGetProperty).not.toHaveBeenCalled();
    expect(prisma.property.create).not.toHaveBeenCalled();
    restoreEnv();
  });

  it("rejects when a StayWhile property already has this internal code", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "existing-code" } as never);
    mockGetProperty.mockResolvedValueOnce(makeFullDetail());

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
    ).rejects.toThrow("already exists");

    expect(prisma.property.create).not.toHaveBeenCalled();
    restoreEnv();
  });

  it("translates a Prisma unique-constraint race (P2002) into a safe domain error", async () => {
    withOwnerRezEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    mockGetProperty.mockResolvedValueOnce(makeFullDetail());
    vi.mocked(prisma.property.create).mockRejectedValueOnce(
      uniqueConstraintError(),
    );

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
    ).rejects.toThrow("already linked");

    expect(recordAudit).not.toHaveBeenCalled();
    restoreEnv();
  });

  it("rejects when OwnerRez isn't configured", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
    ).rejects.toThrow("isn't configured");

    expect(mockGetProperty).not.toHaveBeenCalled();
  });

  it("denies creation and performs no reads/writes when the actor lacks properties:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "431354" }),
    ).rejects.toThrow("ForbiddenError");

    expect(prisma.property.findUnique).not.toHaveBeenCalled();
    expect(prisma.property.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects an empty ownerRezPropertyId before any database call", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(
      createPropertyFromOwnerRez(actor, { ownerRezPropertyId: "" }),
    ).rejects.toThrow();

    expect(prisma.property.findUnique).not.toHaveBeenCalled();
  });
});
