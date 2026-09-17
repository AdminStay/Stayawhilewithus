import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTransaction } = vi.hoisted(() => ({ mockTransaction: vi.fn() }));

vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    integrationSyncLog: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: mockTransaction,
  },
}));

import { prisma } from "@stayw/database";

import {
  beginScheduleSync,
  finishScheduleSync,
  getLastSyncAttempt,
  readDurableSnapshot,
  writeDurableSnapshot,
} from "./schedule-persistence";

const CONNECTION_ID = "conn-1";

beforeEach(() => {
  vi.mocked(prisma.integrationConnection.upsert)
    .mockReset()
    .mockResolvedValue({ id: CONNECTION_ID } as never);
  vi.mocked(prisma.integrationConnection.findUnique).mockReset();
  vi.mocked(prisma.integrationConnection.update)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(prisma.integrationSyncLog.findFirst).mockReset();
  vi.mocked(prisma.integrationSyncLog.update)
    .mockReset()
    .mockResolvedValue({} as never);
  mockTransaction.mockReset();
});

describe("readDurableSnapshot", () => {
  it("returns null when no connection row exists yet", async () => {
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce(
      null as never,
    );
    expect(await readDurableSnapshot()).toBeNull();
  });

  it("returns null when the connection exists but has never synced successfully", async () => {
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      metadata: {},
      lastSyncedAt: null,
    } as never);
    expect(await readDurableSnapshot()).toBeNull();
  });

  it("revives serialized shift/warning data back into the real shape, including real Date instants", async () => {
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      lastSyncedAt: new Date("2026-01-05T12:00:00.000Z"),
      metadata: {
        shifts: [
          {
            personKey: "Taylor",
            start: "2026-01-05T12:00:00.000Z",
            end: "2026-01-05T14:00:00.000Z",
            label: "Operations",
          },
        ],
        warnings: [{ type: "DAY_NAME_MISMATCH", detail: "x" }],
        fetchedAt: "2026-01-05T12:00:00.000Z",
      },
    } as never);

    const result = await readDurableSnapshot();

    expect(result?.shifts).toEqual([
      {
        personKey: "Taylor",
        start: new Date("2026-01-05T12:00:00.000Z"),
        end: new Date("2026-01-05T14:00:00.000Z"),
        label: "Operations",
      },
    ]);
    expect(result?.warnings).toEqual([
      { type: "DAY_NAME_MISMATCH", detail: "x" },
    ]);
    expect(result?.fetchedAt).toEqual(new Date("2026-01-05T12:00:00.000Z"));
  });
});

describe("writeDurableSnapshot", () => {
  it("persists shifts within the retained window and excludes ones far outside it", async () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const shifts = [
      // Far in the past relative to `now` — excluded.
      {
        personKey: "Taylor",
        start: new Date("2026-01-01T00:00:00.000Z"),
        end: new Date("2026-01-01T01:00:00.000Z"),
      },
      // Overlaps `now` — included.
      {
        personKey: "Jordan",
        start: now,
        end: new Date(now.getTime() + 3_600_000),
      },
      // Far in the future relative to `now` — excluded.
      {
        personKey: "Casey",
        start: new Date("2027-01-01T00:00:00.000Z"),
        end: new Date("2027-01-01T01:00:00.000Z"),
      },
    ];

    await writeDurableSnapshot(shifts, [], now);

    const call = vi.mocked(prisma.integrationConnection.update).mock
      .calls[0]![0] as unknown as {
      data: {
        metadata: { shifts: { personKey: string }[] };
        lastSyncedAt: Date;
        status: string;
      };
    };
    expect(call.data.metadata.shifts.map((s) => s.personKey)).toEqual([
      "Jordan",
    ]);
    expect(call.data.lastSyncedAt).toEqual(now);
    expect(call.data.status).toBe("CONNECTED");
  });
});

describe("beginScheduleSync", () => {
  it("acquires the advisory lock and creates a RUNNING sync log", async () => {
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
          integrationSyncLog: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "log-1" }),
            update: vi.fn(),
          },
        }),
    );

    expect(await beginScheduleSync()).toEqual({
      logId: "log-1",
      alreadyRunning: false,
    });
  });

  it("reports alreadyRunning when the advisory lock is already held by another attempt", async () => {
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]) }),
    );

    expect(await beginScheduleSync()).toEqual({ alreadyRunning: true });
  });

  it("reports alreadyRunning when a fresh RUNNING row already exists, without creating a second one", async () => {
    const create = vi.fn();
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
          integrationSyncLog: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "log-old", startedAt: new Date() }),
            create,
            update: vi.fn(),
          },
        }),
    );

    expect(await beginScheduleSync()).toEqual({ alreadyRunning: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("self-heals a stale RUNNING row (older than the threshold) to FAILED before starting a new attempt", async () => {
    const update = vi.fn();
    const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000);
    mockTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
          integrationSyncLog: {
            findFirst: vi
              .fn()
              .mockResolvedValue({ id: "log-old", startedAt: staleStartedAt }),
            create: vi.fn().mockResolvedValue({ id: "log-new" }),
            update,
          },
        }),
    );

    const result = await beginScheduleSync();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-old" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(result).toEqual({ logId: "log-new", alreadyRunning: false });
  });
});

describe("finishScheduleSync", () => {
  it("SUCCEEDED records recordsProcessed and clears any error message", async () => {
    await finishScheduleSync("log-1", {
      status: "SUCCEEDED",
      recordsProcessed: 42,
    });

    expect(prisma.integrationSyncLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        recordsProcessed: 42,
        errorMessage: null,
      }),
    });
  });

  it("FAILED records the error message with 0 recordsProcessed", async () => {
    await finishScheduleSync("log-1", {
      status: "FAILED",
      errorMessage: "boom",
    });

    expect(prisma.integrationSyncLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({
        status: "FAILED",
        recordsProcessed: 0,
        errorMessage: "boom",
      }),
    });
  });
});

describe("getLastSyncAttempt", () => {
  it("returns null when the connection row doesn't exist yet", async () => {
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce(
      null as never,
    );
    expect(await getLastSyncAttempt()).toBeNull();
  });

  it("returns the most recent sync log's status/error/startedAt", async () => {
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: CONNECTION_ID,
    } as never);
    const startedAt = new Date("2026-01-05T12:00:00.000Z");
    vi.mocked(prisma.integrationSyncLog.findFirst).mockResolvedValueOnce({
      status: "FAILED",
      errorMessage: "TIMEOUT: no response",
      startedAt,
    } as never);

    const result = await getLastSyncAttempt();

    expect(result).toEqual({
      status: "FAILED",
      errorMessage: "TIMEOUT: no response",
      startedAt,
    });
  });
});
