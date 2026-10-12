// Command diagnostics (2026-10-13) through the REAL AugustClient and REAL
// HttpClient — only `fetch` is faked, with a time-scripted August that can
// report the new state late, report unknown/invalid, error, or hang until
// the client's own timeout. Proves the sanitized `metadata.diagnostics`
// trace (exact allow-listed keys, no sensitive data, bounded) while the
// outcome, the single PUT, polling and the AMBIGUOUS block stay exactly as
// before. Database, RBAC, kill switch, holds and audit writes are mocked.
// vi.mock() calls below are hoisted above these imports by vitest.
import { prisma } from "@stayw/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeFirstTestEligibility,
  computeLockControlEligibility,
  sendAugustLockCommand,
} from "./august-commands.service";

const { mockRecordAudit, mockTransaction } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockTransaction: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    providerDevice: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock("./lock-operational-hold.service", () => ({
  readActiveOperationalHold: vi.fn().mockResolvedValue(null),
}));

// The real builders, wrapped so one test can make them throw.
vi.mock("../lib/august-command-diagnostics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/august-command-diagnostics")>();
  return {
    ...actual,
    buildAckDiagnostics: vi.fn(actual.buildAckDiagnostics),
    buildReadOkPoll: vi.fn(actual.buildReadOkPoll),
    buildReadErrorPoll: vi.fn(actual.buildReadErrorPoll),
  };
});

vi.mock("./lock-control-settings.service", () => ({
  readLockControlSetting: vi.fn().mockResolvedValue({
    enabled: true,
    updatedAt: null,
    updatedByUserId: null,
  }),
}));

const actor = { userId: "user-1" };
const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";
const LOCK_ID = "61AC97CD87E14B2CA62FEFD106B3DB90";
const SERIAL = "S123SERIALSECRET";
const ACCESS_TOKEN = "access-token-SENSITIVE-1";
const INSTALL_ID = "install-SENSITIVE-1";
const IDENTIFIER = "email:owner-SENSITIVE@example.com";
const PROVIDER_FREE_TEXT = "User owner-SENSITIVE@example.com is not authorized";
const T0 = Date.parse("2026-10-13T12:00:00.000Z");

type LockStatus = {
  status: string;
  valid: boolean;
  dateTime: string;
  doorState?: string;
  unknownReason?: string;
};

/** A realistic GET /locks/{id} body, plus fields that must never be stored. */
function lockDetailBody(lockStatus: LockStatus) {
  return {
    LockID: LOCK_ID,
    LockName: "Front Door",
    HouseID: "house-1",
    battery: 0.53,
    batteryInfo: { infoUpdatedDate: "2026-10-13T00:00:00.000Z" },
    SerialNumber: SERIAL,
    pins: { loaded: [{ pin: "123456" }] },
    OfflineKeys: { loaded: [{ key: "OFFLINE-KEY-SENSITIVE" }] },
    Bridge: {
      operative: true,
      hyperBridge: true,
      status: { current: "online" },
    },
    LockStatus: lockStatus,
  };
}

type DetailReply = LockStatus | "hang" | Response;

interface FakeAugust {
  /** The pre-command read (always the first GET /locks/{id}). */
  pre: LockStatus;
  /** Each confirmation read, given ms since the PUT was received. */
  poll: (msSincePut: number) => DetailReply;
  put: () => Response | "hang";
}

function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });
}

function installFakeAugust(fake: FakeAugust) {
  let detailCalls = 0;
  let putAt: number | null = null;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/remoteoperate/")) {
      putAt = Date.now();
      const reply = fake.put();
      return reply === "hang" ? hangUntilAborted(init) : reply;
    }
    if (method === "GET" && url.includes(`/locks/${LOCK_ID}`)) {
      const first = detailCalls === 0;
      detailCalls++;
      const reply = first ? fake.pre : fake.poll(Date.now() - (putAt ?? 0));
      if (reply === "hang") return hangUntilAborted(init);
      if (reply instanceof Response) return reply;
      return Response.json(lockDetailBody(reply));
    }
    if (method === "GET" && url.includes("/devices/capabilities")) {
      return Response.json({ lock: { unlatch: false } });
    }
    return new Response("unexpected request in test", { status: 500 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const urls = () => fetchMock.mock.calls.map(([input]) => String(input));
  return {
    puts: () => urls().filter((u) => u.includes("/remoteoperate/")),
    detailReads: () => urls().filter((u) => u.includes(`/locks/${LOCK_ID}`)),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const statusAt = (status: string, atMs: number): LockStatus => ({
  status,
  valid: true,
  dateTime: iso(atMs),
  doorState: "closed",
});
const UNLOCKED_LONG_AGO = statusAt("unlocked", T0 - 3_600_000);

/** Reports "locked" (stamped when it changed) once `delayMs` has passed. */
function locksAfter(delayMs: number) {
  return (msSincePut: number): LockStatus =>
    msSincePut >= delayMs
      ? statusAt("locked", Date.now() - (msSincePut - delayMs))
      : UNLOCKED_LONG_AGO;
}

function allowTransaction() {
  mockTransaction.mockImplementation(async (fn) =>
    fn({
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      smartDevice: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ commandInProgressAt: null }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
    }),
  );
}

async function run(operation: "LOCK" | "UNLOCK" = "LOCK") {
  const promise = sendAugustLockCommand(actor, {
    smartDeviceId: SMART_DEVICE_ID,
    operation,
  });
  await vi.runAllTimersAsync();
  return promise;
}

function lastAudit() {
  const calls = mockRecordAudit.mock.calls;
  return calls[calls.length - 1]![0] as {
    afterState: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastDiagnostics(): any {
  return lastAudit().metadata?.diagnostics;
}

const DIAGNOSTICS_KEYS = [
  "ack",
  "budgetMs",
  "deadlineReached",
  "polls",
  "preCommandLockState",
  "preCommandLockStatusAt",
  "preCommandMs",
  "version",
];
const ACK_KEYS = [
  "elapsedMs",
  "errorClass",
  "httpStatus",
  "outcome",
  "providerErrorCode",
  "receivedAt",
];
const POLL_KEYS: Record<string, string[]> = {
  read_ok: [
    "attempt",
    "doorState",
    "durationMs",
    "lockStatus",
    "lockStatusAt",
    "lockStatusAtMinusAckMs",
    "lockStatusValid",
    "matchedExpected",
    "msSinceAck",
    "outcome",
    "unknownReason",
  ],
  read_error: [
    "attempt",
    "durationMs",
    "errorClass",
    "httpStatus",
    "msSinceAck",
    "outcome",
    "providerErrorCode",
  ],
  skipped_budget: ["attempt", "msSinceAck", "outcome"],
};
const SENSITIVE_STRINGS = [
  LOCK_ID,
  SERIAL,
  ACCESS_TOKEN,
  INSTALL_ID,
  "owner-SENSITIVE",
  "123456",
  "OFFLINE-KEY-SENSITIVE",
  "remoteoperate",
  "house-1",
  "Front Door",
  "not authorized",
];

/** Exact allow-listed keys, no sensitive values, bounded size. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectSafeDiagnostics(d: any) {
  expect(Object.keys(d).sort()).toEqual(DIAGNOSTICS_KEYS);
  expect(Object.keys(d.ack).sort()).toEqual(ACK_KEYS);
  expect(d.polls.length).toBeLessThanOrEqual(4);
  for (const poll of d.polls) {
    expect(Object.keys(poll).sort()).toEqual(POLL_KEYS[poll.outcome]);
  }
  const json = JSON.stringify(d);
  for (const s of SENSITIVE_STRINGS) expect(json).not.toContain(s);
  expect(json.length).toBeLessThan(3000);
}

describe("sendAugustLockCommand — sanitized command diagnostics (real AugustClient/HttpClient, mocked fetch)", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    process.env.AUGUST_IDENTIFIER = IDENTIFIER;
    process.env.AUGUST_INSTALL_ID = INSTALL_ID;
    process.env.AUGUST_ACCESS_TOKEN = ACCESS_TOKEN;
    process.env.AUGUST_BRAND = "yale_august";
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValue({
      id: SMART_DEVICE_ID,
      provider: "AUGUST",
      propertyId: PROPERTY_ID,
      metadata: {},
      commandInProgressAt: null,
      property: { id: PROPERTY_ID, deletedAt: null },
      providerDevice: {
        enabled: true,
        propertyId: PROPERTY_ID,
        externalDeviceId: LOCK_ID,
        rawMetadata: {},
      },
    } as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    allowTransaction();
    mockRecordAudit.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("state reported late but inside the window (~8.5s) → SUCCEEDED; trace shows every poll and the late match", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(8_500),
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result).toEqual({ status: "success", lockState: "locked" });
    expect(august.puts()).toHaveLength(1);
    // afterState is exactly what it was before diagnostics existed.
    expect(lastAudit().afterState).toEqual({
      operation: "LOCK",
      result: "SUCCEEDED",
      confirmedLockState: "locked",
    });
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d).toMatchObject({
      version: 1,
      preCommandLockState: "unlocked",
      preCommandLockStatusAt: iso(T0 - 3_600_000),
      budgetMs: 45_000,
      deadlineReached: false,
      ack: {
        outcome: "acknowledged",
        httpStatus: 202,
        receivedAt: iso(T0),
        errorClass: null,
        providerErrorCode: null,
      },
    });
    expect(
      d.polls.map((p: { msSinceAck: number; matchedExpected: boolean }) => [
        p.msSinceAck,
        p.matchedExpected,
      ]),
    ).toEqual([
      [0, false],
      [3000, false],
      [6000, false],
      [9000, true],
    ]);
    // The confirming reading's own timestamp, relative to the ack.
    expect(d.polls[3]).toMatchObject({
      outcome: "read_ok",
      lockStatus: "locked",
      lockStatusValid: true,
      lockStatusAt: iso(T0 + 8_500),
      lockStatusAtMinusAckMs: 8_500,
      doorState: "closed",
    });
    expect(d.polls[0].lockStatusAtMinusAckMs).toBe(-3_600_000);
  });

  it("state reported after the window (~12s) → AMBIGUOUS, exactly as before; trace shows 4 non-matching reads", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(12_000),
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result.status).toBe("ambiguous");
    expect(august.puts()).toHaveLength(1);
    expect(august.detailReads()).toHaveLength(5);
    expect(lastAudit().afterState).toEqual({
      operation: "LOCK",
      result: "AMBIGUOUS",
    });
    expect(lastAudit().metadata!.errorDetail).toBe(
      "Command was sent and acknowledged by August, but no definitive lock state was confirmed within the polling window.",
    );
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.polls).toHaveLength(4);
    expect(
      d.polls.every(
        (p: { outcome: string; matchedExpected: boolean }) =>
          p.outcome === "read_ok" && p.matchedExpected === false,
      ),
    ).toBe(true);
    expect(d.deadlineReached).toBe(false);
  });

  it("invalid/unknown LockStatus → AMBIGUOUS; trace records unknown, valid:false and unknownReason", async () => {
    installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: () => ({
        status: "unknown",
        valid: false,
        dateTime: iso(Date.now()),
        doorState: "init",
        unknownReason: "unknown_error_during_connect",
      }),
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result.status).toBe("ambiguous");
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.polls[0]).toMatchObject({
      outcome: "read_ok",
      lockStatus: "unknown",
      lockStatusValid: false,
      unknownReason: "unknown_error_during_connect",
      doorState: "init",
      matchedExpected: false,
    });
  });

  it("confirmation reads that time out → AMBIGUOUS, ONE PUT, reads not retried, last poll skipped for budget", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: () => "hang",
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result.status).toBe("ambiguous");
    expect(august.puts()).toHaveLength(1);
    // 1 pre-command read + 3 single-attempt polls (each a 10s timeout); the
    // 4th can't finish inside the 45s budget, so it never starts.
    expect(august.detailReads()).toHaveLength(4);
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.polls).toEqual([
      expect.objectContaining({
        attempt: 1,
        outcome: "read_error",
        errorClass: "timeout",
        httpStatus: null,
        msSinceAck: 0,
        durationMs: 10_000,
      }),
      expect.objectContaining({
        attempt: 2,
        outcome: "read_error",
        errorClass: "timeout",
        msSinceAck: 13_000,
      }),
      expect.objectContaining({
        attempt: 3,
        outcome: "read_error",
        errorClass: "timeout",
        msSinceAck: 26_000,
      }),
      { attempt: 4, outcome: "skipped_budget", msSinceAck: 36_000 },
    ]);
    expect(d.deadlineReached).toBe(true);
  });

  it("confirmation reads answering 500 / 429 → AMBIGUOUS; status and safe error code recorded, provider free text never", async () => {
    let n = 0;
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: () =>
        n++ % 2 === 0
          ? Response.json(
              { code: "INTERNAL", message: PROVIDER_FREE_TEXT },
              { status: 500 },
            )
          : Response.json(
              { code: "rate limited (free text)", message: "slow down" },
              { status: 429 },
            ),
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result.status).toBe("ambiguous");
    expect(august.puts()).toHaveLength(1);
    // Single-attempt reads: a 500 is not retried inside a poll.
    expect(august.detailReads()).toHaveLength(5);
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.polls[0]).toMatchObject({
      outcome: "read_error",
      errorClass: "http",
      httpStatus: 500,
      providerErrorCode: "INTERNAL",
    });
    // A non-identifier "code" is dropped, not truncated.
    expect(d.polls[1]).toMatchObject({
      outcome: "read_error",
      httpStatus: 429,
      providerErrorCode: null,
    });
  });

  it("empty 200 acknowledgement is recorded as 200", async () => {
    installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(0),
      put: () => new Response("", { status: 200 }),
    });

    await run();

    expect(lastDiagnostics().ack).toMatchObject({
      outcome: "acknowledged",
      httpStatus: 200,
    });
  });

  it("PUT answered 403 → FAILED, exactly as before; diagnostics show http_error with no polls and no provider message", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(0),
      put: () =>
        Response.json(
          { code: "FORBIDDEN", message: PROVIDER_FREE_TEXT },
          { status: 403 },
        ),
    });

    const result = await run();

    expect(result.status).toBe("failure");
    expect(august.puts()).toHaveLength(1);
    expect(august.detailReads()).toHaveLength(1);
    expect(lastAudit().afterState).toEqual({
      operation: "LOCK",
      result: "FAILED",
    });
    // errorDetail unchanged from before this change.
    expect(lastAudit().metadata!.errorDetail).toBe(
      `Request to /remoteoperate/${LOCK_ID}/lock?type=async failed with 403`,
    );
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.ack).toEqual({
      outcome: "http_error",
      httpStatus: 403,
      elapsedMs: 0,
      receivedAt: null,
      errorClass: "http",
      providerErrorCode: "FORBIDDEN",
    });
    expect(d.polls).toEqual([]);
  });

  it("PUT aborted (no response) → AMBIGUOUS, exactly as before; ONE PUT, never retried, no polls", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(0),
      put: () => "hang",
    });

    const result = await run();

    expect(result.status).toBe("ambiguous");
    expect(august.puts()).toHaveLength(1);
    expect(august.detailReads()).toHaveLength(1);
    expect(lastAudit().afterState).toEqual({
      operation: "LOCK",
      result: "AMBIGUOUS",
    });
    const d = lastDiagnostics();
    expectSafeDiagnostics(d);
    expect(d.ack).toEqual({
      outcome: "no_response",
      httpStatus: null,
      elapsedMs: 10_000,
      receivedAt: null,
      errorClass: "timeout",
      providerErrorCode: null,
    });
    expect(d.polls).toEqual([]);
  });

  it("after AMBIGUOUS, the next command is REJECTED with NO PUT and no diagnostics — even when telemetry now shows the requested state", async () => {
    const august = installFakeAugust({
      pre: UNLOCKED_LONG_AGO,
      poll: locksAfter(12_000),
      put: () => new Response(null, { status: 202 }),
    });
    await run();
    const ambiguousRow = lastAudit();
    expect(ambiguousRow.afterState.result).toBe("AMBIGUOUS");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { afterState: ambiguousRow.afterState },
    ] as never);

    // Later telemetry now reports "locked" — must not clear the block.
    installFakeAugust({
      pre: statusAt("locked", Date.now()),
      poll: locksAfter(0),
      put: () => new Response(null, { status: 202 }),
    });
    const second = await run();

    expect(august.puts()).toHaveLength(1);
    expect(second.status).toBe("rejected");
    const rejected = lastAudit();
    expect(rejected.afterState).toEqual({
      operation: "LOCK",
      result: "REJECTED",
    });
    expect(rejected.metadata).toEqual({
      errorDetail:
        "Blocked: last real outcome is AMBIGUOUS; requires an admin reset after an in-person check.",
    });
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.filter(([u]) => String(u).includes("/remoteoperate/")),
    ).toHaveLength(0);
  });

  it("eligibility still blocks after AMBIGUOUS (routine controls and first test)", () => {
    const ctx = {
      lockControlEnabled: true,
      operationalHold: null,
      externalDeviceId: LOCK_ID,
      connectivity: "ONLINE",
      lastOutcome: "AMBIGUOUS",
    } as Parameters<typeof computeLockControlEligibility>[0];
    expect(computeLockControlEligibility(ctx).eligible).toBe(false);
    expect(computeFirstTestEligibility(ctx).eligible).toBe(false);
  });

  it("a diagnostics bug can never change the outcome: builders that throw → same SUCCEEDED / AMBIGUOUS / FAILED, just no diagnostics", async () => {
    const { buildAckDiagnostics, buildReadErrorPoll, buildReadOkPoll } =
      await import("../lib/august-command-diagnostics");
    const boom = () => {
      throw new Error("diagnostics bug");
    };
    vi.mocked(buildAckDiagnostics).mockImplementation(boom);
    vi.mocked(buildReadOkPoll).mockImplementation(boom);
    vi.mocked(buildReadErrorPoll).mockImplementation(boom);
    try {
      let august = installFakeAugust({
        pre: UNLOCKED_LONG_AGO,
        poll: locksAfter(8_500),
        put: () => new Response(null, { status: 202 }),
      });
      expect(await run()).toEqual({ status: "success", lockState: "locked" });
      expect(august.puts()).toHaveLength(1);
      expect(lastAudit().afterState.result).toBe("SUCCEEDED");
      expect(lastAudit().metadata).toBeUndefined();

      august = installFakeAugust({
        pre: UNLOCKED_LONG_AGO,
        poll: () => "hang",
        put: () => new Response(null, { status: 202 }),
      });
      expect((await run()).status).toBe("ambiguous");
      expect(august.puts()).toHaveLength(1);
      expect(lastAudit().metadata).toEqual({
        errorDetail:
          "Command was sent and acknowledged by August, but no definitive lock state was confirmed within the polling window.",
      });

      august = installFakeAugust({
        pre: UNLOCKED_LONG_AGO,
        poll: locksAfter(0),
        put: () => Response.json({ code: "X" }, { status: 403 }),
      });
      expect((await run()).status).toBe("failure");
      expect(lastAudit().afterState.result).toBe("FAILED");
      expect(lastAudit().metadata?.diagnostics).toBeUndefined();
    } finally {
      const actual = await vi.importActual<
        typeof import("../lib/august-command-diagnostics")
      >("../lib/august-command-diagnostics");
      vi.mocked(buildAckDiagnostics).mockImplementation(
        actual.buildAckDiagnostics,
      );
      vi.mocked(buildReadOkPoll).mockImplementation(actual.buildReadOkPoll);
      vi.mocked(buildReadErrorPoll).mockImplementation(
        actual.buildReadErrorPoll,
      );
    }
  });

  it("a command refused before sending (already in state, first verification) carries no diagnostics", async () => {
    const august = installFakeAugust({
      pre: statusAt("locked", T0 - 1000),
      poll: locksAfter(0),
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run();

    expect(result.status).toBe("rejected");
    expect(august.puts()).toHaveLength(0);
    expect(lastAudit().metadata?.diagnostics).toBeUndefined();
  });
});
