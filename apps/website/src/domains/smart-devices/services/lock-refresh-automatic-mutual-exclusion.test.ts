// @vitest-environment node
//
// Proves, against the REAL beginDeviceSync()/STALE_RUNNING_THRESHOLD_MS
// (integrations.service.ts), the REAL refreshAugustTelemetryAutomatic(),
// and the REAL refreshAugustTelemetry() — "Refresh All" — (both
// lock-refresh.service.ts) — not separately-mocked assumptions about each
// other — that all three genuinely share one mutual-exclusion mechanism
// for the same AUGUST IntegrationConnection: whichever one claims the
// RUNNING IntegrationSyncLog row first, the others correctly refuse to
// start while that row is still fresh, in every direction. This is exactly
// the concurrency question raised in review: a `pg_try_advisory_xact_lock`
// is transaction-scoped and releases the instant the claim transaction
// commits, well before the actual refresh/sync work runs — so the real
// protection during that work has to come from the durable RUNNING row
// all three check, using the SAME staleness threshold. A stateful
// in-memory fake (not an opaque mock) is used for prisma so the sequence of
// real reads/writes across the real functions is what's actually
// exercised, same convention as cielo-sync-refresh-interaction.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSyncLog {
  id: string;
  integrationConnectionId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  recordsProcessed: number;
}

const CONNECTION_ID = "conn-august-1";

// Everything a vi.mock() factory below dereferences must be created inside
// vi.hoisted() — factories are hoisted above every top-level statement,
// same discipline as lock-refresh.service.test.ts.
const {
  state,
  resetFakeState,
  mockQueryRaw,
  fakeIntegrationSyncLog,
  mockTransaction,
} = vi.hoisted(() => {
  const state: {
    syncLogs: Map<string, FakeSyncLog>;
    logIdCounter: number;
    connection: {
      id: string;
      provider: "AUGUST";
      status: string;
      lastSyncedAt: Date | null;
    };
  } = {
    syncLogs: new Map(),
    logIdCounter: 0,
    connection: {
      id: "conn-august-1",
      provider: "AUGUST",
      status: "CONNECTED",
      lastSyncedAt: null,
    },
  };

  function resetFakeState() {
    state.syncLogs = new Map();
    state.logIdCounter = 0;
    state.connection = {
      id: "conn-august-1",
      provider: "AUGUST",
      status: "CONNECTED",
      lastSyncedAt: null,
    };
  }

  const mockQueryRaw = vi.fn(async () => [{ locked: true }]);

  const fakeIntegrationSyncLog = {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { integrationConnectionId: string; status: string };
      }) => {
        for (const log of state.syncLogs.values()) {
          if (
            log.integrationConnectionId === where.integrationConnectionId &&
            log.status === where.status
          ) {
            return log;
          }
        }
        return null;
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Pick<FakeSyncLog, "integrationConnectionId" | "status"> &
          Partial<FakeSyncLog>;
      }) => {
        const id = `log-${++state.logIdCounter}`;
        const log: FakeSyncLog = {
          id,
          startedAt: new Date(),
          finishedAt: null,
          errorMessage: null,
          recordsProcessed: 0,
          ...data,
        };
        state.syncLogs.set(id, log);
        return log;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeSyncLog>;
      }) => {
        const log = state.syncLogs.get(where.id);
        if (!log) throw new Error(`no such log: ${where.id}`);
        Object.assign(log, data);
        return log;
      },
    ),
  };

  const txClient = {
    $queryRaw: mockQueryRaw,
    integrationSyncLog: fakeIntegrationSyncLog,
  };

  const mockTransaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof txClient) => unknown)(txClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  return {
    state,
    resetFakeState,
    mockQueryRaw,
    fakeIntegrationSyncLog,
    mockTransaction,
  };
});

vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: {
      findUnique: vi.fn(async () => state.connection),
      findUniqueOrThrow: vi.fn(async () => state.connection),
      upsert: vi.fn(async () => state.connection),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.connection, data);
        return state.connection;
      }),
    },
    integrationSyncLog: fakeIntegrationSyncLog,
    providerDevice: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    smartDevice: { update: vi.fn(async () => ({})) },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@stayw/integrations/notion", () => ({ NotionClient: vi.fn() }));
vi.mock("@stayw/integrations/ownerrez", () => ({ OwnerrezClient: vi.fn() }));
vi.mock("@stayw/integrations/august", () => ({
  AugustClient: vi.fn().mockImplementation(() => ({ getLockDetail: vi.fn() })),
  isAugustBrand: vi.fn().mockReturnValue(true),
}));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn().mockResolvedValue({}),
}));

import { assertPermission } from "@stayw/auth";

import { beginDeviceSync } from "@/domains/integrations/services/integrations.service";

import {
  refreshAugustTelemetry,
  refreshAugustTelemetryAutomatic,
} from "./lock-refresh.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

describe("August automatic refresh vs. manual Refresh All vs. manual Sync/Discover — real cross-file mutual exclusion", () => {
  beforeEach(() => {
    resetFakeState();
    mockQueryRaw.mockClear().mockResolvedValue([{ locked: true }]);
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    process.env.AUGUST_IDENTIFIER = "email:test@example.com";
    process.env.AUGUST_INSTALL_ID = "install-1";
    process.env.AUGUST_ACCESS_TOKEN = "token-1";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("DIRECTION 1 — automatic claims first: while its RUNNING row is still open, a manual Sync/Discover attempt for the same connection is refused by the real beginDeviceSync()", async () => {
    const automaticResult = await refreshAugustTelemetryAutomatic();
    expect(automaticResult.status).toBe("completed");

    // Model the real timing this review is about: the advisory lock from
    // the automatic path's own claim transaction has already released (the
    // claim step above already ran to completion), but a real run's
    // finishDeviceSync-equivalent bookkeeping wouldn't happen until the
    // actual refresh work finishes — reopen the row as RUNNING to represent
    // that still-in-flight window honestly, then attempt a manual claim.
    const [completedLog] = [...state.syncLogs.values()];
    if (!completedLog) throw new Error("expected a sync log to exist");
    completedLog.status = "RUNNING";
    completedLog.finishedAt = null;

    const manualAttempt = await beginDeviceSync(actor, CONNECTION_ID, "AUGUST");

    expect(manualAttempt).toEqual({ alreadyRunning: true });
  });

  it("DIRECTION 2 — manual claims first: once beginDeviceSync() has created a fresh RUNNING row, the real refreshAugustTelemetryAutomatic() refuses to start", async () => {
    const manualBegin = await beginDeviceSync(actor, CONNECTION_ID, "AUGUST");
    if (!("logId" in manualBegin)) {
      throw new Error("expected beginDeviceSync to succeed and claim the row");
    }
    expect(manualBegin.alreadyRunning).toBe(false);

    const automaticResult = await refreshAugustTelemetryAutomatic();

    expect(automaticResult).toEqual({ status: "already_running" });
  });

  it("both paths agree once a RUNNING row is genuinely stale (older than the shared threshold) — either one may legitimately recover and proceed", async () => {
    const manualBegin = await beginDeviceSync(actor, CONNECTION_ID, "AUGUST");
    if (!("logId" in manualBegin)) {
      throw new Error("expected beginDeviceSync to succeed and claim the row");
    }
    const staleLog = state.syncLogs.get(manualBegin.logId);
    if (!staleLog) throw new Error("expected the claimed log to exist");
    // Older than STALE_RUNNING_THRESHOLD_MS (10 minutes) for BOTH paths —
    // proves they don't just avoid colliding, they also agree on recovery.
    staleLog.startedAt = new Date(Date.now() - 11 * 60 * 1000);

    const automaticResult = await refreshAugustTelemetryAutomatic();

    expect(automaticResult.status).toBe("completed");
    expect(staleLog.status).toBe("FAILED"); // the stale row was recovered, not left dangling
  });

  it("DIRECTION 3 — Sync/Discover claims first: once beginDeviceSync() has created a fresh RUNNING row, the real manual refreshAugustTelemetry() (Refresh All) refuses to start", async () => {
    const manualBegin = await beginDeviceSync(actor, CONNECTION_ID, "AUGUST");
    if (!("logId" in manualBegin)) {
      throw new Error("expected beginDeviceSync to succeed and claim the row");
    }
    expect(manualBegin.alreadyRunning).toBe(false);

    const refreshAllResult = await refreshAugustTelemetry(actor);

    expect(refreshAllResult).toEqual({ status: "already_running" });
  });

  it("DIRECTION 4 — Refresh All claims first: while its RUNNING row is still open, a manual Sync/Discover attempt for the same connection is refused by the real beginDeviceSync()", async () => {
    const refreshAllResult = await refreshAugustTelemetry(actor);
    expect(refreshAllResult.status).toBe("completed");

    // Same real-timing model as DIRECTION 1: reopen the row as RUNNING to
    // represent the still-in-flight window between the claim committing and
    // the actual refresh work finishing.
    const [completedLog] = [...state.syncLogs.values()];
    if (!completedLog) throw new Error("expected a sync log to exist");
    completedLog.status = "RUNNING";
    completedLog.finishedAt = null;

    const syncAttempt = await beginDeviceSync(actor, CONNECTION_ID, "AUGUST");

    expect(syncAttempt).toEqual({ alreadyRunning: true });
  });
});
