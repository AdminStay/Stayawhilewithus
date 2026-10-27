import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindUnique: vi.fn(),
  syncLogFindMany: vi.fn(),
  syncLogFindFirst: vi.fn(),
  notificationFindMany: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: { findUnique: db.connectionFindUnique },
    integrationSyncLog: {
      findMany: db.syncLogFindMany,
      findFirst: db.syncLogFindFirst,
    },
    notification: { findMany: db.notificationFindMany },
  },
}));
vi.mock("@/platform/notifications/create-notification", () => ({
  createNotificationsForGlobalRole: db.notifyAdmins,
}));
// The alert service only needs the logger from the refresh service.
vi.mock("./thermostat-refresh.service", () => ({
  logThermostatRefresh: vi.fn(),
}));

import { formatNestRefreshFailure } from "../lib/nest-health";
import { formatCieloRefreshFailure } from "../lib/thermostat-auto-refresh";

import { checkThermostatRefreshHealthAndAlert } from "./thermostat-refresh-alerts.service";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const MIN = 60 * 1000;

function attempt(
  status: "SUCCEEDED" | "FAILED",
  minutesAgo: number,
  errorMessage: string | null = null,
) {
  const startedAt = new Date(NOW - minutesAgo * MIN);
  return { status, startedAt, finishedAt: startedAt, errorMessage };
}

/**
 * A tiny in-memory stand-in for the two tables the alert service reads, so
 * `take`, the SUCCEEDED lookup and the notification `createdAt > …` filter
 * behave like the real queries (newest first).
 */
function historyFor(
  nest: ReturnType<typeof attempt>[],
  cielo: ReturnType<typeof attempt>[],
) {
  const rows = (entityType: string) =>
    entityType === "NestTelemetryRefresh" ? nest : cielo;
  db.syncLogFindMany.mockImplementation(
    async (args: { where: { entityType: string }; take?: number }) =>
      rows(args.where.entityType).slice(0, args.take ?? Infinity),
  );
  db.syncLogFindFirst.mockImplementation(
    async (args: { where: { entityType: string; status?: string } }) =>
      rows(args.where.entityType).find(
        (a) => !args.where.status || a.status === args.where.status,
      ) ?? null,
  );
}

interface StoredAlert {
  relatedEntityType: string;
  relatedEntityId: string;
  createdAt: Date;
}
let storedAlerts: StoredAlert[] = [];

function alertStore() {
  db.notificationFindMany.mockImplementation(
    async (args: {
      where: {
        relatedEntityType: { startsWith: string };
        relatedEntityId: string;
        createdAt?: { gt: Date };
      };
    }) =>
      storedAlerts
        .filter(
          (n) =>
            n.relatedEntityType.startsWith(
              args.where.relatedEntityType.startsWith,
            ) &&
            n.relatedEntityId === args.where.relatedEntityId &&
            (!args.where.createdAt ||
              n.createdAt.getTime() > args.where.createdAt.gt.getTime()),
        )
        .map((n) => ({ relatedEntityType: n.relatedEntityType })),
  );
}

function alertAt(type: string, minutesAgo: number, id = "conn-nest") {
  storedAlerts.push({
    relatedEntityType: type,
    relatedEntityId: id,
    createdAt: new Date(NOW - minutesAgo * MIN),
  });
}

const NEST_AUTH = formatNestRefreshFailure("NEST_AUTH_EXPIRED");
const NEST_API = formatNestRefreshFailure("NEST_PROVIDER_ERROR", 503);
const CIELO_AUTH = formatCieloRefreshFailure("CIELO_AUTH_FAILED");

beforeEach(() => {
  vi.clearAllMocks();
  db.connectionFindUnique.mockImplementation(
    async (args: { where: { provider: string } }) => ({
      id: args.where.provider === "NEST" ? "conn-nest" : "conn-cielo",
    }),
  );
  storedAlerts = [];
  alertStore();
  db.notifyAdmins.mockResolvedValue(2);
  historyFor([], []);
});

describe("checkThermostatRefreshHealthAndAlert", () => {
  it("healthy history → no alert", async () => {
    historyFor([attempt("SUCCEEDED", 1)], [attempt("SUCCEEDED", 30)]);
    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);
    expect(db.notifyAdmins).not.toHaveBeenCalled();
  });

  it("Nest authorization expired → one SYSTEM in-app alert to global admins, keyed to the Nest connection", async () => {
    historyFor([attempt("FAILED", 1, NEST_AUTH), attempt("SUCCEEDED", 31)], []);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "NEST", reason: "auth_failed" },
    ]);
    expect(db.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(db.notifyAdmins).toHaveBeenCalledWith("admin", {
      type: "SYSTEM",
      channel: "IN_APP",
      title: "Nest authorization expired — thermostat refresh paused",
      body: expect.stringContaining("reauthorized"),
      relatedEntityType: "ThermostatRefreshAlert:NEST:auth_failed",
      relatedEntityId: "conn-nest",
    });
  });

  it("the same incident is not alerted twice: an alert since the last success suppresses it", async () => {
    historyFor([attempt("FAILED", 1, NEST_AUTH), attempt("SUCCEEDED", 31)], []);
    // Alerted 1 minute ago — after the success 31 minutes ago: same incident.
    alertAt("ThermostatRefreshAlert:NEST:auth_failed", 1);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);
    expect(db.notifyAdmins).not.toHaveBeenCalled();
    // Dedupe window starts at the provider's last successful attempt.
    expect(db.notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relatedEntityId: "conn-nest",
          createdAt: { gt: new Date(NOW - 31 * MIN) },
        }),
      }),
    );
  });

  it("3 non-auth Nest failures in a row → consecutive_failures alert; 2 are not enough", async () => {
    historyFor(
      [attempt("FAILED", 1, NEST_API), attempt("FAILED", 31, NEST_API)],
      [],
    );
    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);

    historyFor(
      [
        attempt("FAILED", 1, NEST_API),
        attempt("FAILED", 31, NEST_API),
        attempt("FAILED", 61, NEST_API),
      ],
      [],
    );
    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "NEST", reason: "consecutive_failures" },
    ]);
  });

  it("Cielo sign-in refused → a Cielo alert on the Cielo connection, independent of Nest", async () => {
    historyFor([attempt("SUCCEEDED", 1)], [attempt("FAILED", 1, CIELO_AUTH)]);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "CIELO", reason: "auth_failed" },
    ]);
    expect(db.notifyAdmins).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({
        relatedEntityType: "ThermostatRefreshAlert:CIELO:auth_failed",
        relatedEntityId: "conn-cielo",
      }),
    );
  });

  it("alert text names no device, credential or provider message", async () => {
    historyFor(
      [attempt("FAILED", 1, NEST_AUTH)],
      [attempt("FAILED", 1, CIELO_AUTH)],
    );
    await checkThermostatRefreshHealthAndAlert();
    const sent = JSON.stringify(db.notifyAdmins.mock.calls);
    expect(sent).not.toMatch(/token|password|secret|enterprises\//i);
  });

  it("never throws: a database error is swallowed per provider and the other provider is still checked", async () => {
    db.syncLogFindMany.mockImplementation(
      async (args: { where: { entityType: string } }) => {
        if (args.where.entityType === "NestTelemetryRefresh") {
          throw new Error("db down");
        }
        return [attempt("FAILED", 1, CIELO_AUTH)];
      },
    );

    await expect(checkThermostatRefreshHealthAndAlert()).resolves.toEqual([
      { provider: "CIELO", reason: "auth_failed" },
    ]);
  });

  it("no connection row → nothing to check, no alert", async () => {
    db.connectionFindUnique.mockResolvedValue(null);
    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);
    expect(db.syncLogFindMany).not.toHaveBeenCalled();
  });
});

describe("checkThermostatRefreshHealthAndAlert — incident boundaries (2026-10-28 fix)", () => {
  const NEST_AUTH_ALERT = "ThermostatRefreshAlert:NEST:auth_failed";
  const NEST_STREAK_ALERT = "ThermostatRefreshAlert:NEST:consecutive_failures";
  const NEST_NONE = formatNestRefreshFailure("NEST_NO_DEVICES_RETURNED");

  /** `count` FAILED attempts, 30 minutes apart, the newest 1 minute ago. */
  const failures = (count: number, errorMessage: string) =>
    Array.from({ length: count }, (_, i) =>
      attempt("FAILED", 1 + i * 30, errorMessage),
    );

  it("finds the latest success even when it is more than 10 attempts back — an alert from the earlier, resolved incident does not suppress the new one", async () => {
    // 12 failures (newest first), then the success that resolved the old
    // incident, and before that the old incident's own alert.
    const recent = failures(12, NEST_API);
    const resolvedAtMinutesAgo = 1 + 12 * 30;
    historyFor([...recent, attempt("SUCCEEDED", resolvedAtMinutesAgo)], []);
    alertAt(NEST_STREAK_ALERT, resolvedAtMinutesAgo + 60);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "NEST", reason: "consecutive_failures" },
    ]);
    // The success was looked up directly, not within the 10 recent attempts.
    expect(db.syncLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          integrationConnectionId: "conn-nest",
          entityType: "NestTelemetryRefresh",
          status: "SUCCEEDED",
        }),
      }),
    );
    expect(db.notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gt: new Date(NOW - resolvedAtMinutesAgo * MIN) },
        }),
      }),
    );
  });

  it("the same unresolved incident stays deduplicated even when its success is more than 10 attempts back", async () => {
    const recent = failures(12, NEST_API);
    const resolvedAtMinutesAgo = 1 + 12 * 30;
    historyFor([...recent, attempt("SUCCEEDED", resolvedAtMinutesAgo)], []);
    // Alerted after that success, i.e. during the current incident.
    alertAt(NEST_STREAK_ALERT, 200);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);
    expect(db.notifyAdmins).not.toHaveBeenCalled();
  });

  it("a new incident after a resolved one alerts again", async () => {
    // Old incident: alerted 3 h ago, resolved by a success 2 h ago.
    alertAt(NEST_AUTH_ALERT, 180);
    historyFor(
      [attempt("FAILED", 1, NEST_AUTH), attempt("SUCCEEDED", 120)],
      [],
    );

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "NEST", reason: "auth_failed" },
    ]);
  });

  it("with no success ever, an earlier alert still counts as the same unresolved incident", async () => {
    historyFor(failures(4, NEST_AUTH), []);
    alertAt(NEST_AUTH_ALERT, 300);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([]);
  });

  it("dedupe is per provider and per reason: an existing Nest alert never suppresses a Cielo one", async () => {
    historyFor(
      [attempt("FAILED", 1, NEST_AUTH)],
      [attempt("FAILED", 1, CIELO_AUTH)],
    );
    alertAt(NEST_AUTH_ALERT, 0.5);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "CIELO", reason: "auth_failed" },
    ]);
  });

  it("'no devices returned' failures are not a successful refresh: 3 in a row raise the failure alert", async () => {
    historyFor([...failures(3, NEST_NONE), attempt("SUCCEEDED", 200)], []);

    expect(await checkThermostatRefreshHealthAndAlert()).toEqual([
      { provider: "NEST", reason: "consecutive_failures" },
    ]);
  });
});
