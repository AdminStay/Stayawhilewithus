// End-to-end command-path test through the REAL AugustClient and REAL
// HttpClient (2026-09-25, the Coco Vista incident). Only `fetch` is faked,
// with realistic August wire responses — including the async remote-operate
// PUT's real 2xx EMPTY body. august-commands.service.test.ts mocks
// client.lock()/unlock() entirely, which is exactly why the empty-body JSON
// parse failure reached Production. The database, RBAC, kill switch, and
// audit writes are mocked here; the provider path is not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./lock-control-settings.service", () => ({
  readLockControlSetting: vi
    .fn()
    .mockResolvedValue({
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    }),
}));

import { prisma } from "@stayw/database";

import { sendAugustLockCommand } from "./august-commands.service";

const actor = { userId: "user-1" };
const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";
const LOCK_ID = "61AC97CD87E14B2CA62FEFD106B3DB90";
const SERIAL = "S123";

/** A realistic GET /locks/{id} body for an online, bridged lock. */
function lockDetailBody(status: "locked" | "unlocked") {
  return {
    LockID: LOCK_ID,
    LockName: "Front Door",
    HouseID: "house-1",
    battery: 0.53,
    batteryInfo: { infoUpdatedDate: "2026-09-25T00:00:00.000Z" },
    SerialNumber: SERIAL,
    Bridge: {
      operative: true,
      hyperBridge: true,
      status: { current: "online" },
    },
    LockStatus: {
      status,
      valid: true,
      dateTime: "2026-09-25T17:14:42.687Z",
      doorState: "closed",
    },
  };
}

interface FakeAugust {
  /** Lock state each successive GET /locks/{id} reports (last value repeats). */
  detailStates: Array<"locked" | "unlocked">;
  /** What the async PUT answers. */
  put: () => Response;
}

function installFakeAugust(fake: FakeAugust) {
  let detailCalls = 0;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/remoteoperate/")) return fake.put();
    if (method === "GET" && url.includes(`/locks/${LOCK_ID}`)) {
      const state =
        fake.detailStates[Math.min(detailCalls, fake.detailStates.length - 1)]!;
      detailCalls++;
      return Response.json(lockDetailBody(state));
    }
    if (method === "GET" && url.includes("/devices/capabilities")) {
      return Response.json({ lock: { unlatch: false } });
    }
    return new Response("unexpected request in test", { status: 500 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const calls = () =>
    fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: (
        (init as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase(),
    }));
  return {
    physicalCommands: () =>
      calls().filter((c) => c.url.includes("/remoteoperate/")),
    nonCommandMethods: () =>
      calls()
        .filter((c) => !c.url.includes("/remoteoperate/"))
        .map((c) => c.method),
    detailReads: () =>
      calls().filter((c) => c.url.includes(`/locks/${LOCK_ID}`)).length,
  };
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

async function run(operation: "LOCK" | "UNLOCK") {
  const promise = sendAugustLockCommand(actor, {
    smartDeviceId: SMART_DEVICE_ID,
    operation,
  });
  await vi.runAllTimersAsync();
  return promise;
}

function lastAuditResult() {
  const calls = mockRecordAudit.mock.calls;
  return calls[calls.length - 1]![0].afterState;
}

describe("sendAugustLockCommand through the real AugustClient/HttpClient (async empty-body acknowledgement)", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.AUGUST_IDENTIFIER = "email:test@example.com";
    process.env.AUGUST_INSTALL_ID = "install-1";
    process.env.AUGUST_ACCESS_TOKEN = "token-1";
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
    allowTransaction();
    mockRecordAudit.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("empty 202 + a poll confirming LOCKED → SUCCEEDED, with exactly ONE physical command", async () => {
    const august = installFakeAugust({
      detailStates: ["unlocked", "locked"],
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run("LOCK");

    expect(result).toEqual({ status: "success", lockState: "locked" });
    expect(august.physicalCommands()).toEqual([
      expect.objectContaining({
        method: "PUT",
        url: expect.stringContaining(
          `/remoteoperate/${LOCK_ID}/lock?type=async`,
        ),
      }),
    ]);
    expect(lastAuditResult()).toMatchObject({
      result: "SUCCEEDED",
      confirmedLockState: "locked",
    });
  });

  it("the empty 202 alone never counts as success: it continues to confirmation polling (pre-read + ≥1 poll read)", async () => {
    const august = installFakeAugust({
      detailStates: ["unlocked", "unlocked", "locked"],
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run("LOCK");

    expect(result.status).toBe("success");
    // 1 pre-command read + 2 polls (the first poll still saw "unlocked").
    expect(august.detailReads()).toBe(3);
  });

  it("empty 202 + polls that never confirm → AMBIGUOUS, still exactly ONE physical command, never retried", async () => {
    const august = installFakeAugust({
      detailStates: ["unlocked"],
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run("LOCK");

    expect(result.status).toBe("ambiguous");
    expect(august.physicalCommands()).toHaveLength(1);
    // 1 pre-command read + 4 confirmation polls.
    expect(august.detailReads()).toBe(5);
    expect(lastAuditResult()).toMatchObject({ result: "AMBIGUOUS" });
  });

  it("definite provider rejection (403 with a body) → FAILED, ONE physical command, no polling", async () => {
    const august = installFakeAugust({
      detailStates: ["unlocked"],
      put: () =>
        Response.json({ message: "User is not authorized" }, { status: 403 }),
    });

    const result = await run("LOCK");

    expect(result.status).toBe("failure");
    expect(august.physicalCommands()).toHaveLength(1);
    expect(august.detailReads()).toBe(1);
    expect(lastAuditResult()).toMatchObject({ result: "FAILED" });
  });

  it("UNLOCK (also the path the re-lock flow's counterpart uses) works the same: empty 202 + poll confirming UNLOCKED → SUCCEEDED", async () => {
    const august = installFakeAugust({
      detailStates: ["locked", "unlocked"],
      put: () => new Response(null, { status: 202 }),
    });

    const result = await run("UNLOCK");

    expect(result).toEqual({ status: "success", lockState: "unlocked" });
    expect(august.physicalCommands()).toEqual([
      expect.objectContaining({
        url: expect.stringContaining(
          `/remoteoperate/${LOCK_ID}/unlock?type=async`,
        ),
      }),
    ]);
  });

  it("confirmation polling uses GET reads only — the ONLY non-GET request is the single PUT", async () => {
    const august = installFakeAugust({
      detailStates: ["unlocked"],
      put: () => new Response(null, { status: 202 }),
    });

    await run("LOCK");

    expect(new Set(august.nonCommandMethods())).toEqual(new Set(["GET"]));
    expect(august.physicalCommands().map((c) => c.method)).toEqual(["PUT"]);
  });
});
