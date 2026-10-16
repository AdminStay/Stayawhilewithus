import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import { OwnerrezRequestBudgetError } from "@stayw/integrations/ownerrez";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compareLinkedOwnerRezProperties } from "./ownerrez-property-comparison.service";

const m = vi.hoisted(() => ({
  getProperty: vi.fn(),
  usage: {
    requestsMade: 0,
    requestBudget: null as number | null,
    rateLimited: false,
  },
  clientOptions: [] as unknown[],
}));

// Every Prisma write method a comparison could conceivably reach is a spy
// here, so the tests can prove none of them is ever called.
vi.mock("@stayw/database", () => ({
  prisma: {
    property: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    integrationSyncLog: { create: vi.fn(), update: vi.fn() },
    integrationConnection: { update: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/ownerrez", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/ownerrez")>();
  return {
    ...actual,
    OwnerrezClient: vi.fn().mockImplementation((_creds, options) => {
      m.clientOptions.push(options);
      return {
        getProperty: m.getProperty,
        get usage() {
          return m.usage;
        },
      };
    }),
  };
});

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

// FABRICATED TEST FIXTURES — not real StayWhile or OwnerRez data. Names,
// ids, addresses and counts are invented for these tests only.
function fabricatedProperty(
  n: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    name: `FABRICATED Test Property ${n}`,
    internalCode: `FAB-${n}`,
    status: "ACTIVE",
    ownerRezPropertyId: String(900000 + n),
    addressLine1: `${n}00 Example Street`,
    addressLine2: null,
    city: "Testville",
    state: "FL",
    postalCode: "00001",
    bedroomCount: 3,
    // Prisma returns Decimal; anything with toString() stands in for it.
    bathroomCount: { toString: () => "2.5" },
    maxOccupancy: 8,
    timezone: "America/New_York",
    ...overrides,
  };
}

function fabricatedDetail(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 900000 + n,
    name: `FABRICATED OwnerRez Listing ${n}`,
    key: `fabricated-${n}`,
    active: true,
    address: {
      street1: `${n}00 Example Street`,
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
    ...overrides,
  };
}

function expectNoWrites() {
  const p = vi.mocked(prisma);
  for (const fn of [
    p.property.update,
    p.property.updateMany,
    p.property.upsert,
    p.property.create,
    p.property.delete,
    p.integrationSyncLog.create,
    p.integrationSyncLog.update,
    p.integrationConnection.update,
    p.integrationConnection.upsert,
    p.auditLog.create,
    p.$executeRaw,
    p.$transaction,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getProperty.mockReset();
  m.usage = { requestsMade: 0, requestBudget: null, rateLimited: false };
  m.clientOptions = [];
  process.env.OWNERREZ_USERNAME = "fabricated-user";
  process.env.OWNERREZ_API_TOKEN = "fabricated-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("compareLinkedOwnerRezProperties", () => {
  it("requires properties:read and stops there when it's refused", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(compareLinkedOwnerRezProperties(actor)).rejects.toThrow(
      "Forbidden",
    );
    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:read");
    expect(prisma.property.findMany).not.toHaveBeenCalled();
    expect(m.getProperty).not.toHaveBeenCalled();
  });

  it("returns not configured, reading and requesting nothing, without OwnerRez credentials", async () => {
    delete process.env.OWNERREZ_API_TOKEN;
    const result = await compareLinkedOwnerRezProperties(actor);
    expect(result).toEqual({ configured: false });
    expect(prisma.property.findMany).not.toHaveBeenCalled();
    expect(m.getProperty).not.toHaveBeenCalled();
  });

  it("reads only linked, non-deleted properties, selecting only the compared columns", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([] as never);
    await compareLinkedOwnerRezProperties(actor);
    const args = vi.mocked(prisma.property.findMany).mock.calls[0]![0]!;
    expect(args.where).toEqual({
      deletedAt: null,
      ownerRezPropertyId: { not: null },
    });
    expect(Object.keys(args.select!).sort()).toEqual(
      [
        "id",
        "name",
        "internalCode",
        "status",
        "ownerRezPropertyId",
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "postalCode",
        "bedroomCount",
        "bathroomCount",
        "maxOccupancy",
        "timezone",
      ].sort(),
    );
  });

  it("compares each property with OwnerRez's detail fetched by its exact linked id, and writes nothing", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2, { bedroomCount: 4 }),
    ] as never);
    m.getProperty.mockImplementation(async (id: number) =>
      fabricatedDetail(id - 900000),
    );

    const result = await compareLinkedOwnerRezProperties(actor);

    expect(m.getProperty.mock.calls.map((c) => c[0])).toEqual([900001, 900002]);
    expect(m.clientOptions).toEqual([{ requestBudget: 2 }]);
    if (!result.configured) throw new Error("expected configured");
    expect(result.rateLimited).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.property).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      name: "FABRICATED Test Property 1",
      internalCode: "FAB-1",
      status: "ACTIVE",
      ownerRezPropertyId: "900001",
    });
    expect(result.rows[0]!.ownerRezName).toBe("FABRICATED OwnerRez Listing 1");
    expect(result.rows[0]!.counts.match).toBe(9);
    expect(
      result.rows[1]!.fields.find((f) => f.field === "bedrooms"),
    ).toMatchObject({ status: "differs", stayWhile: "4", ownerRez: "3" });
    expectNoWrites();
  });

  it("fetches in batches of at most five concurrent requests", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce(
      Array.from({ length: 7 }, (_, i) => fabricatedProperty(i + 1)) as never,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    m.getProperty.mockImplementation(async (id: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return fabricatedDetail(id - 900000);
    });

    await compareLinkedOwnerRezProperties(actor);

    expect(m.getProperty).toHaveBeenCalledTimes(7);
    expect(maxInFlight).toBe(5);
  });

  it("a failed fetch affects only that property", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2),
    ] as never);
    m.getProperty.mockImplementation(async (id: number) => {
      if (id === 900001) throw new HttpRequestError("/properties/900001", 404);
      return fabricatedDetail(id - 900000);
    });

    const result = await compareLinkedOwnerRezProperties(actor);
    if (!result.configured) throw new Error("expected configured");

    expect(result.rows[0]!.unavailableReason).toBe("not_found");
    expect(result.rows[0]!.counts.ownerrez_unavailable).toBe(9);
    expect(result.rows[0]!.ownerRezName).toBeNull();
    expect(result.rows[1]!.unavailableReason).toBeNull();
    expect(result.rows[1]!.counts.match).toBe(9);
  });

  it("after HTTP 429 the remaining properties show 'rate limited' and nothing is retried", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2),
      fabricatedProperty(3),
    ] as never);
    m.getProperty.mockImplementation(async (id: number) => {
      if (id === 900001) return fabricatedDetail(1);
      m.usage = { ...m.usage, rateLimited: true };
      throw new OwnerrezRequestBudgetError("RATE_LIMITED");
    });

    const result = await compareLinkedOwnerRezProperties(actor);
    if (!result.configured) throw new Error("expected configured");

    expect(m.getProperty).toHaveBeenCalledTimes(3);
    expect(result.rateLimited).toBe(true);
    expect(result.rows.map((r) => r.unavailableReason)).toEqual([
      null,
      "rate_limited",
      "rate_limited",
    ]);
    expectNoWrites();
  });

  it("maps any other error to a fixed reason, never passing the raw error message through", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
    ] as never);
    m.getProperty.mockRejectedValueOnce(
      new Error("raw upstream detail that must not reach the page"),
    );

    const result = await compareLinkedOwnerRezProperties(actor);
    if (!result.configured) throw new Error("expected configured");

    expect(result.rows[0]!.unavailableReason).toBe("request_failed");
    expect(JSON.stringify(result)).not.toContain("raw upstream detail");
  });

  it("never requests an invalid stored OwnerRez id; that row is shown as an invalid link", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { ownerRezPropertyId: "not-a-number" }),
      fabricatedProperty(2),
    ] as never);
    m.getProperty.mockImplementation(async (id: number) =>
      fabricatedDetail(id - 900000),
    );

    const result = await compareLinkedOwnerRezProperties(actor);
    if (!result.configured) throw new Error("expected configured");

    expect(m.getProperty.mock.calls.map((c) => c[0])).toEqual([900002]);
    expect(m.clientOptions).toEqual([{ requestBudget: 1 }]);
    expect(result.rows[0]!.unavailableReason).toBe("invalid_link_id");
    expect(result.rows[0]!.counts.ownerrez_unavailable).toBe(9);
  });

  it("includes every linked property whatever its status", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { status: "INACTIVE" }),
      fabricatedProperty(2, { status: "OFFBOARDED" }),
      fabricatedProperty(3, { status: "ONBOARDING" }),
    ] as never);
    m.getProperty.mockImplementation(async (id: number) =>
      fabricatedDetail(id - 900000),
    );

    const result = await compareLinkedOwnerRezProperties(actor);
    if (!result.configured) throw new Error("expected configured");

    expect(result.rows.map((r) => r.property.status)).toEqual([
      "INACTIVE",
      "OFFBOARDED",
      "ONBOARDING",
    ]);
  });

  it("logs nothing (no field values or credentials reach the console)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (k) => vi.spyOn(console, k).mockImplementation(() => {}),
    );
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2),
    ] as never);
    m.getProperty
      .mockResolvedValueOnce(fabricatedDetail(1))
      .mockRejectedValueOnce(new Error("boom"));

    await compareLinkedOwnerRezProperties(actor);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
