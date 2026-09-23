import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetLockDetail, mockRecordAudit } = vi.hoisted(() => ({
  mockGetLockDetail: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

// Deliberately no `providerDevice` key at all — a real call to
// `prisma.providerDevice.*` would throw "Cannot read properties of
// undefined" immediately, which is exactly the proof the "never touches
// ProviderDevice" tests below rely on. Deliberately no `create`/`upsert` on
// `smartDevice` either, for the same reason applied to "never creates".
vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

// Deliberately exposes only getLockDetail — the real
// @stayw/integrations/august module also exports listLocks() and other
// AugustClient methods; a mock this narrow means any accidental call to
// anything else (including a lock/unlock-shaped method, if one ever
// existed) would throw "not a function" immediately.
vi.mock("@stayw/integrations/august", () => ({
  AugustClient: vi.fn().mockImplementation(() => ({
    getLockDetail: mockGetLockDetail,
  })),
  isAugustBrand: vi.fn().mockReturnValue(true),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

// chunk()/AUGUST_DETAIL_CONCURRENCY and isDemoSmartDevice are loaded FOR
// REAL from provider-devices.service.ts/smart-devices.service.ts (not
// mocked) — they're pure, side-effect-free helpers, and using the real
// ones is the whole point of the "never a second, potentially-drifting
// copy" reuse this feature is built on. provider-devices.service.ts's own
// top-level import of ensureConnectionRows (integrations.service.ts) still
// needs mocking so merely importing it doesn't reach for a real DB — same
// transitive-import reason lock-refresh.service.test.ts already documents
// for this exact pairing.
vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: vi.fn().mockResolvedValue(undefined),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { refreshAugustTelemetryForSelectedLocks } from "./lock-spot-refresh.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

const LOCK_ID = "11111111-1111-1111-1111-111111111111";
const LOCK_ID_2 = "22222222-2222-2222-2222-222222222222";
const THERMOSTAT_ID = "33333333-3333-3333-3333-333333333333";

function setAugustEnv() {
  process.env.AUGUST_IDENTIFIER = "email:test@example.com";
  process.env.AUGUST_INSTALL_ID = "install-1";
  process.env.AUGUST_ACCESS_TOKEN = "token-1";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function augustLockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCK_ID,
    provider: "AUGUST",
    deviceType: "LOCK",
    externalDeviceId: "ext-lock-1",
    metadata: {
      batteryLevel: 90,
      lockState: "locked",
      telemetryUpdatedAt: "2026-09-09T05:24:51.000Z",
    },
    status: "ONLINE",
    lastSeenAt: new Date("2026-09-09T05:24:51.000Z"),
    ...overrides,
  };
}

function augustDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "ext-lock-1",
    name: "Bonjour - Front Door",
    houseId: "house-1",
    batteryLevel: 88,
    connectivity: "ONLINE",
    lockState: "locked",
    telemetryUpdatedAt: "2026-09-12T10:00:00.000Z",
    seenAt: "2026-09-12T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  setAugustEnv();
  vi.mocked(assertPermission).mockResolvedValue(undefined);
  vi.mocked(prisma.smartDevice.findMany).mockReset();
  vi.mocked(prisma.smartDevice.update).mockReset();
  mockGetLockDetail.mockReset();
  mockRecordAudit.mockClear();
});

afterEach(() => {
  restoreEnv();
});

describe("source-level guarantees", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(__dirname, "./lock-spot-refresh.service.ts"),
    "utf8",
  );

  it("never references any lock/unlock or PIN/access-code capability (no such method exists on AugustClient at all)", () => {
    for (const forbidden of [
      ".lock(",
      ".unlock(",
      "setPin",
      "createPin",
      "deletePin",
      "accessCode",
      "access_code",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("imports only chunk/AUGUST_DETAIL_CONCURRENCY from provider-devices.service and only isDemoSmartDevice from smart-devices.service — never discovery, the legacy full-fleet sync, or mapping/enabling functions", () => {
    // Checks the actual imported SYMBOLS (the `{ ... }` of each real
    // `import { X, Y } from "..."` statement), not prose — this file's own
    // doc comment legitimately *names* functions like syncAugustDevices()
    // to explain what it deliberately does not call, which would false-fail
    // a plain whole-file substring check.
    const importedSymbols = [...source.matchAll(/import\s*\{([^}]+)\}\s*from/g)]
      .flatMap((m) => (m[1] as string).split(","))
      .map((s) => s.trim())
      .filter(Boolean);

    const forbidden = [
      "discoverAugustDevices",
      "discoverNestDevices",
      "syncAugustDevices",
      "syncCieloDevices",
      "mapProviderDeviceToProperty",
      "setProviderDeviceEnabled",
      "unmapProviderDevice",
      "listSmartDevices",
    ];
    for (const name of forbidden) {
      expect(importedSymbols.some((s) => s.includes(name))).toBe(false);
    }

    // Positive check: the two specific, intended reused helpers are
    // actually there — proves this test isn't vacuously passing.
    expect(importedSymbols.some((s) => s.includes("chunk"))).toBe(true);
    expect(
      importedSymbols.some((s) => s.includes("AUGUST_DETAIL_CONCURRENCY")),
    ).toBe(true);
    expect(importedSymbols.some((s) => s.includes("isDemoSmartDevice"))).toBe(
      true,
    );
    // 2026-09-23 release-review fix: this file no longer defines its own
    // merge helper — it reuses lock-refresh.service.ts's, now that that
    // file's own whole-fleet refresh merges too.
    expect(
      importedSymbols.some((s) => s.includes("mergeAugustLockMetadata")),
    ).toBe(true);
  });

  it("never imports anything beyond the exact expected module set", () => {
    const allowed = new Set([
      "server-only",
      "@stayw/auth",
      "@stayw/database",
      "@stayw/integrations/august",
      "../schemas/lock-spot-refresh.schema",
      "./lock-refresh.service",
      "./provider-devices.service",
      "./smart-devices.service",
      "@/platform/audit/record-audit",
    ]);
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(allowed.has(specifier as string)).toBe(true);
    }
  });
});

describe("refreshAugustTelemetryForSelectedLocks", () => {
  it("updates only the exact requested SmartDevice by id, never propertyId or name", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow(),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustDetail());
    vi.mocked(prisma.smartDevice.update).mockResolvedValueOnce({
      status: "ONLINE",
      lastSeenAt: new Date("2026-09-12T10:00:00.000Z"),
    } as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(result).toEqual([{ smartDeviceId: LOCK_ID, result: "success" }]);
    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]![0];
    expect(call.where).toEqual({ id: LOCK_ID });
    expect(Object.keys(call.data).sort()).toEqual(
      ["lastSeenAt", "metadata", "status"].sort(),
    );
    expect(mockGetLockDetail).toHaveBeenCalledWith("ext-lock-1");
  });

  it("merges metadata — an omitted field this call keeps its previously-stored value", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({
        metadata: {
          batteryLevel: 90,
          lockState: "locked",
          telemetryUpdatedAt: "2026-09-09T05:24:51.000Z",
        },
      }),
    ] as never);
    // This call's response omits lockState entirely (null) — the prior
    // "locked" value must survive in the written metadata.
    mockGetLockDetail.mockResolvedValueOnce(
      augustDetail({ lockState: null, batteryLevel: 72 }),
    );
    vi.mocked(prisma.smartDevice.update).mockResolvedValueOnce({} as never);

    await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]![0];
    expect(call.data.metadata).toEqual({
      batteryLevel: 72, // fresh value overwrote the old 90
      lockState: "locked", // preserved — this call didn't report it
      telemetryUpdatedAt: "2026-09-12T10:00:00.000Z",
    });
  });

  it("never calls prisma.providerDevice at all", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow(),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustDetail());
    vi.mocked(prisma.smartDevice.update).mockResolvedValueOnce({} as never);

    // If the implementation ever touched prisma.providerDevice, this would
    // throw synchronously (the mocked prisma object has no such key) and
    // fail the test before reaching the assertion below.
    await expect(
      refreshAugustTelemetryForSelectedLocks(actor, {
        smartDeviceIds: [LOCK_ID],
      }),
    ).resolves.toEqual([{ smartDeviceId: LOCK_ID, result: "success" }]);
  });

  it("never calls create/upsert — only update, on an existing row", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow(),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustDetail());
    vi.mocked(prisma.smartDevice.update).mockResolvedValueOnce({} as never);

    // The mocked smartDevice object has no create/upsert method — a real
    // call to either throws "is not a function" immediately.
    await expect(
      refreshAugustTelemetryForSelectedLocks(actor, {
        smartDeviceIds: [LOCK_ID],
      }),
    ).resolves.toEqual([{ smartDeviceId: LOCK_ID, result: "success" }]);
  });

  it("wrong provider is invalid_selection — no August call made", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({
        id: THERMOSTAT_ID,
        provider: "NEST",
        deviceType: "THERMOSTAT",
      }),
    ] as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [THERMOSTAT_ID],
    });

    expect(result).toEqual([
      { smartDeviceId: THERMOSTAT_ID, result: "invalid_selection" },
    ]);
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
  });

  it("wrong deviceType (AUGUST but not LOCK) is invalid_selection — no August call made", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({ deviceType: "THERMOSTAT" }),
    ] as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(result).toEqual([
      { smartDeviceId: LOCK_ID, result: "invalid_selection" },
    ]);
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("a missing row is not_found — no August call made", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([] as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(result).toEqual([{ smartDeviceId: LOCK_ID, result: "not_found" }]);
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
  });

  it("one device's provider failure never blocks another device's success", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({ id: LOCK_ID, externalDeviceId: "ext-lock-1" }),
      augustLockRow({ id: LOCK_ID_2, externalDeviceId: "ext-lock-2" }),
    ] as never);
    mockGetLockDetail.mockImplementation(async (externalId: string) => {
      if (externalId === "ext-lock-1") {
        throw new Error("August API 500");
      }
      return augustDetail({ id: externalId });
    });
    vi.mocked(prisma.smartDevice.update).mockResolvedValue({} as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID, LOCK_ID_2],
    });

    expect(result).toEqual(
      expect.arrayContaining([
        {
          smartDeviceId: LOCK_ID,
          result: "provider_failure",
          error: "August API 500",
        },
        { smartDeviceId: LOCK_ID_2, result: "success" },
      ]),
    );
    // Only the successful device was written.
    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(prisma.smartDevice.update).mock.calls[0]![0].where,
    ).toEqual({
      id: LOCK_ID_2,
    });
  });

  it("RBAC denial performs no read or write at all", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      refreshAugustTelemetryForSelectedLocks(actor, {
        smartDeviceIds: [LOCK_ID],
      }),
    ).rejects.toThrow("ForbiddenError");

    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) id before any database call", async () => {
    await expect(
      refreshAugustTelemetryForSelectedLocks(actor, {
        smartDeviceIds: ["not-a-uuid"],
      }),
    ).rejects.toThrow();

    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
  });

  it("records a narrow audit entry on success with only safe before/after telemetry fields", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({ status: "OFFLINE" }),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustDetail());
    vi.mocked(prisma.smartDevice.update).mockResolvedValueOnce({
      status: "ONLINE",
      lastSeenAt: new Date("2026-09-12T10:00:00.000Z"),
    } as never);

    await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        actorType: "USER",
        action: "smart_device.telemetry_spot_refreshed",
        entityType: "SmartDevice",
        entityId: LOCK_ID,
        beforeState: {
          status: "OFFLINE",
          lastSeenAt: "2026-09-09T05:24:51.000Z",
        },
        afterState: {
          status: "ONLINE",
          lastSeenAt: "2026-09-12T10:00:00.000Z",
        },
      }),
    );
  });

  it("does not record an audit entry for a provider failure, not-found, or invalid selection", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({ id: LOCK_ID }),
    ] as never);
    mockGetLockDetail.mockRejectedValueOnce(new Error("network error"));

    await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("a provider failure (e.g. a real 401 from August) makes zero DB writes — the row's stored battery/status/telemetry are left exactly as they were", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({
        id: LOCK_ID,
        metadata: { batteryLevel: 90, lockState: "locked" },
        status: "ONLINE",
      }),
    ] as never);
    mockGetLockDetail.mockRejectedValueOnce(
      new Error("Request to /locks/ext-lock-1 failed with 401"),
    );

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(result).toEqual([
      {
        smartDeviceId: LOCK_ID,
        result: "provider_failure",
        error: "Request to /locks/ext-lock-1 failed with 401",
      },
    ]);
    // The update call happens strictly after a successful getLockDetail()
    // inside the same try block — a rejection jumps straight to the catch,
    // so smartDevice.update must never be called at all for this row.
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("throws a clear configuration error, before any row lookup, when August isn't configured", async () => {
    restoreEnv();

    await expect(
      refreshAugustTelemetryForSelectedLocks(actor, {
        smartDeviceIds: [LOCK_ID],
      }),
    ).rejects.toThrow("August isn't configured");

    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
  });

  it("skips a demo row safely — no August call, no write, reported as invalid_selection", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      augustLockRow({ externalDeviceId: "demo-lock-1" }),
    ] as never);

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: [LOCK_ID],
    });

    expect(result).toEqual([
      { smartDeviceId: LOCK_ID, result: "invalid_selection" },
    ]);
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
  });

  it("bounds concurrency to at most 5 in-flight getLockDetail() calls, and correctly processes more than 5 requested locks in sequential batches", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `${String(i + 1).padStart(8, "0")}-0000-0000-0000-000000000000`,
    );
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce(
      ids.map((id, i) =>
        augustLockRow({ id, externalDeviceId: `ext-${i + 1}` }),
      ) as never,
    );
    vi.mocked(prisma.smartDevice.update).mockResolvedValue({} as never);

    let inFlight = 0;
    let maxInFlight = 0;
    mockGetLockDetail.mockImplementation(async (externalId: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); // yield one microtask tick, same as every other in-flight call in this batch
      inFlight--;
      return augustDetail({ id: externalId });
    });

    const result = await refreshAugustTelemetryForSelectedLocks(actor, {
      smartDeviceIds: ids,
    });

    expect(result).toHaveLength(12);
    expect(result.every((o) => o.result === "success")).toBe(true);
    expect(mockGetLockDetail).toHaveBeenCalledTimes(12);
    // Never exceeded the concurrency cap...
    expect(maxInFlight).toBeLessThanOrEqual(5);
    // ...and genuine batching actually happened (not accidentally
    // serialized to 1-at-a-time, which would also satisfy "<=5" but not
    // prove real bounded-concurrency batching).
    expect(maxInFlight).toBe(5);
  });
});
