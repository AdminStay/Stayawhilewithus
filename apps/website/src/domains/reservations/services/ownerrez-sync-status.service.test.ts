import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertPermission,
  mockConnectionFindUnique,
  mockSyncLogFindMany,
  mockAuditFindFirst,
  mockNotificationFindFirst,
  mockCreateForRole,
} = vi.hoisted(() => ({
  mockAssertPermission: vi.fn().mockResolvedValue(undefined),
  mockConnectionFindUnique: vi.fn(),
  mockSyncLogFindMany: vi.fn(),
  mockAuditFindFirst: vi.fn(),
  mockNotificationFindFirst: vi.fn(),
  mockCreateForRole: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({ assertPermission: mockAssertPermission }));
vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: { findUnique: mockConnectionFindUnique },
    integrationSyncLog: { findMany: mockSyncLogFindMany },
    auditLog: { findFirst: mockAuditFindFirst },
    notification: { findFirst: mockNotificationFindFirst },
  },
}));
vi.mock("@/platform/notifications/create-notification", () => ({
  createNotificationsForGlobalRole: mockCreateForRole,
}));
vi.mock(
  "@/domains/reservations/services/ownerrez-reservation-sync.service",
  () => ({
    OWNERREZ_DEFERRED_MARKER: "OWNERREZ_DEFERRED",
    logOwnerRezReservationSync: vi.fn(),
  }),
);

const {
  getOwnerRezSyncStatus,
  checkOwnerRezSyncHealthAndAlert,
  OWNERREZ_SYNC_ALERT_ENTITY,
  OWNERREZ_RESULT_AUDIT_WINDOW_MS,
} = await import("./ownerrez-sync-status.service");

const ACTOR = { userId: "user-1" };
const NOW = new Date("2026-09-30T12:30:00Z");
const log = (
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL",
  errorMessage: string | null = null,
) => ({
  status,
  errorMessage,
  startedAt: new Date("2026-09-30T12:17:00Z"),
  finishedAt: new Date("2026-09-30T12:18:00Z"),
  recordsProcessed: 4,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectionFindUnique.mockResolvedValue({
    id: "conn-1",
    lastSyncedAt: new Date("2026-09-30T12:18:00Z"),
  });
  mockSyncLogFindMany.mockResolvedValue([log("SUCCEEDED")]);
  mockAuditFindFirst.mockResolvedValue(null);
  mockNotificationFindFirst.mockResolvedValue(null);
  mockCreateForRole.mockResolvedValue(3);
});

afterEach(() => {
  delete process.env.OWNERREZ_AUTO_SYNC_ENABLED;
});

describe("getOwnerRezSyncStatus", () => {
  it("requires reservations:read and reads only the Reservation sync logs", async () => {
    await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(mockAssertPermission).toHaveBeenCalledWith(
      ACTOR,
      "reservations:read",
    );
    expect(mockSyncLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { integrationConnectionId: "conn-1", entityType: "Reservation" },
      }),
    );
  });

  it("automatic off: no next run; last complete sync from lastSyncedAt", async () => {
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status).toMatchObject({
      autoSyncEnabled: false,
      nextExpectedRunAt: null,
      lastCompleteSyncAt: new Date("2026-09-30T12:18:00Z"),
      stale: false,
      consecutiveFailures: 0,
      lastAttempt: {
        status: "SUCCEEDED",
        recordsProcessed: 4,
        rateLimited: false,
      },
    });
  });

  it("automatic on: next run at :17 and the last SYSTEM-audited run", async () => {
    process.env.OWNERREZ_AUTO_SYNC_ENABLED = "true";
    mockAuditFindFirst.mockResolvedValue({
      createdAt: new Date("2026-09-30T12:18:30Z"),
    });
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.nextExpectedRunAt?.toISOString()).toBe(
      "2026-09-30T13:17:00.000Z",
    );
    expect(status?.lastAutomaticRunAt).toEqual(
      new Date("2026-09-30T12:18:30Z"),
    );
    expect(mockAuditFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: "reservation.ownerrez_synced",
          actorType: "SYSTEM",
        }),
      }),
    );
  });

  it("stale + failure streak + rate-limited attempt are reported", async () => {
    mockConnectionFindUnique.mockResolvedValue({
      id: "conn-1",
      lastSyncedAt: new Date("2026-09-30T08:00:00Z"),
    });
    mockSyncLogFindMany.mockResolvedValue([
      log("FAILED", "OWNERREZ_DEFERRED: 429"),
      log("FAILED", "boom"),
      log("FAILED", "boom"),
    ]);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status).toMatchObject({
      stale: true,
      consecutiveFailures: 2,
      lastAttempt: { status: "FAILED", rateLimited: true },
    });
  });

  it("no OwnerRez connection row → null", async () => {
    mockConnectionFindUnique.mockResolvedValue(null);
    expect(await getOwnerRezSyncStatus(ACTOR as never, NOW)).toBeNull();
  });
});

describe("getOwnerRezSyncStatus — the latest run's saved results (2026-10-28)", () => {
  /** afterState exactly as runOwnerRezReservationSync() saves it. */
  const savedResult = (over: Record<string, unknown> = {}) => ({
    trigger: "automatic",
    created: 3,
    updated: 1,
    unchanged: 758,
    unmatchedPropertyCount: 0,
    unrecognizedStatusCount: 0,
    nonGuestSkipped: { block: 185 },
    guestErrorCount: 0,
    guestDeferredCount: 0,
    ownerRezRequestCount: 73,
    ...over,
  });
  /** The run's own audit entry answers the run lookup; the SYSTEM lookup gets none. */
  const withRunAudit = (afterState: unknown) =>
    mockAuditFindFirst.mockImplementation(
      async (args: { where: { actorType?: string } }) =>
        args.where.actorType === "SYSTEM" ? null : { afterState },
    );

  it("looks up the run's own audit entry by occurredAt: same connection, at or just after the log finished, earliest first", async () => {
    withRunAudit(savedResult());
    await getOwnerRezSyncStatus(ACTOR as never, NOW);
    const finishedAt = new Date("2026-09-30T12:18:00Z");
    expect(mockAuditFindFirst).toHaveBeenCalledWith({
      where: {
        action: "reservation.ownerrez_synced",
        entityType: "IntegrationConnection",
        entityId: "conn-1",
        occurredAt: {
          gte: finishedAt,
          lte: new Date(finishedAt.getTime() + OWNERREZ_RESULT_AUDIT_WINDOW_MS),
        },
      },
      orderBy: { occurredAt: "asc" },
      select: { afterState: true },
    });
  });

  it("clean success: every count recorded as zero", async () => {
    withRunAudit(savedResult());
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "SUCCEEDED",
      failureReason: null,
      exceptions: {
        unmatchedProperty: 0,
        guestErrors: 0,
        unrecognizedStatus: 0,
        deferred: 0,
      },
    });
  });

  it.each([
    ["unmatchedPropertyCount", "unmatchedProperty"],
    ["guestErrorCount", "guestErrors"],
    ["unrecognizedStatusCount", "unrecognizedStatus"],
  ])("success with %s: the saved count is reported", async (field, key) => {
    withRunAudit(savedResult({ [field]: 2 }));
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt?.status).toBe("SUCCEEDED");
    expect(status?.lastAttempt?.exceptions).toMatchObject({ [key]: 2 });
  });

  it("PARTIAL: deferred count reported alongside the rest", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      log("PARTIAL", "OWNERREZ_DEFERRED: 12 booking(s) deferred"),
    ]);
    withRunAudit(
      savedResult({ guestDeferredCount: 12, unmatchedPropertyCount: 1 }),
    );
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "PARTIAL",
      rateLimited: true,
      exceptions: { deferred: 12, unmatchedProperty: 1 },
      failureReason: null,
    });
  });

  it("failure: a safe reason, never the stored error text; no audit lookup", async () => {
    const stored =
      'Invalid `prisma.reservation.update()` invocation: value "16148058" postgresql://u:secret@db';
    mockSyncLogFindMany.mockResolvedValue([log("FAILED", stored)]);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "FAILED",
      exceptions: null,
      failureReason:
        "An unexpected error stopped the sync (details are in the server logs).",
    });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("16148058");
    // Only the SYSTEM last-automatic-run lookup — failed runs have no audit.
    expect(mockAuditFindFirst).toHaveBeenCalledTimes(1);
    expect(mockAuditFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ actorType: "SYSTEM" }),
      }),
    );
  });

  it("failure from OwnerRez: HTTP status only", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      log(
        "FAILED",
        "Request to OwnerRez bookings:recent (page 1) failed with 401",
      ),
    ]);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt?.failureReason).toBe(
      "OwnerRez refused StayWhile's credentials (HTTP 401).",
    );
  });

  it("legacy: no audit entry for the run → exceptions null", async () => {
    mockAuditFindFirst.mockResolvedValue(null);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "SUCCEEDED",
      recordsProcessed: 4,
      exceptions: null,
      failureReason: null,
    });
  });

  it("legacy: an older audit shape without the counts → exceptions null", async () => {
    withRunAudit({ created: 4, updated: 0 });
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt?.exceptions).toBeNull();
  });

  it("RUNNING: no run lookup, nothing claimed", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      { ...log("RUNNING"), finishedAt: null },
    ]);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "RUNNING",
      exceptions: null,
      failureReason: null,
    });
    expect(mockAuditFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe("getOwnerRezSyncStatus — matching the run to its audit entry (occurredAt)", () => {
  // The latest run (log() above) finished at 12:18:00.000Z.
  const FINISHED = new Date("2026-09-30T12:18:00Z").getTime();
  const at = (offsetMs: number) => new Date(FINISHED + offsetMs);

  interface AuditRow {
    action: string;
    entityType: string;
    entityId: string;
    actorType: "USER" | "SYSTEM";
    occurredAt: Date;
    createdAt: Date;
    afterState: unknown;
  }
  const entry = (
    offsetMs: number,
    unmatchedPropertyCount: number,
    over: Partial<AuditRow> = {},
  ): AuditRow => ({
    action: "reservation.ownerrez_synced",
    entityType: "IntegrationConnection",
    entityId: "conn-1",
    actorType: "SYSTEM",
    occurredAt: at(offsetMs),
    createdAt: at(offsetMs),
    afterState: {
      unmatchedPropertyCount,
      guestErrorCount: 0,
      unrecognizedStatusCount: 0,
      guestDeferredCount: 0,
    },
    ...over,
  });

  /** An in-memory audit table applying the same filter and order as Postgres would. */
  function auditTable(rows: AuditRow[]) {
    mockAuditFindFirst.mockImplementation(
      async (args: {
        where: {
          action: string;
          entityType: string;
          entityId: string;
          actorType?: string;
          occurredAt?: { gte: Date; lte: Date };
        };
        orderBy: Partial<Record<"occurredAt" | "createdAt", "asc" | "desc">>;
      }) => {
        const { where, orderBy } = args;
        const matching = rows.filter(
          (r) =>
            r.action === where.action &&
            r.entityType === where.entityType &&
            r.entityId === where.entityId &&
            (where.actorType === undefined ||
              r.actorType === where.actorType) &&
            (!where.occurredAt ||
              (r.occurredAt >= where.occurredAt.gte &&
                r.occurredAt <= where.occurredAt.lte)),
        );
        const [key, dir] = Object.entries(orderBy)[0] as [
          "occurredAt" | "createdAt",
          "asc" | "desc",
        ];
        matching.sort((a, b) =>
          dir === "asc"
            ? a[key].getTime() - b[key].getTime()
            : b[key].getTime() - a[key].getTime(),
        );
        return matching[0] ?? null;
      },
    );
  }

  const unmatched = async () =>
    (await getOwnerRezSyncStatus(ACTOR as never, NOW))?.lastAttempt?.exceptions
      ?.unmatchedProperty ?? null;

  it("picks the run's own entry (ms after finish), not the previous run's or another connection's", async () => {
    auditTable([
      entry(-60 * 60 * 1000 + 30, 9), // previous hourly run
      entry(-15_000, 8), // a run that finished 15 s earlier
      entry(40, 1, { entityId: "conn-other" }),
      entry(28, 1),
    ]);
    expect(await unmatched()).toBe(1);
  });

  it("an entry before finishedAt (even by 1 ms) is never this run's → counts unknown", async () => {
    auditTable([entry(-1, 5)]);
    expect(await unmatched()).toBeNull();
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt?.exceptions).toBeNull();
  });

  it("window edges: exactly finishedAt and finishedAt + window match; 1 ms past the window doesn't", async () => {
    auditTable([entry(0, 2)]);
    expect(await unmatched()).toBe(2);
    auditTable([entry(OWNERREZ_RESULT_AUDIT_WINDOW_MS, 3)]);
    expect(await unmatched()).toBe(3);
    auditTable([entry(OWNERREZ_RESULT_AUDIT_WINDOW_MS + 1, 4)]);
    expect(await unmatched()).toBeNull();
  });

  it("two entries in the window: the earliest (closest to the finish) is taken", async () => {
    auditTable([entry(90_000, 7), entry(25, 1)]);
    expect(await unmatched()).toBe(1);
  });

  it("matches on occurredAt, not createdAt", async () => {
    // createdAt from a clock behind the app's: still matched by occurredAt.
    auditTable([entry(30, 1, { createdAt: at(-5_000) })]);
    expect(await unmatched()).toBe(1);
    // createdAt inside the window but occurredAt is the previous run's.
    auditTable([entry(-20_000, 6, { createdAt: at(10) })]);
    expect(await unmatched()).toBeNull();
  });

  it("the run's entry is missing → unknown, not the previous run's counts", async () => {
    auditTable([entry(-15_000, 8)]);
    const status = await getOwnerRezSyncStatus(ACTOR as never, NOW);
    expect(status?.lastAttempt).toMatchObject({
      status: "SUCCEEDED",
      exceptions: null,
    });
  });
});

describe("checkOwnerRezSyncHealthAndAlert", () => {
  it("healthy: no alert, no notification", async () => {
    expect(await checkOwnerRezSyncHealthAndAlert(NOW)).toBeNull();
    expect(mockCreateForRole).not.toHaveBeenCalled();
  });

  it("3 consecutive failures → one in-app SYSTEM notification per global admin", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      log("FAILED", "a"),
      log("FAILED", "b"),
      log("FAILED", "c"),
    ]);
    expect(await checkOwnerRezSyncHealthAndAlert(NOW)).toBe(
      "consecutive_failures",
    );
    expect(mockCreateForRole).toHaveBeenCalledTimes(1);
    expect(mockCreateForRole).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({
        type: "SYSTEM",
        channel: "IN_APP",
        relatedEntityType: OWNERREZ_SYNC_ALERT_ENTITY,
        relatedEntityId: "conn-1",
      }),
    );
  });

  it("stale (> 3 h without a complete sync) → alert", async () => {
    mockConnectionFindUnique.mockResolvedValue({
      id: "conn-1",
      lastSyncedAt: new Date("2026-09-30T09:00:00Z"),
    });
    mockSyncLogFindMany.mockResolvedValue([
      log("PARTIAL", "OWNERREZ_DEFERRED: 12"),
    ]);
    expect(await checkOwnerRezSyncHealthAndAlert(NOW)).toBe("stale");
  });

  it("normal PARTIAL / rate-limit stops on a fresh sync never alert", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      log("PARTIAL", "OWNERREZ_DEFERRED: 12"),
      log("FAILED", "OWNERREZ_DEFERRED: 429"),
      log("FAILED", "OWNERREZ_DEFERRED: 429"),
      log("FAILED", "OWNERREZ_DEFERRED: 429"),
    ]);
    expect(await checkOwnerRezSyncHealthAndAlert(NOW)).toBeNull();
    expect(mockCreateForRole).not.toHaveBeenCalled();
  });

  it("only once per incident: an alert created after the last complete sync suppresses more", async () => {
    mockSyncLogFindMany.mockResolvedValue([
      log("FAILED", "a"),
      log("FAILED", "b"),
      log("FAILED", "c"),
    ]);
    mockNotificationFindFirst.mockResolvedValue({ id: "n-1" });
    expect(await checkOwnerRezSyncHealthAndAlert(NOW)).toBeNull();
    expect(mockCreateForRole).not.toHaveBeenCalled();
    expect(mockNotificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relatedEntityType: OWNERREZ_SYNC_ALERT_ENTITY,
          relatedEntityId: "conn-1",
          createdAt: { gt: new Date("2026-09-30T12:18:00Z") },
        }),
      }),
    );
  });

  it("never throws — a monitoring error must not break the sync", async () => {
    mockSyncLogFindMany.mockRejectedValue(new Error("db down"));
    await expect(checkOwnerRezSyncHealthAndAlert(NOW)).resolves.toBeNull();
  });
});
