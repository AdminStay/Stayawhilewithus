import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("./schedule-source", () => ({
  fetchScheduleSheetCsv: vi.fn(),
}));

vi.mock("./schedule-persistence", () => ({
  beginScheduleSync: vi.fn(),
  finishScheduleSync: vi.fn(),
  getLastSyncAttempt: vi.fn(),
  readDurableSnapshot: vi.fn(),
  writeDurableSnapshot: vi.fn(),
}));

const actor = { userId: "user-1" };

// A tiny, real-shaped calendar-grid CSV (fake names, mirroring the real
// structure — see sheet-schedule-parser.test.ts's own SAMPLE_WEEK). Monday
// 2026-01-05, one hourly slot with Taylor on Operations 6–7 AM Chicago.
const SAMPLE_CSV = [
  ',"January 5, 2026",,',
  ",Monday,,",
  ",Operations,MOD,EA",
  "6:00-7:00 AM,Taylor,-,-",
  "7:00-8:00 AM,Taylor,-,-",
  "",
].join("\n");

/**
 * Every test dynamically re-imports the service module after
 * vi.resetModules() — schedule.service.ts keeps an in-memory micro-cache as
 * module-scoped state (a perf optimization in FRONT of the durable DB
 * store, see its own doc comment), so without this reset, one test's
 * result would silently leak into the next via that cache.
 *
 * `beginScheduleSync`/`finishScheduleSync`/`writeDurableSnapshot` are given
 * harmless default resolutions here (a real sync completing normally,
 * durable writes succeeding) so most tests don't need to think about the
 * persistence layer at all — only tests that care about a specific
 * durability/concurrency behavior override them.
 */
async function freshService() {
  vi.resetModules();
  const authMock = await import("@stayw/auth");
  const sourceMock = await import("./schedule-source");
  const persistenceMock = await import("./schedule-persistence");
  vi.mocked(authMock.assertPermission).mockReset();
  vi.mocked(sourceMock.fetchScheduleSheetCsv).mockReset();
  vi.mocked(persistenceMock.beginScheduleSync)
    .mockReset()
    .mockResolvedValue({ logId: "log-1", alreadyRunning: false });
  vi.mocked(persistenceMock.finishScheduleSync)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(persistenceMock.writeDurableSnapshot)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(persistenceMock.readDurableSnapshot)
    .mockReset()
    .mockResolvedValue(null);
  vi.mocked(persistenceMock.getLastSyncAttempt)
    .mockReset()
    .mockResolvedValue(null);
  const service = await import("./schedule.service");
  return {
    service,
    fetchScheduleSheetCsv: sourceMock.fetchScheduleSheetCsv,
    beginScheduleSync: persistenceMock.beginScheduleSync,
    finishScheduleSync: persistenceMock.finishScheduleSync,
    readDurableSnapshot: persistenceMock.readDurableSnapshot,
    getLastSyncAttempt: persistenceMock.getLastSyncAttempt,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("getTeamAvailabilitySnapshot", () => {
  it("asserts team:read", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });
    const authMock = await import("@stayw/auth");

    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:00:00.000Z"),
    );

    expect(authMock.assertPermission).toHaveBeenCalledWith(actor, "team:read");
  });

  it("shows WORKING_NOW for a person on shift at `now`, in Chicago time", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    // 6:30 AM Chicago (CST, UTC-6) on Jan 5, 2026 = 12:30 UTC.
    const now = new Date("2026-01-05T12:30:00.000Z");
    const result = await service.getTeamAvailabilitySnapshot(actor, now);

    expect(result.workingNow).toHaveLength(1);
    expect(result.workingNow[0]?.person.sourceKey).toBe("Taylor");
    expect(result.workingNow[0]?.role).toBe("Operations");
    expect(result.workingNow[0]?.timeLabel).toBe("until 8:00 AM");
    // No real StayWhile User matches any real sheet identity — see
    // team-identity-mapping.ts, deliberately still empty.
    expect(result.workingNow[0]?.person.stayWhileUserId).toBeNull();
    expect(result.unmappedCount).toBe(1);
  });

  it("shows SCHEDULED_LATER before the shift starts", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    // 5:00 AM Chicago Jan 5 2026 = 11:00 UTC — before the 6 AM shift.
    const now = new Date("2026-01-05T11:00:00.000Z");
    const result = await service.getTeamAvailabilitySnapshot(actor, now);

    expect(result.workingNow).toHaveLength(0);
    expect(result.comingUp).toHaveLength(1);
    expect(result.comingUp[0]?.timeLabel).toBe("6:00 AM – 8:00 AM");
  });

  it("shows OFF once today's shifts have all ended", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    // 3:00 PM Chicago Jan 5 2026 = 21:00 UTC — well after the 8 AM shift end.
    const now = new Date("2026-01-05T21:00:00.000Z");
    const result = await service.getTeamAvailabilitySnapshot(actor, now);

    expect(result.off).toHaveLength(1);
    expect(result.off[0]?.person.sourceKey).toBe("Taylor");
  });

  it("returns an empty, non-stale-crashing result when the source has never been fetched successfully and nothing durable exists yet", async () => {
    const { service, fetchScheduleSheetCsv, getLastSyncAttempt } =
      await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: false,
      reason: "NON_200",
      detail: "HTTP 500",
    });
    vi.mocked(getLastSyncAttempt).mockResolvedValue({
      status: "FAILED",
      errorMessage: "NON_200: HTTP 500",
      startedAt: new Date(),
    });

    const result = await service.getTeamAvailabilitySnapshot(actor);

    expect(result.workingNow).toEqual([]);
    expect(result.comingUp).toEqual([]);
    expect(result.off).toEqual([]);
    expect(result.lastSyncedAt).toBeNull();
    expect(result.isStale).toBe(true);
    expect(result.lastFetchError).toBe("NON_200: HTTP 500");
  });

  it("keeps showing the last known-good data (never a false empty schedule) after a later fetch fails", async () => {
    const { service, fetchScheduleSheetCsv, getLastSyncAttempt } =
      await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValueOnce({
      ok: true,
      csvText: SAMPLE_CSV,
    });
    vi.mocked(getLastSyncAttempt).mockResolvedValueOnce(null); // no failure yet
    const now = new Date("2026-01-05T12:30:00.000Z");
    const firstResult = await service.getTeamAvailabilitySnapshot(actor, now);
    expect(firstResult.workingNow).toHaveLength(1);
    expect(firstResult.lastFetchError).toBeNull();

    // The next real fetch attempt (forced, bypassing the reuse window) fails.
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValueOnce({
      ok: false,
      reason: "TIMEOUT",
      detail: "No response within 15s.",
    });
    await service.forceRefreshSchedule(actor);

    vi.mocked(getLastSyncAttempt).mockResolvedValueOnce({
      status: "FAILED",
      errorMessage: "TIMEOUT: No response within 15s.",
      startedAt: new Date(),
    });
    const secondResult = await service.getTeamAvailabilitySnapshot(actor, now);
    // Still shows Taylor's real, previously-fetched shift — not wiped by
    // the failed refresh. The in-memory micro-cache is still fresh (real
    // time elapsed in this test is milliseconds), so this doesn't even
    // need the durable fallback — see the dedicated durability test below
    // for that.
    expect(secondResult.workingNow).toHaveLength(1);
    expect(secondResult.lastFetchError).toBe(
      "TIMEOUT: No response within 15s.",
    );
  });

  it("falls back to the durable last-known-good snapshot when the in-memory cache is cold and a fresh fetch fails — this is the actual server-restart-survival behavior", async () => {
    const {
      service,
      fetchScheduleSheetCsv,
      readDurableSnapshot,
      getLastSyncAttempt,
    } = await freshService();
    // The in-memory cache starts cold (freshService() just reset modules —
    // simulates a fresh server process after a restart). A live fetch fails...
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: false,
      reason: "TIMEOUT",
      detail: "No response within 15s.",
    });
    // ...but a PRIOR process's successful sync is still sitting in the
    // database, exactly what readDurableSnapshot() would return for real.
    const now = new Date("2026-01-05T12:30:00.000Z");
    vi.mocked(readDurableSnapshot).mockResolvedValue({
      shifts: [
        {
          personKey: "Taylor",
          start: new Date("2026-01-05T12:00:00.000Z"),
          end: new Date("2026-01-05T14:00:00.000Z"),
          label: "Operations",
        },
      ],
      warnings: [],
      fetchedAt: new Date("2026-01-05T10:00:00.000Z"),
    });
    vi.mocked(getLastSyncAttempt).mockResolvedValue({
      status: "FAILED",
      errorMessage: "TIMEOUT: No response within 15s.",
      startedAt: now,
    });

    const result = await service.getTeamAvailabilitySnapshot(actor, now);

    expect(result.workingNow).toHaveLength(1);
    expect(result.workingNow[0]?.person.sourceKey).toBe("Taylor");
    expect(result.lastSyncedAt).toEqual(new Date("2026-01-05T10:00:00.000Z"));
    expect(result.lastFetchError).toBe("TIMEOUT: No response within 15s.");
  });

  it("reuses the in-memory cache within the reuse window instead of re-fetching on every call", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:30:00.000Z"),
    );
    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:31:00.000Z"),
    );

    expect(fetchScheduleSheetCsv).toHaveBeenCalledTimes(1);
  });

  it("concurrent-refresh protection: never calls the Sheet fetch when another sync is already in flight", async () => {
    const { service, fetchScheduleSheetCsv, beginScheduleSync } =
      await freshService();
    vi.mocked(beginScheduleSync).mockResolvedValue({ alreadyRunning: true });

    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:30:00.000Z"),
    );

    expect(fetchScheduleSheetCsv).not.toHaveBeenCalled();
  });
});

describe("forceRefreshSchedule", () => {
  it("asserts team:update and always re-fetches, bypassing the reuse window", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });
    const authMock = await import("@stayw/auth");

    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:30:00.000Z"),
    );
    await service.forceRefreshSchedule(actor);

    expect(fetchScheduleSheetCsv).toHaveBeenCalledTimes(2);
    expect(authMock.assertPermission).toHaveBeenCalledWith(
      actor,
      "team:update",
    );
  });
});

describe("runScheduleSync (the trigger-agnostic sync used by both manual refresh and any future automatic trigger)", () => {
  it("never touches the Google Sheet — only ever issues a read (GET) via fetchScheduleSheetCsv, never a write", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    await service.runScheduleSync();

    expect(fetchScheduleSheetCsv).toHaveBeenCalledTimes(1);
  });

  it("on success, persists the durable snapshot and finishes the sync log as SUCCEEDED", async () => {
    const { service, fetchScheduleSheetCsv, finishScheduleSync } =
      await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    await service.runScheduleSync();

    expect(finishScheduleSync).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
  });

  it("on a malformed/empty parse (0 slots), finishes the sync log as FAILED and never writes a durable snapshot", async () => {
    const { service, fetchScheduleSheetCsv, finishScheduleSync } =
      await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: "not,a,real,schedule\n",
    });
    const persistenceMock = await import("./schedule-persistence");

    await service.runScheduleSync();

    expect(finishScheduleSync).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({
        status: "FAILED",
        errorMessage: expect.stringContaining("MALFORMED_SCHEDULE"),
      }),
    );
    expect(persistenceMock.writeDurableSnapshot).not.toHaveBeenCalled();
  });
});

describe("getScheduleForRange", () => {
  it("asserts team:read and returns 1 day for 'today' with merged, sorted entries", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });
    const authMock = await import("@stayw/auth");

    const now = new Date("2026-01-05T12:30:00.000Z");
    const result = await service.getScheduleForRange(actor, "today", now);

    expect(authMock.assertPermission).toHaveBeenCalledWith(actor, "team:read");
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.date).toEqual({ year: 2026, month: 1, day: 5 });
    // The two contiguous 6-7/7-8 AM slots merge into one 6-8 AM block.
    expect(result.days[0]?.entries).toEqual([
      {
        sourceKey: "Taylor",
        mapped: false,
        role: "Operations",
        timeLabel: "6:00 AM – 8:00 AM",
      },
    ]);
  });

  it("returns 7 days for 'week', starting today", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    const now = new Date("2026-01-05T12:30:00.000Z");
    const result = await service.getScheduleForRange(actor, "week", now);

    expect(result.days).toHaveLength(7);
    expect(result.days[0]?.date).toEqual({ year: 2026, month: 1, day: 5 });
    expect(result.days[6]?.date).toEqual({ year: 2026, month: 1, day: 11 });
  });

  it("'tomorrow' starts one Chicago calendar day after today, with no entries for this fixture", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });

    const now = new Date("2026-01-05T12:30:00.000Z");
    const result = await service.getScheduleForRange(actor, "tomorrow", now);

    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.date).toEqual({ year: 2026, month: 1, day: 6 });
    expect(result.days[0]?.entries).toEqual([]);
  });
});

describe("getUnresolvedScheduleIdentities", () => {
  it("asserts team:manage and lists every distinct unmapped source identity", async () => {
    const { service, fetchScheduleSheetCsv } = await freshService();
    vi.mocked(fetchScheduleSheetCsv).mockResolvedValue({
      ok: true,
      csvText: SAMPLE_CSV,
    });
    const authMock = await import("@stayw/auth");

    await service.getTeamAvailabilitySnapshot(
      actor,
      new Date("2026-01-05T12:30:00.000Z"),
    );
    const result = await service.getUnresolvedScheduleIdentities(actor);

    expect(authMock.assertPermission).toHaveBeenCalledWith(
      actor,
      "team:manage",
    );
    expect(result).toEqual(["Taylor"]);
  });
});
