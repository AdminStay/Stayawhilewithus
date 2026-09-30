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
