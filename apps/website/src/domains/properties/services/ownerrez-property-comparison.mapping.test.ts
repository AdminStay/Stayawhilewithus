import { prisma } from "@stayw/database";
import { describe, expect, it, vi } from "vitest";

import { compareOwnerRezProperty } from "../lib/ownerrez-property-comparison";

import { createPropertyFromOwnerRez } from "./ownerrez-onboarding.service";

/**
 * Proves the comparison reads OwnerRez's values the same way property
 * creation writes them: a property just created from an OwnerRez record by
 * createPropertyFromOwnerRez() must compare as Match on every field against
 * that same record. If either mapping changes alone, this test fails.
 */

const { mockGetProperty } = vi.hoisted(() => ({
  mockGetProperty: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "00000000-0000-4000-8000-000000000001",
        ...data,
      })),
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

// FABRICATED TEST FIXTURE — not a real OwnerRez property.
const FABRICATED_DETAIL = {
  id: 900001,
  name: "FABRICATED Test Property A",
  key: "fabricated-a",
  active: true,
  internal_code: "FAB-A",
  address: {
    street1: "100 Example Street",
    street2: "Unit 2",
    city: "Testville",
    state: "FL",
    postal_code: "00001",
    country: "US",
  },
  bedrooms: 3,
  bathrooms_full: 2,
  bathrooms_half: 1,
  max_guests: 8,
  time_zone: "America/New_York",
};

describe("comparison mapping matches property creation", () => {
  it("a property created from an OwnerRez record compares as Match on every field", async () => {
    process.env.OWNERREZ_USERNAME = "fabricated-user";
    process.env.OWNERREZ_API_TOKEN = "fabricated-token";
    mockGetProperty.mockResolvedValueOnce(FABRICATED_DETAIL);

    await createPropertyFromOwnerRez(
      { userId: "user-1" },
      { ownerRezPropertyId: "900001" },
    );
    const data = vi.mocked(prisma.property.create).mock.calls[0]![0].data as {
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      bedroomCount: number;
      bathroomCount: number;
      maxOccupancy: number;
      timezone: string;
    };

    const fields = compareOwnerRezProperty(
      {
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        bedroomCount: data.bedroomCount,
        bathroomCount: data.bathroomCount,
        maxOccupancy: data.maxOccupancy,
        timezone: data.timezone,
      },
      FABRICATED_DETAIL,
    );

    expect(fields.map((f) => [f.field, f.status])).toEqual([
      ["addressLine1", "match"],
      ["addressLine2", "match"],
      ["city", "match"],
      ["state", "match"],
      ["postalCode", "match"],
      ["bedrooms", "match"],
      ["bathrooms", "match"],
      ["maxGuests", "match"],
      ["timezone", "match"],
    ]);
  });
});
