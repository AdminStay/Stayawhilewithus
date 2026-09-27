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
  mockQueryRaw,
  mockConnectionFindUniqueOrThrow,
  mockConnectionFindUnique,
  mockConnectionUpdate,
  mockSyncLogFindFirst,
  mockSyncLogCreate,
  mockSyncLogUpdate,
} = vi.hoisted(() => ({
  mockConnectionFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetLockDetail: vi.fn(),
  mockEnsureConnectionRows: vi.fn().mockResolvedValue(undefined),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockQueryRaw: vi.fn(),
  mockConnectionFindUniqueOrThrow: vi.fn(),
  mockConnectionUpdate: vi.fn().mockResolvedValue({}),
  mockSyncLogFindFirst: vi.fn(),
  mockSyncLogCreate: vi.fn(),
  mockSyncLogUpdate: vi.fn().mockResolvedValue({}),
}));

// The transaction-callback shape (refreshAugustTelemetryAutomatic's
// overlap-claim transaction) and the transaction-array shape (the existing
// batched-write pattern below) share the same `$transaction` mock — real
// Prisma supports both call forms, so this generic implementation mirrors
// that rather than assuming only one is ever used in this file.
const txClient = {
  $queryRaw: mockQueryRaw,
  integrationSyncLog: {
    findFirst: mockSyncLogFindFirst,
    create: mockSyncLogCreate,
    update: mockSyncLogUpdate,
  },
};

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
    smartDeviceEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    integrationConnection: {
      findUniqueOrThrow: mockConnectionFindUniqueOrThrow,
      findUnique: mockConnectionFindUnique,
      update: mockConnectionUpdate,
    },
    integrationSyncLog: {
      findFirst: mockSyncLogFindFirst,
      create: mockSyncLogCreate,
      update: mockSyncLogUpdate,
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
//
// STALE_RUNNING_THRESHOLD_MS is a plain, hardcoded 10-minute literal here
// (never `importOriginal`) — deliberately, to keep this mock as narrow as
// the rest of this file's mocks (this test file's own stated philosophy;
// pulling in the real integrations.service.ts module graph here would drag
// in NotionClient/OwnerrezClient, which this focused unit test has no
// business touching). This value MUST stay equal to the real exported
// STALE_RUNNING_THRESHOLD_MS in integrations.service.ts — if that constant
// ever changes, this literal needs updating too; the cross-file
// mutual-exclusion test (lock-refresh-automatic-mutual-exclusion.test.ts)
// imports both real modules together specifically so drift like that would
// be caught there even if missed here.
vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS: 10 * 60 * 1000,
}));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { HttpRequestError } from "@stayw/integrations/core";

import {
  AUGUST_RATE_LIMIT_COOLDOWN_MS,
  AUGUST_RATE_LIMITED_MARKER,
  getAugustRefreshFreshness,
  LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS,
  mergeAugustLockMetadata,
  refreshAugustTelemetry,
  refreshAugustTelemetryAutomatic,
  refreshAugustTelemetryIfStale,
} from "./lock-refresh.service";

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

/**
 * Shared setup for every test that exercises the guarded
 * claim-run-finish path (refreshAugustTelemetry AND
 * refreshAugustTelemetryAutomatic both delegate to the same internal
 * core) — one place to configure the advisory-lock/IntegrationSyncLog/
 * IntegrationConnection mocks, reused by all three describe blocks below
 * that call either function, so their setups can't quietly drift apart.
 */
function setupGuardedRefreshMocks() {
  mockQueryRaw.mockReset().mockResolvedValue([{ locked: true }]);
  mockConnectionFindUniqueOrThrow
    .mockReset()
    .mockResolvedValue({ id: "conn-august-1", provider: "AUGUST" });
  mockConnectionUpdate.mockReset().mockResolvedValue({});
  mockSyncLogFindFirst.mockReset().mockResolvedValue(null);
  mockSyncLogCreate.mockReset().mockResolvedValue({ id: "log-new" });
  mockSyncLogUpdate.mockReset().mockResolvedValue({});
  mockTransaction.mockReset().mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof txClient) => unknown)(txClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
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
    setupGuardedRefreshMocks();
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
      select: {
        id: true,
        externalDeviceId: true,
        smartDeviceId: true,
        smartDevice: { select: { metadata: true } },
      },
    });
  });

  it("makes zero August API calls when there are no eligible devices — disabled/unlinked legacy rows never reach this function's scope", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([]);

    const result = await refreshAugustTelemetry(actor);

    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "completed",
      refreshed: 0,
      notReturnedByProvider: 0,
    });
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
    expect(result).toEqual({
      status: "completed",
      refreshed: 1,
      notReturnedByProvider: 0,
    });
  });

  it("RETIREMENT-SAFETY (2026-09-23 release-review fix): merges fresh telemetry onto existing metadata instead of replacing it — a device whose existing metadata already carries a valid retiredAt (item C) keeps it, while telemetry fields still update correctly", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      {
        ...eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
        smartDevice: {
          metadata: {
            retiredAt: "2026-09-20T00:00:00.000Z",
            batteryLevel: 40,
          },
        },
      },
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", {
        connectivity: "ONLINE",
        batteryLevel: 87,
        lockState: "locked",
      }),
    );

    const result = await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sd-1" },
        data: expect.objectContaining({
          status: "ONLINE",
          metadata: expect.objectContaining({
            // The pre-existing retirement marker survives, unchanged.
            retiredAt: "2026-09-20T00:00:00.000Z",
            // Fresh telemetry still updates correctly.
            batteryLevel: 87,
            lockState: "locked",
            telemetryUpdatedAt: expect.any(String),
          }),
        }),
      }),
    );
    expect(result).toEqual({
      status: "completed",
      refreshed: 1,
      notReturnedByProvider: 0,
    });
  });

  it("preserves an unrelated, unrecognized existing metadata key that this refresh doesn't itself own — a general merge, not a retiredAt special case", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      {
        ...eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
        smartDevice: {
          metadata: { someFutureField: "keep-me" },
        },
      },
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(
      augustLockDetail("lock-1", { connectivity: "ONLINE", batteryLevel: 50 }),
    );

    await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            someFutureField: "keep-me",
            batteryLevel: 50,
          }),
        }),
      }),
    );
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
    expect(result).toEqual({
      status: "completed",
      refreshed: 2,
      notReturnedByProvider: 1,
    });
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
    expect(result).toEqual({
      status: "completed",
      refreshed: 12,
      notReturnedByProvider: 0,
    });
  });

  it("leaves a device August doesn't confirm this time completely untouched and counts it separately, if every device in a batch fails", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockRejectedValueOnce(new Error("timeout"));

    const result = await refreshAugustTelemetry(actor);

    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(prisma.providerDevice.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "completed",
      refreshed: 0,
      notReturnedByProvider: 1,
    });
  });

  it("returns a sanitized failed outcome (never a throw) when August credentials are missing, even when there are zero eligible devices — never silently reports a misleading '0 refreshed' success", async () => {
    delete process.env.AUGUST_IDENTIFIER;

    const result = await refreshAugustTelemetry(actor);

    expect(result).toEqual({
      status: "failed",
      reason: expect.stringContaining("isn't configured"),
    });
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
    setupGuardedRefreshMocks();
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

describe("refreshAugustTelemetryAutomatic", () => {
  const CONNECTION = { id: "conn-august-1", provider: "AUGUST" };

  function runningLog(overrides: Record<string, unknown> = {}) {
    return {
      id: "log-existing",
      integrationConnectionId: CONNECTION.id,
      status: "RUNNING",
      startedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    setAugustEnv();
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockGetLockDetail.mockReset();
    setupGuardedRefreshMocks();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });
  afterEach(restoreEnv);

  it("is actor-agnostic — never calls assertPermission, since there is no signed-in user to check a permission against", async () => {
    await refreshAugustTelemetryAutomatic();

    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("ensures the AUGUST connection row exists and claims the same advisory lock name beginDeviceSync() uses, before creating a RUNNING log", async () => {
    await refreshAugustTelemetryAutomatic();

    expect(mockEnsureConnectionRows).toHaveBeenCalled();
    expect(mockQueryRaw).toHaveBeenCalled();
    expect(mockSyncLogCreate).toHaveBeenCalledWith({
      data: {
        integrationConnectionId: CONNECTION.id,
        direction: "INBOUND",
        entityType: "SmartDevice",
        status: "RUNNING",
      },
    });
  });

  it("OVERLAP-PROTECTION: skips the run entirely when the advisory lock can't be claimed — never creates a log row, never calls August", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ locked: false }]);

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({ status: "already_running" });
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("OVERLAP-PROTECTION: skips when a RECENT RUNNING log already exists for this connection, even though the advisory lock itself was claimed", async () => {
    mockSyncLogFindFirst.mockResolvedValueOnce(
      runningLog({ startedAt: new Date() }),
    );

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({ status: "already_running" });
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("CROSS-PATH THRESHOLD SYMMETRY: treats a row 1ms younger than the shared 10-minute threshold as fresh (skip) — the exact boundary beginDeviceSync() itself uses, imported rather than redefined, so the two paths can never disagree about the same row's staleness", async () => {
    const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;
    mockSyncLogFindFirst.mockResolvedValueOnce(
      runningLog({
        startedAt: new Date(Date.now() - (STALE_RUNNING_THRESHOLD_MS - 1)),
      }),
    );

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({ status: "already_running" });
    expect(mockSyncLogUpdate).not.toHaveBeenCalled();
  });

  it("CROSS-PATH THRESHOLD SYMMETRY: treats a row 1ms older than the shared 10-minute threshold as stale (recover), at the exact same boundary", async () => {
    const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;
    mockSyncLogFindFirst.mockResolvedValueOnce(
      runningLog({
        id: "log-just-over",
        startedAt: new Date(Date.now() - (STALE_RUNNING_THRESHOLD_MS + 1)),
      }),
    );

    const result = await refreshAugustTelemetryAutomatic();

    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-just-over" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(result.status).toBe("completed");
  });

  it("OVERLAP-PROTECTION: recovers a STALE RUNNING log (older than the threshold) by closing it out as FAILED, then proceeds with a fresh run", async () => {
    const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
    mockSyncLogFindFirst.mockResolvedValueOnce(
      runningLog({ id: "log-stale", startedAt: staleStartedAt }),
    );

    const result = await refreshAugustTelemetryAutomatic();

    expect(mockSyncLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-stale" },
      data: expect.objectContaining({
        status: "FAILED",
        finishedAt: expect.any(Date),
      }),
    });
    expect(mockSyncLogCreate).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("SUCCESS: creates a RUNNING log, refreshes eligible devices via the exact same core the manual refresh uses, then closes the log SUCCEEDED with the real refreshed count and bumps IntegrationConnection.lastSyncedAt", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustLockDetail("lock-1"));

    const result = await refreshAugustTelemetryAutomatic();

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sd-1" } }),
    );
    expect(mockSyncLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-new" },
      data: {
        status: "SUCCEEDED",
        recordsProcessed: 1,
        finishedAt: expect.any(Date),
      },
    });
    expect(mockConnectionUpdate).toHaveBeenCalledWith({
      where: { id: CONNECTION.id },
      data: { status: "CONNECTED", lastSyncedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      status: "completed",
      refreshed: 1,
      notReturnedByProvider: 0,
    });
  });

  it("PER-DEVICE ISOLATION: one device's provider failure doesn't fail the whole automatic run — still reports completed with the real split counts", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
      eligibleProviderDevice("pd-2", "lock-2", "sd-2"),
    ] as never);
    mockGetLockDetail.mockImplementation(async (id: string) => {
      if (id === "lock-2") throw new Error("August API 500");
      return augustLockDetail(id);
    });

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({
      status: "completed",
      refreshed: 1,
      notReturnedByProvider: 1,
    });
    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          recordsProcessed: 1,
        }),
      }),
    );
  });

  it("SANITIZED-FAILURE: a top-level failure (August not configured) closes the log FAILED with that message, and never bumps IntegrationConnection.lastSyncedAt", async () => {
    delete process.env.AUGUST_IDENTIFIER;

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({
      status: "failed",
      reason: expect.stringContaining("isn't configured"),
    });
    expect(mockSyncLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-new" },
      data: {
        status: "FAILED",
        errorMessage: expect.stringContaining("isn't configured"),
        finishedAt: expect.any(Date),
      },
    });
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  it("SECRET-SAFETY: never writes a credential value into the IntegrationSyncLog row, even on the not-configured failure path", async () => {
    process.env.AUGUST_ACCESS_TOKEN = "super-secret-token";
    delete process.env.AUGUST_IDENTIFIER;

    await refreshAugustTelemetryAutomatic();

    const serialized = JSON.stringify(mockSyncLogUpdate.mock.calls);
    expect(serialized).not.toContain("super-secret-token");
  });

  it("never creates/updates a ProviderDevice mapping/enablement field, and never touches lock/unlock/PIN — same structural guarantee as the manual path (see the source-level guarantee tests above), reused unchanged since this function delegates to the same core", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(augustLockDetail("lock-1"));

    await refreshAugustTelemetryAutomatic();

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
});

describe("refreshAugustTelemetry vs. refreshAugustTelemetryAutomatic — same-file mutual exclusion", () => {
  const CONNECTION = { id: "conn-august-1", provider: "AUGUST" };

  function runningLog(overrides: Record<string, unknown> = {}) {
    return {
      id: "log-existing",
      integrationConnectionId: CONNECTION.id,
      status: "RUNNING",
      startedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    setAugustEnv();
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockGetLockDetail.mockReset();
    setupGuardedRefreshMocks();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });
  afterEach(restoreEnv);

  it("automatic running → manual Refresh All is refused with already_running (never a throw, never a second provider call)", async () => {
    mockSyncLogFindFirst.mockResolvedValueOnce(runningLog());

    const result = await refreshAugustTelemetry(actor);

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("manual Refresh All running → automatic is refused with already_running", async () => {
    mockSyncLogFindFirst.mockResolvedValueOnce(runningLog());

    const result = await refreshAugustTelemetryAutomatic();

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("manual Refresh All running → a second manual Refresh All is also refused — protects against a double-click/duplicate submission, not just against other August operations", async () => {
    mockSyncLogFindFirst.mockResolvedValueOnce(runningLog());

    const result = await refreshAugustTelemetry(actor);

    expect(result).toEqual({ status: "already_running" });
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
  });

  it("STALE-RECOVERY VIA MANUAL PATH: refreshAugustTelemetry() recovers a stale RUNNING row using the exact same shared STALE_RUNNING_THRESHOLD_MS as the automatic path — proves the fix isn't automatic-only", async () => {
    const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;
    mockSyncLogFindFirst.mockResolvedValueOnce(
      runningLog({
        id: "log-stale",
        startedAt: new Date(Date.now() - (STALE_RUNNING_THRESHOLD_MS + 1)),
      }),
    );

    const result = await refreshAugustTelemetry(actor);

    expect(mockSyncLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-stale" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(result.status).toBe("completed");
  });

  it("RBAC still runs first for the manual path even when nothing is running — a denial never depends on / is never masked by the concurrency check", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshAugustTelemetry(actor)).rejects.toThrow();
    expect(mockSyncLogFindFirst).not.toHaveBeenCalled();
  });
});

describe("mergeAugustLockMetadata — CROSS-PATH RETIREMENT-STICKINESS (2026-09-23 release-review, Fixes 1/2/3/4)", () => {
  // This is the one real function every August metadata-preservation fix
  // routes through: runAugustTelemetryRefresh() (Fix 1, this file),
  // refreshAugustTelemetryForSelectedLocks() (already-safe spot refresh,
  // lock-spot-refresh.service.ts), setProviderDeviceEnabled() (Fix 2,
  // provider-devices.service.ts), syncAugustDevices() (Fix 3,
  // smart-devices.service.ts), and sendAugustLockCommand()'s confirmation
  // write (Fix 4, august-commands.service.ts) — all five now merge fresh
  // telemetry through this exact function rather than each carrying its
  // own copy-pasted merge logic. Proving retiredAt survives here, against
  // every shape of "fresh" data those five real call sites can actually
  // produce, is a single, deliberately small proof that the retirement
  // invariant holds structurally across all of them — not five separate,
  // narrower re-implementations of the same assertion, and not a new fake
  // shared-DB architecture (explicitly not wanted for this check).
  const RETIRED_METADATA = {
    retiredAt: "2026-09-20T00:00:00.000Z",
    batteryLevel: 5,
    lockState: "unlocked",
    telemetryUpdatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("a fully-populated fresh reading (the shape every one of the five real call sites passes) still preserves retiredAt while overwriting every provider-owned field", () => {
    const result = mergeAugustLockMetadata(RETIRED_METADATA, {
      batteryLevel: 88,
      lockState: "locked",
      telemetryUpdatedAt: "2026-09-23T09:00:00.000Z",
    });

    expect(result.retiredAt).toBe("2026-09-20T00:00:00.000Z");
    expect(result.batteryLevel).toBe(88);
    expect(result.lockState).toBe("locked");
    expect(result.telemetryUpdatedAt).toBe("2026-09-23T09:00:00.000Z");
  });

  it("a fresh reading with every field null/absent (the real shape when August reports nothing new) still preserves retiredAt AND every previously-known telemetry field — a genuinely no-op merge, never a blank-out", () => {
    const result = mergeAugustLockMetadata(RETIRED_METADATA, {
      batteryLevel: null,
      lockState: null,
      telemetryUpdatedAt: null,
    });

    expect(result).toEqual(RETIRED_METADATA);
  });

  it("a partially-populated fresh reading updates only the fields August actually reported, leaving retiredAt and every other untouched field exactly as they were", () => {
    const result = mergeAugustLockMetadata(RETIRED_METADATA, {
      batteryLevel: 42,
      lockState: null,
      telemetryUpdatedAt: null,
    });

    expect(result.retiredAt).toBe("2026-09-20T00:00:00.000Z");
    expect(result.batteryLevel).toBe(42);
    expect(result.lockState).toBe("unlocked");
    expect(result.telemetryUpdatedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("only an explicit future Restore/Unretire operation should ever remove retiredAt — this function has no code path that clears it, since it only ever spreads existing keys forward and conditionally overwrites battery/lockState/telemetryUpdatedAt, never retiredAt itself", () => {
    const result = mergeAugustLockMetadata(RETIRED_METADATA, {
      batteryLevel: 1,
      lockState: "locked",
      telemetryUpdatedAt: "2026-09-23T09:00:00.000Z",
    });

    expect(Object.prototype.hasOwnProperty.call(result, "retiredAt")).toBe(
      true,
    );
  });
});

describe("refreshAugustTelemetry — lock-health snapshot + transition history (2026-09-25)", () => {
  function withHealth(lockStatus: string, extra: Record<string, unknown> = {}) {
    return augustLockDetail("lock-1", {
      lockState: lockStatus === "unknown" ? "unknown" : lockStatus,
      health: {
        lockStatus,
        lockStatusValid: true,
        lockStatusAt: "2026-09-25T19:44:24.982Z",
        unknownReason:
          lockStatus === "unknown" ? "unknown_error_during_connect" : null,
        doorState: "closed",
        bridgePresent: true,
        bridgeLastOnline: "2026-09-25T19:43:47.979Z",
        bridgeLastOffline: "2026-09-25T02:29:43.949Z",
        wifiConnectionIssueCount: 0,
        batteryWarningState: "lock_state_battery_warning_none",
        ...extra,
      },
    });
  }

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
    vi.mocked(prisma.smartDeviceEvent.createMany)
      .mockReset()
      .mockResolvedValue({ count: 0 } as never);
    mockGetLockDetail.mockReset();
    setupGuardedRefreshMocks();
  });
  afterEach(restoreEnv);

  it("first capture stores the snapshot and records no events", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      {
        ...eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
        smartDevice: { metadata: { lockState: "locked" } },
      },
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(withHealth("locked"));

    const result = await refreshAugustTelemetry(actor);

    expect(result).toMatchObject({ status: "completed", refreshed: 1 });
    const data = vi.mocked(prisma.smartDevice.update).mock.calls[0]![0]
      .data as { metadata: Record<string, unknown> };
    expect(data.metadata.lockHealth).toMatchObject({
      lockState: "locked",
      lastValidLockState: "locked",
    });
    expect(prisma.smartDeviceEvent.createMany).not.toHaveBeenCalled();
  });

  it("a later unknown reading sets lockState to 'unknown' (never the stale 'locked'), keeps the last valid state, and records one transition in the same transaction", async () => {
    const previous = {
      lockState: "locked",
      retiredAt: null,
      lockHealth: {
        observedAt: "2026-09-25T16:00:00.000Z",
        lockState: "locked",
        lockStatusValid: true,
        lockStatusAt: "2026-09-25T15:59:00.000Z",
        unknownReason: null,
        doorState: "closed",
        connectivity: "ONLINE",
        bridgePresent: true,
        bridgeLastOnline: "2026-09-25T15:59:00.000Z",
        bridgeLastOffline: null,
        wifiConnectionIssueCount: 0,
        batteryLevel: 97,
        batteryWarningState: "lock_state_battery_warning_none",
        batteryReadingAt: "2026-09-25T02:31:27.440Z",
        lastValidLockState: "locked",
        lastValidLockStateAt: "2026-09-25T15:59:00.000Z",
        lockStateSince: null,
        consecutiveUnknownRefreshes: 0,
      },
    };
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      {
        ...eligibleProviderDevice("pd-1", "lock-1", "sd-1"),
        smartDevice: { metadata: previous },
      },
    ] as never);
    mockGetLockDetail.mockResolvedValueOnce(withHealth("unknown"));

    const result = await refreshAugustTelemetry(actor);

    expect(result).toMatchObject({ status: "completed", refreshed: 1 });
    const data = vi.mocked(prisma.smartDevice.update).mock.calls[0]![0]
      .data as { metadata: Record<string, any> };
    expect(data.metadata.lockState).toBe("unknown");
    expect(data.metadata.retiredAt).toBeNull();
    expect(data.metadata.lockHealth).toMatchObject({
      lockState: "unknown",
      unknownReason: "unknown_error_during_connect",
      lastValidLockState: "locked",
      lastValidLockStateAt: "2026-09-25T15:59:00.000Z",
      consecutiveUnknownRefreshes: 1,
    });
    expect(prisma.smartDeviceEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          smartDeviceId: "sd-1",
          eventType: "LOCK_STATE_CHANGED",
          payload: expect.objectContaining({ from: "locked", to: "unknown" }),
        }),
      ],
    });
    // The event write is part of the batch's one $transaction.
    const batch = mockTransaction.mock.calls.find((call) =>
      Array.isArray(call[0]),
    )![0] as unknown[];
    expect(batch).toHaveLength(3);
  });
});

describe("refresh-on-view gate + 429 breaker/cooldown (2026-09-27)", () => {
  type Where = {
    integrationConnectionId?: string;
    status?: string;
    errorMessage?: { startsWith: string };
    finishedAt?: { gte: Date };
    startedAt?: { gte: Date };
  };
  interface Log {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage: string | null;
  }
  let logs: Log[];
  let claimHeld: boolean;

  function matches(log: Log, where: Where): boolean {
    if (where.status !== undefined && log.status !== where.status) return false;
    if (
      where.errorMessage &&
      !(log.errorMessage ?? "").startsWith(where.errorMessage.startsWith)
    )
      return false;
    if (
      where.finishedAt &&
      !(log.finishedAt && log.finishedAt >= where.finishedAt.gte)
    )
      return false;
    if (where.startedAt && !(log.startedAt >= where.startedAt.gte))
      return false;
    return true;
  }

  /**
   * A small stateful fake of the sync-log table plus the advisory lock:
   * pg_try_advisory_xact_lock succeeds only when no other claim
   * transaction is in progress, exactly the real transaction-scoped lock.
   */
  function useStatefulLogs(devices: number) {
    logs = [];
    claimHeld = false;
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValue(
      Array.from({ length: devices }, (_, i) =>
        eligibleProviderDevice(`pd-${i}`, `ext-${i}`, `sd-${i}`),
      ) as never,
    );
    mockGetLockDetail.mockImplementation(async (id: string) =>
      augustLockDetail(id),
    );
    mockQueryRaw.mockImplementation(async () => {
      if (claimHeld) return [{ locked: false }];
      claimHeld = true;
      return [{ locked: true }];
    });
    mockTransaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        try {
          return await (arg as (tx: typeof txClient) => unknown)(txClient);
        } finally {
          claimHeld = false;
        }
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    mockSyncLogFindFirst.mockImplementation(
      async ({ where }: { where: Where }) =>
        [...logs].reverse().find((log) => matches(log, where)) ?? null,
    );
    mockSyncLogCreate.mockImplementation(async () => {
      const log: Log = {
        id: `log-${logs.length + 1}`,
        status: "RUNNING",
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
      };
      logs.push(log);
      return log;
    });
    mockSyncLogUpdate.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Log>;
      }) => {
        const log = logs.find((l) => l.id === where.id)!;
        Object.assign(log, data);
        return log;
      },
    );
  }

  beforeEach(() => {
    setAugustEnv();
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockGetLockDetail.mockReset();
    setupGuardedRefreshMocks();
    mockConnectionFindUnique.mockReset();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });
  afterEach(restoreEnv);

  it("stale data: an on-view request starts exactly one read-only fleet refresh", async () => {
    useStatefulLogs(3);

    const outcome = await refreshAugustTelemetryIfStale(actor as never);

    expect(outcome).toMatchObject({ status: "completed", refreshed: 3 });
    expect(mockGetLockDetail).toHaveBeenCalledTimes(3);
    expect(logs.map((l) => l.status)).toEqual(["SUCCEEDED"]);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
  });

  it("fresh data: a refresh started within 10 minutes blocks another — no log row, no August call", async () => {
    useStatefulLogs(3);
    logs.push({
      id: "recent",
      status: "SUCCEEDED",
      startedAt: new Date(
        Date.now() - LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS + 60_000,
      ),
      finishedAt: new Date(),
      errorMessage: null,
    });

    const outcome = await refreshAugustTelemetryIfStale(actor as never);

    expect(outcome).toMatchObject({ status: "fresh" });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
  });

  it("a recent FAILED (non-429) run also counts, so a failing refresh isn't retried every minute", async () => {
    useStatefulLogs(3);
    logs.push({
      id: "recent-failed",
      status: "FAILED",
      startedAt: new Date(Date.now() - 2 * 60_000),
      finishedAt: new Date(),
      errorMessage: "Unexpected",
    });

    expect(await refreshAugustTelemetryIfStale(actor as never)).toMatchObject({
      status: "fresh",
    });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("an older refresh (over 10 minutes) no longer blocks", async () => {
    useStatefulLogs(2);
    logs.push({
      id: "old",
      status: "SUCCEEDED",
      startedAt: new Date(
        Date.now() - LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS - 1000,
      ),
      finishedAt: new Date(Date.now() - LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS),
      errorMessage: null,
    });

    expect(await refreshAugustTelemetryIfStale(actor as never)).toMatchObject({
      status: "completed",
    });
    expect(mockGetLockDetail).toHaveBeenCalledTimes(2);
  });

  it("simultaneous viewers cannot multiply refreshes: 5 concurrent requests → one run, one August read per lock", async () => {
    useStatefulLogs(4);

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        refreshAugustTelemetryIfStale(actor as never),
      ),
    );

    expect(outcomes.filter((o) => o.status === "completed")).toHaveLength(1);
    expect(
      outcomes.every((o) =>
        ["completed", "already_running", "fresh"].includes(o.status),
      ),
    ).toBe(true);
    expect(mockGetLockDetail).toHaveBeenCalledTimes(4);
    expect(mockSyncLogCreate).toHaveBeenCalledTimes(1);
  });

  it("viewers arriving one after another within 10 minutes get 'fresh' — still exactly one run", async () => {
    useStatefulLogs(2);

    const first = await refreshAugustTelemetryIfStale(actor as never);
    const second = await refreshAugustTelemetryIfStale(actor as never);
    const third = await refreshAugustTelemetryIfStale(actor as never);

    expect([first.status, second.status, third.status]).toEqual([
      "completed",
      "fresh",
      "fresh",
    ]);
    expect(mockGetLockDetail).toHaveBeenCalledTimes(2);
  });

  it("a RUNNING refresh blocks an on-view request (already_running, no August call)", async () => {
    useStatefulLogs(3);
    logs.push({
      id: "running",
      status: "RUNNING",
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: null,
      errorMessage: null,
    });

    expect(await refreshAugustTelemetryIfStale(actor as never)).toEqual({
      status: "already_running",
    });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("429 breaker: stops the current refresh after the batch that saw it, keeps that batch's successful readings, closes the run FAILED with the marker and starts the cooldown", async () => {
    useStatefulLogs(12); // batches of 5, 5, 2
    mockGetLockDetail.mockImplementation(async (id: string) => {
      if (id === "ext-2") {
        throw new HttpRequestError(`/locks/${id}`, 429);
      }
      return augustLockDetail(id);
    });

    const outcome = await refreshAugustTelemetryAutomatic();

    expect(outcome).toMatchObject({
      status: "rate_limited",
      refreshed: 4,
      notReturnedByProvider: 1,
      skippedAfterRateLimit: 7,
    });
    expect(mockGetLockDetail).toHaveBeenCalledTimes(5);
    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(4);
    expect(logs[0]).toMatchObject({ status: "FAILED" });
    expect(logs[0]!.errorMessage).toMatch(
      new RegExp(`^${AUGUST_RATE_LIMITED_MARKER}`),
    );
    // The fleet wasn't refreshed: lastSyncedAt is not bumped.
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    const cooldownUntil = Date.parse(
      (outcome as { cooldownUntil: string }).cooldownUntil,
    );
    expect(cooldownUntil - Date.now()).toBeGreaterThan(
      AUGUST_RATE_LIMIT_COOLDOWN_MS - 5_000,
    );
  });

  it("a non-429 provider error (e.g. 503) does NOT trip the breaker — isolated per lock as before", async () => {
    useStatefulLogs(7);
    mockGetLockDetail.mockImplementation(async (id: string) => {
      if (id === "ext-1") throw new HttpRequestError(`/locks/${id}`, 503);
      return augustLockDetail(id);
    });

    const outcome = await refreshAugustTelemetryAutomatic();

    expect(outcome).toMatchObject({
      status: "completed",
      refreshed: 6,
      notReturnedByProvider: 1,
    });
    expect(mockGetLockDetail).toHaveBeenCalledTimes(7);
  });

  it("cooldown prevents additional provider requests from EVERY fleet entry point: on-view, automatic cron and manual Refresh all", async () => {
    useStatefulLogs(3);
    logs.push({
      id: "limited",
      status: "FAILED",
      startedAt: new Date(Date.now() - 16 * 60_000),
      finishedAt: new Date(Date.now() - 15 * 60_000),
      errorMessage: `${AUGUST_RATE_LIMITED_MARKER}: August returned HTTP 429`,
    });

    const results = [
      await refreshAugustTelemetryIfStale(actor as never),
      await refreshAugustTelemetryAutomatic(),
      await refreshAugustTelemetry(actor as never),
    ];

    for (const result of results) {
      expect(result.status).toBe("cooldown");
    }
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
  });

  it("once the 30-minute cooldown has passed, refreshing resumes", async () => {
    useStatefulLogs(2);
    logs.push({
      id: "limited-old",
      status: "FAILED",
      startedAt: new Date(Date.now() - AUGUST_RATE_LIMIT_COOLDOWN_MS - 120_000),
      finishedAt: new Date(Date.now() - AUGUST_RATE_LIMIT_COOLDOWN_MS - 60_000),
      errorMessage: `${AUGUST_RATE_LIMITED_MARKER}: August returned HTTP 429`,
    });

    expect(await refreshAugustTelemetryAutomatic()).toMatchObject({
      status: "completed",
    });
    expect(mockGetLockDetail).toHaveBeenCalledTimes(2);
  });

  it("the 6-hour cron path is unchanged by the on-view gate: a refresh 2 minutes ago doesn't stop it", async () => {
    useStatefulLogs(2);
    logs.push({
      id: "recent",
      status: "SUCCEEDED",
      startedAt: new Date(Date.now() - 2 * 60_000),
      finishedAt: new Date(Date.now() - 60_000),
      errorMessage: null,
    });

    expect(await refreshAugustTelemetryAutomatic()).toMatchObject({
      status: "completed",
    });
  });

  it("on-view requires smart_devices:read and a denial touches nothing", async () => {
    useStatefulLogs(2);
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));

    await expect(refreshAugustTelemetryIfStale(actor as never)).rejects.toThrow(
      "Forbidden",
    );
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("getAugustRefreshFreshness is read-only: last success + active cooldown, never creates rows or calls August", async () => {
    useStatefulLogs(1);
    mockConnectionFindUnique.mockResolvedValue({ id: "conn-august-1" });
    const succeededAt = new Date(Date.now() - 3 * 60_000);
    const limitedAt = new Date(Date.now() - 5 * 60_000);
    mockSyncLogFindFirst.mockImplementation(
      async ({ where }: { where: Where }) =>
        where.status === "SUCCEEDED"
          ? { finishedAt: succeededAt }
          : where.errorMessage
            ? { finishedAt: limitedAt }
            : null,
    );

    const freshness = await getAugustRefreshFreshness(actor as never);

    expect(freshness).toEqual({
      lastSucceededAt: succeededAt.toISOString(),
      cooldownUntil: new Date(
        limitedAt.getTime() + AUGUST_RATE_LIMIT_COOLDOWN_MS,
      ).toISOString(),
    });
    expect(mockEnsureConnectionRows).not.toHaveBeenCalled();
    expect(mockSyncLogCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("getAugustRefreshFreshness with no AUGUST connection yet returns nulls without creating one", async () => {
    mockConnectionFindUnique.mockResolvedValue(null);
    mockEnsureConnectionRows.mockClear();

    expect(await getAugustRefreshFreshness(actor as never)).toEqual({
      lastSucceededAt: null,
      cooldownUntil: null,
    });
    expect(mockEnsureConnectionRows).not.toHaveBeenCalled();
  });
});
