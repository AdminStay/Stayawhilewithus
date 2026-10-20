import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import { OwnerrezRequestBudgetError } from "@stayw/integrations/ownerrez";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_GUESTS_SYNC_AUDIT_ACTION,
  syncMaxGuestsFromOwnerRez,
  usableMaxGuests,
} from "./ownerrez-max-guests-sync.service";

import { recordAudit } from "@/platform/audit/record-audit";

const m = vi.hoisted(() => ({
  getProperty: vi.fn(),
  usage: { rateLimited: false },
  clientOptions: [] as unknown[],
  tx: { property: { update: vi.fn() }, auditLog: { create: vi.fn() } },
}));

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
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: vi.fn() }));

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
let logSpy: ReturnType<typeof vi.spyOn>;

// FABRICATED TEST FIXTURES — not real StayWhile or OwnerRez data.
function fabricatedProperty(
  n: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    name: `FABRICATED Test Property ${n}`,
    ownerRezPropertyId: String(900000 + n),
    maxOccupancy: 8,
    ...overrides,
  };
}

function fabricatedDetail(n: number, maxGuests: unknown) {
  return {
    id: 900000 + n,
    name: `FABRICATED OwnerRez Listing ${n}`,
    key: `fabricated-${n}`,
    active: true,
    bedrooms: 99, // never read by this sync
    time_zone: "America/Chicago", // never read by this sync
    max_guests: maxGuests,
  };
}

function detailsByOwnerRezId(map: Record<number, unknown>) {
  m.getProperty.mockImplementation(async (id: number) => {
    const value = map[id];
    if (value instanceof Error) throw value;
    return value;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.usage.rateLimited = false;
  m.clientOptions.length = 0;
  process.env.OWNERREZ_USERNAME = "fabricated-user";
  process.env.OWNERREZ_API_TOKEN = "fabricated-token";
  vi.mocked(prisma.$transaction).mockImplementation((async (
    fn: (tx: unknown) => unknown,
  ) => fn(m.tx)) as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  logSpy.mockRestore();
});

describe("usableMaxGuests", () => {
  it.each([
    [1, 1],
    [14, 14],
    [null, null],
    [undefined, null],
    [0, null],
    [-2, null],
    [2.5, null],
    ["12", null],
    [Number.NaN, null],
  ])("%j → %j", (input, expected) => {
    expect(usableMaxGuests(input)).toBe(expected);
  });
});

describe("syncMaxGuestsFromOwnerRez", () => {
  it("requires properties:update and reads nothing when denied", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(syncMaxGuestsFromOwnerRez(actor)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "properties:update");
    expect(prisma.property.findMany).not.toHaveBeenCalled();
    expect(m.getProperty).not.toHaveBeenCalled();
  });

  it("returns not configured without credentials and makes no request", async () => {
    delete process.env.OWNERREZ_API_TOKEN;
    expect(await syncMaxGuestsFromOwnerRez(actor)).toEqual({
      configured: false,
    });
    expect(prisma.property.findMany).not.toHaveBeenCalled();
    expect(m.getProperty).not.toHaveBeenCalled();
  });

  it("reads only linked, non-deleted properties", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([]);
    await syncMaxGuestsFromOwnerRez(actor);
    expect(prisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, ownerRezPropertyId: { not: null } },
      }),
    );
  });

  it("updates only maxOccupancy when OwnerRez differs, and audits before/after in the same transaction", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { maxOccupancy: 12 }),
    ] as never);
    detailsByOwnerRezId({ 900001: fabricatedDetail(1, 14) });

    const result = await syncMaxGuestsFromOwnerRez(actor);

    expect(m.tx.property.update).toHaveBeenCalledTimes(1);
    expect(m.tx.property.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-4000-8000-000000000001" },
      data: { maxOccupancy: 14 },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        action: MAX_GUESTS_SYNC_AUDIT_ACTION,
        entityType: "Property",
        entityId: "00000000-0000-4000-8000-000000000001",
        beforeState: { maxOccupancy: 12 },
        afterState: { maxOccupancy: 14, ownerRezPropertyId: "900001" },
      }),
      m.tx,
    );
    // Never written outside the transaction.
    expect(prisma.property.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      configured: true,
      rateLimited: false,
      counts: { updated: 1, unchanged: 0, skipped_blank: 0, failed: 0 },
      results: [
        {
          propertyId: "00000000-0000-4000-8000-000000000001",
          propertyName: "FABRICATED Test Property 1",
          outcome: "updated",
          before: 12,
          after: 14,
        },
      ],
    });
  });

  it("writes nothing and audits nothing when the value is unchanged", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { maxOccupancy: 10 }),
    ] as never);
    detailsByOwnerRezId({ 900001: fabricatedDetail(1, 10) });

    const result = await syncMaxGuestsFromOwnerRez(actor);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      counts: { updated: 0, unchanged: 1, skipped_blank: 0, failed: 0 },
      results: [{ outcome: "unchanged", before: 10, after: 10 }],
    });
  });

  it.each([null, undefined, 0, 2.5, "14"])(
    "never overwrites with a blank or invalid OwnerRez value (%j)",
    async (maxGuests) => {
      vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
        fabricatedProperty(1, { maxOccupancy: 10 }),
      ] as never);
      detailsByOwnerRezId({ 900001: fabricatedDetail(1, maxGuests) });

      const result = await syncMaxGuestsFromOwnerRez(actor);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        counts: { skipped_blank: 1 },
        results: [{ outcome: "skipped_blank", before: 10, after: 10 }],
      });
    },
  );

  it("leaves a property untouched when its OwnerRez read fails", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2, { maxOccupancy: 4 }),
    ] as never);
    detailsByOwnerRezId({
      900001: new HttpRequestError("/properties/900001", 500),
      900002: fabricatedDetail(2, 6),
    });

    const result = await syncMaxGuestsFromOwnerRez(actor);

    // The failure doesn't stop the other property's update.
    expect(m.tx.property.update).toHaveBeenCalledTimes(1);
    expect(m.tx.property.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "00000000-0000-4000-8000-000000000002" },
      }),
    );
    expect(result).toMatchObject({
      counts: { updated: 1, failed: 1 },
      results: [
        { outcome: "failed", reason: "request_failed", before: 8, after: 8 },
        { outcome: "updated", before: 4, after: 6 },
      ],
    });
  });

  it("reports the rest as rate limited after a 429, without retrying", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
    ] as never);
    m.usage.rateLimited = true;
    detailsByOwnerRezId({
      900001: new OwnerrezRequestBudgetError("RATE_LIMITED"),
    });

    const result = await syncMaxGuestsFromOwnerRez(actor);

    expect(m.getProperty).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      rateLimited: true,
      results: [{ outcome: "failed", reason: "rate_limited" }],
    });
  });

  it("makes no request for an invalid link id and changes nothing", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { ownerRezPropertyId: "not-a-number" }),
    ] as never);

    const result = await syncMaxGuestsFromOwnerRez(actor);

    expect(m.getProperty).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      results: [{ outcome: "failed", reason: "invalid_link_id" }],
    });
  });

  it("reports a failed write as failed and still processes the next property", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { maxOccupancy: 8 }),
      fabricatedProperty(2, { maxOccupancy: 8 }),
    ] as never);
    detailsByOwnerRezId({
      900001: fabricatedDetail(1, 9),
      900002: fabricatedDetail(2, 9),
    });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("db down"));

    const result = await syncMaxGuestsFromOwnerRez(actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      counts: { updated: 1, failed: 1 },
      results: [
        { outcome: "failed", reason: "update_failed", before: 8, after: 8 },
        { outcome: "updated", before: 8, after: 9 },
      ],
    });
  });

  it("sets a request budget of one request per property", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1),
      fabricatedProperty(2),
      fabricatedProperty(3),
    ] as never);
    detailsByOwnerRezId({
      900001: fabricatedDetail(1, 8),
      900002: fabricatedDetail(2, 8),
      900003: fabricatedDetail(3, 8),
    });
    await syncMaxGuestsFromOwnerRez(actor);
    expect(m.clientOptions).toEqual([{ requestBudget: 3 }]);
    expect(m.getProperty).toHaveBeenCalledTimes(3);
  });

  it("logs counts only, never property names or values", async () => {
    vi.mocked(prisma.property.findMany).mockResolvedValueOnce([
      fabricatedProperty(1, { maxOccupancy: 12 }),
    ] as never);
    detailsByOwnerRezId({ 900001: fabricatedDetail(1, 14) });
    await syncMaxGuestsFromOwnerRez(actor);
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain('\\"updated\\":1');
    expect(logged).not.toContain("FABRICATED");
    expect(logged).not.toContain("900001");
  });
});
