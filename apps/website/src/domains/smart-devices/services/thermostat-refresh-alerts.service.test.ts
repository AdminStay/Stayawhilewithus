import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectionFindUnique: vi.fn(),
  syncLogFindMany: vi.fn(),
  notificationFindMany: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: { findUnique: db.connectionFindUnique },
    integrationSyncLog: { findMany: db.syncLogFindMany },
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

function historyFor(
  nest: ReturnType<typeof attempt>[],
  cielo: ReturnType<typeof attempt>[],
) {
  db.syncLogFindMany.mockImplementation(
    async (args: { where: { entityType: string } }) =>
      args.where.entityType === "NestTelemetryRefresh" ? nest : cielo,
  );
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
  db.notificationFindMany.mockResolvedValue([]);
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
    db.notificationFindMany.mockImplementation(
      async (args: { where: { relatedEntityId: string } }) =>
        args.where.relatedEntityId === "conn-nest"
          ? [{ relatedEntityType: "ThermostatRefreshAlert:NEST:auth_failed" }]
          : [],
    );

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
