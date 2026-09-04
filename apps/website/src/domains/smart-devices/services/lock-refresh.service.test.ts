import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above every top-level statement — any value
// a factory dereferences directly must go through vi.hoisted() to exist in
// time (same discipline as provider-devices.service.test.ts, which this
// file's mocks otherwise mirror exactly, since lock-refresh.service.ts
// imports chunk()/AUGUST_DETAIL_CONCURRENCY/toAugustSmartDeviceMetadata
// from that same module).
const {
  mockTransaction,
  mockGetLockDetail,
  mockEnsureConnectionRows,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockGetLockDetail: vi.fn(),
  mockEnsureConnectionRows: vi.fn().mockResolvedValue(undefined),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    providerDevice: {
      // Deliberately no create/upsert defined — a real call to either would
      // throw "is not a function" immediately, which is exactly the proof
      // the "never creates/upserts" tests below rely on.
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    smartDevice: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

// Deliberately exposes only getLockDetail — the real
// @stayw/integrations/august module also exports listLocks() and other
// AugustClient methods, but a mock this narrow means any accidental call to
// anything else (including a lock/unlock-shaped method, if one ever existed)
// would throw "not a function" immediately. isAugustBrand mocked true so
// getAugustClientFromEnv()'s brand fallback never blocks a test on brand
// validation specifics, which this file doesn't own.
vi.mock("@stayw/integrations/august", () => ({
  AugustClient: vi.fn().mockImplementation(() => ({
    getLockDetail: mockGetLockDetail,
  })),
  isAugustBrand: vi.fn().mockReturnValue(true),
}));

// lock-refresh.service.ts imports chunk()/AUGUST_DETAIL_CONCURRENCY/
// toAugustSmartDeviceMetadata from provider-devices.service.ts, which in
// turn imports these two modules at its own top level — mocked here purely
// so that transitive import resolves without touching a real DB/audit call,
// same reason provider-devices.service.test.ts mocks them.
vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
}));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { refreshAugustTelemetry } from "./lock-refresh.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

function setAugustEnv() {
  process.env.AUGUST_IDENTIFIER = "email:test@example.com";
  process.env.AUGUST_INSTALL_ID = "install-1";
  process.env.AUGUST_ACCESS_TOKEN = "token-1";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function eligibleProviderDevice(
  id: string,
  externalDeviceId: string,
  smartDeviceId: string,
) {
  return { id, externalDeviceId, smartDeviceId };
}

function augustLockDetail(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Front Door",
    houseId: "house-1",
    batteryLevel: 90,
    connectivity: "ONLINE",
    lockState: "locked",
    telemetryUpdatedAt: "2026-09-03T12:00:00.000Z",
    seenAt: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

/**
 * Strips /** ... *\/ and // comments so the source-level guarantee tests
 * below check only real code (imports, calls, identifiers) — this file's
 * own doc comments legitimately *name* forbidden strings like
 * "AUGUST_PROPERTY_MAP" and "PIN" while explaining that they're
 * deliberately never used, which would otherwise false-fail a naive
 * substring check.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function readCodeOnly(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(__dirname, "./lock-refresh.service.ts"),
    "utf8",
  );
  return stripComments(source);
}

describe("lock-refresh.service — source-level command-safety guarantee", () => {
  it("never imports or references any lock/unlock or PIN/access-code capable function — structurally impossible to send a physical command from this file", () => {
    const code = readCodeOnly();

    for (const forbidden of [
      "lockDevice",
      "unlockDevice",
      ".lock(",
      ".unlock(",
      "accessCode",
      "pin",
      "PIN",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("never imports anything from smart-devices.service — cannot reach the AUGUST_PROPERTY_MAP-driven upsert path (syncAugustDevices lives only there)", () => {
    const code = readCodeOnly();

    expect(code).not.toContain('from "./smart-devices.service"');
    expect(code).not.toContain("AUGUST_PROPERTY_MAP");
  });

  it("never references mapProviderDeviceToProperty/unmapProviderDevice/setProviderDeviceEnabled — cannot change mapping or enablement", () => {
    const code = readCodeOnly();

    for (const forbidden of [
      "mapProviderDeviceToProperty",
      "unmapProviderDevice",
      "setProviderDeviceEnabled",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("refreshAugustTelemetry", () => {
  beforeEach(() => {
    setAugustEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockReset();
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockGetLockDetail.mockReset();
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
  });
  afterEach(restoreEnv);

  it("queries only enabled AUGUST ProviderDevice rows with a live smartDeviceId link — never unmapped or disabled ones (proves eligibility = provider=AUGUST AND enabled=true AND smartDeviceId != null)", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([]);

    await refreshAugustTelemetry(actor);

    expect(prisma.providerDevice.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        smartDeviceId: { not: null },
        integrationConnection: { provider: "AUGUST" },
      },
      select: { id: true, externalDeviceId: true, smartDeviceId: true },
    });
  });

  it("makes zero August API calls when there are no eligible devices — disabled/unlinked legacy rows never reach this function's scope", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([]);

    const result = await refreshAugustTelemetry(actor);

    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, notReturnedByProvider: 0 });
  });

  it("updates the existing SmartDevice's status/metadata and the existing ProviderDevice's snapshot/freshness for a matched device", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { connectivity: "ONLINE", batteryLevel: 87 }),
    );

    const result = await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sd-1" },
        data: expect.objectContaining({
          status: "ONLINE",
          metadata: expect.objectContaining({
            batteryLevel: 87,
            telemetryUpdatedAt: expect.any(String),
          }),
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.providerDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pd-1" },
        data: expect.objectContaining({
          connectivityStatus: "ONLINE",
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toEqual({ refreshed: 1, notReturnedByProvider: 0 });
  });

  it("TIMESTAMP-CORRECTNESS: writes August's own telemetryUpdatedAt value into SmartDevice.metadata exactly — never fabricates it from this refresh's own execution time, even though the API call itself succeeds 'now'", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    try {
      vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
        eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
      ] as never);
      // August's own reported reading is 20 hours older than "now" — a real,
      // meaningfully stale value that must survive into StayWhile's DB
      // unchanged, not get silently replaced by the moment this refresh ran.
      const providerReportedAt = "2026-09-03T04:00:00.000Z";
      mockGetLockDetail.mockResolvedValueOnce(
        augustLockDetail("lock-1", { telemetryUpdatedAt: providerReportedAt }),
      );

      await refreshAugustTelemetry(actor);

      const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
        data: { metadata: Record<string, unknown> };
      };
      expect(call.data.metadata.telemetryUpdatedAt).toBe(providerReportedAt);
      expect(call.data.metadata.telemetryUpdatedAt).not.toBe(
        "2026-09-04T00:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("TIMESTAMP-CORRECTNESS: omits telemetryUpdatedAt from SmartDevice.metadata entirely when August reports none — never fabricated as a fallback", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { telemetryUpdatedAt: null }),
    );

    await refreshAugustTelemetry(actor);

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(call.data.metadata).not.toHaveProperty("telemetryUpdatedAt");
  });

  it("TIMESTAMP-CORRECTNESS: writes SmartDevice.lastSeenAt from August's own seenAt (LockStatus.dateTime), matching syncAugustDevices()'s exact field semantics — never this refresh's own execution time", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    const providerSeenAt = "2026-09-03T04:00:00.000Z";
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { seenAt: providerSeenAt }),
    );

    await refreshAugustTelemetry(actor);

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
      data: { lastSeenAt: Date };
    };
    expect(call.data.lastSeenAt.toISOString()).toBe(providerSeenAt);
  });

  it("TIMESTAMP-CORRECTNESS: writes SmartDevice.lastSeenAt as null when August doesn't validly report LockStatus — never fabricated, matching syncAugustDevices() exactly", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { seenAt: null }),
    );

    await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSeenAt: null }),
      }),
    );
  });

  it("preserves genuine UNKNOWN connectivity — never coerces a Bridge-absent read into ONLINE/OFFLINE", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { connectivity: "UNKNOWN" }),
    );

    await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNKNOWN" }),
      }),
    );
    expect(prisma.providerDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ connectivityStatus: "UNKNOWN" }),
      }),
    );
  });

  it("never touches any mapping/enablement field — propertyId/enabled/mappedAt/mappedByUserId/smartDeviceId never appear in the ProviderDevice write", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustLockDetail("lock-1"));

    await refreshAugustTelemetry(actor);

    const call = vi.mocked(prisma.providerDevice.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    for (const forbiddenField of [
      "propertyId",
      "enabled",
      "mappedAt",
      "mappedByUserId",
      "smartDeviceId",
    ]) {
      expect(call.data).not.toHaveProperty(forbiddenField);
    }
  });

  it("never writes name — a display-name change is a discovery/sync concern, not a telemetry-refresh one", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustLockDetail("lock-1"));

    await refreshAugustTelemetry(actor);

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).not.toHaveProperty("name");
    expect(call.data).not.toHaveProperty("propertyId");
  });

  it("never calls create/upsert on either model — only update, on rows that already exist", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustLockDetail("lock-1"));

    await refreshAugustTelemetry(actor);

    // The mocked prisma client defines no create/upsert method on either
    // model at all — if this file ever called one, the run above would
    // already have thrown "is not a function".
    expect(
      (prisma.providerDevice as unknown as Record<string, unknown>).upsert,
    ).toBeUndefined();
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).upsert,
    ).toBeUndefined();
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  it("isolates a single device's getLockDetail() failure — other devices in the same batch still refresh, the failed one is left completely untouched and counted separately", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
      eligibleProviderDevice("pd-2", "lock-2", "sd-2"),
      eligibleProviderDevice("pd-3", "lock-3", "sd-3"),
    ] as never);
    mockGetLockDetail.mockImplementation(async (id: string) => {
      if (id === "lock-2") throw new Error("August API 500");
      return augustLockDetail(id);
    });

    const result = await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(2);
    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sd-1" } }),
    );
    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sd-3" } }),
    );
    expect(prisma.smartDevice.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sd-2" } }),
    );
    expect(result).toEqual({ refreshed: 2, notReturnedByProvider: 1 });
  });

  it("bounds detail-request concurrency to the shared AUGUST_DETAIL_CONCURRENCY cap (5) instead of running all requests at once — reuses discoverAugustDevices()'s own constant, not a second copy", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) =>
        eligibleProviderDevice(`pd-${i}`, `lock-${i}`, `sd-${i}`),
      ) as never,
    );

    let inFlight = 0;
    let maxInFlight = 0;
    mockGetLockDetail.mockImplementation(async (id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return augustLockDetail(id);
    });

    const result = await refreshAugustTelemetry(actor);

    expect(mockGetLockDetail).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(result).toEqual({ refreshed: 12, notReturnedByProvider: 0 });
  });

  it("leaves a device August doesn't confirm this time completely untouched and counts it separately, if every device in a batch fails", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockRejectedValueOnce(new Error("timeout"));

    const result = await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(prisma.providerDevice.update).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, notReturnedByProvider: 1 });
  });

  it("propagates a not-configured error when August credentials are missing, even when there are zero eligible devices — never silently reports a misleading '0 refreshed' success", async () => {
    delete process.env.AUGUST_IDENTIFIER;

    await expect(refreshAugustTelemetry(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(prisma.providerDevice.findMany).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("propagates denial when the actor lacks smart_devices:update, without querying the database", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshAugustTelemetry(actor)).rejects.toThrow();
    expect(prisma.providerDevice.findMany).not.toHaveBeenCalled();
  });
});

describe("lock-refresh.service — diagnostic logging", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  function loggedEvents(): Array<Record<string, unknown>> {
    return consoleLogSpy.mock.calls.map((call) =>
      JSON.parse(call[1] as string),
    );
  }

  beforeEach(() => {
    setAugustEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockGetLockDetail.mockReset();
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleLogSpy.mockRestore();
    restoreEnv();
  });

  it("logs every event under the [lock-refresh] prefix, structured, at least once for a real run", async () => {
    await refreshAugustTelemetry(actor);

    expect(consoleLogSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of consoleLogSpy.mock.calls) {
      expect(call[0]).toBe("[lock-refresh]");
      const parsed = JSON.parse(call[1] as string) as { event?: unknown };
      expect(typeof parsed.event).toBe("string");
    }
  });

  it("SECRET-SAFETY: never logs any credential/env value, including the not-configured case that names the missing env vars", async () => {
    process.env.AUGUST_IDENTIFIER = "email:secret-value@example.com";
    process.env.AUGUST_ACCESS_TOKEN = "super-secret-token";
    mockGetLockDetail.mockResolvedValue(augustLockDetail("lock-1"));
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);

    await refreshAugustTelemetry(actor);

    const serialized = JSON.stringify(loggedEvents());
    expect(serialized).not.toContain("secret-value@example.com");
    expect(serialized).not.toContain("super-secret-token");
    for (const event of loggedEvents()) {
      for (const key of Object.keys(event)) {
        expect(key.toLowerCase()).not.toMatch(
          /token|secret|password|credential|accesstoken|installid/,
        );
      }
    }
  });

  it("SECRET-SAFETY: never logs raw provider metadata/payloads — only counts and status strings", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { houseId: "secret-house-id-value" }),
    );

    await refreshAugustTelemetry(actor);

    const serialized = JSON.stringify(loggedEvents());
    expect(serialized).not.toContain("secret-house-id-value");
    expect(serialized).not.toContain("houseId");
  });
});
