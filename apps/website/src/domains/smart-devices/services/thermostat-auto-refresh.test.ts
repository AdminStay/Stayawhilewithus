import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * refreshThermostatsAutomatic() (2026-10-27) — the scheduled, user-less
 * path. The manual refreshThermostats() path keeps its own tests in
 * thermostat-refresh.service.test.ts, unchanged.
 */

const db = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  syncLogFindFirst: vi.fn(),
  syncLogFindMany: vi.fn(),
  syncLogCreate: vi.fn(),
  syncLogUpdate: vi.fn(),
  connectionFindUniqueOrThrow: vi.fn(),
  connectionFindUnique: vi.fn(),
  providerDeviceFindMany: vi.fn(),
  providerDeviceUpdate: vi.fn(),
  smartDeviceFindMany: vi.fn(),
  smartDeviceUpdate: vi.fn(),
  transaction: vi.fn(),
  listNest: vi.fn(),
  listCielo: vi.fn(),
  ensureConnectionRows: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/database", () => {
  const prisma = {
    integrationConnection: {
      findUniqueOrThrow: db.connectionFindUniqueOrThrow,
      findUnique: db.connectionFindUnique,
    },
    integrationSyncLog: {
      findFirst: db.syncLogFindFirst,
      findMany: db.syncLogFindMany,
      create: db.syncLogCreate,
      update: db.syncLogUpdate,
    },
    providerDevice: {
      findMany: db.providerDeviceFindMany,
      update: db.providerDeviceUpdate,
    },
    smartDevice: {
      findMany: db.smartDeviceFindMany,
      update: db.smartDeviceUpdate,
    },
    $queryRaw: db.queryRaw,
    $transaction: db.transaction,
  };
  return { prisma };
});

vi.mock("@stayw/auth", () => ({ assertPermission: db.assertPermission }));

vi.mock("@stayw/integrations/nest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/nest")>();
  return {
    NestOAuthRefreshError: actual.NestOAuthRefreshError,
    NestClient: vi
      .fn()
      .mockImplementation(() => ({ listDevices: db.listNest })),
  };
});

vi.mock("@stayw/integrations/cielo", () => ({
  CieloClient: vi
    .fn()
    .mockImplementation(() => ({ listDevices: db.listCielo })),
}));

vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: db.ensureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS: 10 * 60 * 1000,
}));

import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import { NestOAuthRefreshError } from "@stayw/integrations/nest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatNestRefreshFailure } from "../lib/nest-health";
import { formatCieloRefreshFailure } from "../lib/thermostat-auto-refresh";

import {
  classifyCieloRefreshFailure,
  refreshThermostatsAutomatic,
} from "./thermostat-refresh.service";

const NOW = new Date("2026-10-27T12:00:00Z");
const MIN = 60 * 1000;

const ORIGINAL_ENV = { ...process.env };

function enableAndConfigure() {
  process.env.THERMOSTAT_AUTO_REFRESH_ENABLED = "true";
  process.env.NEST_CLIENT_ID = "nest-client-id-value";
  process.env.NEST_CLIENT_SECRET = "nest-client-secret-value";
  process.env.NEST_PROJECT_ID = "nest-project-id-value";
  process.env.NEST_REFRESH_TOKEN = "nest-refresh-token-value";
  process.env.CIELO_USERNAME = "cielo-user-value";
  process.env.CIELO_PASSWORD = "cielo-password-value";
}

function attempt(
  status: "SUCCEEDED" | "FAILED",
  minutesAgo: number,
  errorMessage: string | null = null,
) {
  const startedAt = new Date(NOW.getTime() - minutesAgo * MIN);
  return { status, startedAt, finishedAt: startedAt, errorMessage };
}

/** History the claim reads: Nest attempts (newest first) and the latest automatic Cielo attempt. */
function history(
  nest: ReturnType<typeof attempt>[],
  cielo: ReturnType<typeof attempt>[],
) {
  db.syncLogFindMany.mockImplementation(
    async (args: { where: { entityType: string } }) =>
      args.where.entityType === "NestTelemetryRefresh" ? nest : cielo,
  );
}

function createdRows(entityType: string) {
  return db.syncLogCreate.mock.calls
    .map((c) => c[0].data)
    .filter((d) => d.entityType === entityType);
}

function runRowClose() {
  const call = db.syncLogUpdate.mock.calls.find(
    (c) => c[0].where.id === "run-1",
  );
  return call?.[0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  enableAndConfigure();
  db.ensureConnectionRows.mockResolvedValue(undefined);
  db.connectionFindUniqueOrThrow.mockImplementation(
    async (args: { where: { provider: string } }) => ({
      id: args.where.provider === "NEST" ? "conn-nest" : "conn-cielo",
    }),
  );
  db.connectionFindUnique.mockImplementation(
    async (args: { where: { provider: string } }) => ({
      id: args.where.provider === "NEST" ? "conn-nest" : "conn-cielo",
    }),
  );
  db.queryRaw.mockResolvedValue([{ locked: true }]);
  db.syncLogFindFirst.mockResolvedValue(null);
  history([], []);
  db.syncLogCreate.mockImplementation(
    async (args: { data: { status: string } }) =>
      args.data.status === "RUNNING" ? { id: "run-1" } : { id: "attempt" },
  );
  db.syncLogUpdate.mockResolvedValue({});
  db.providerDeviceFindMany.mockResolvedValue([
    { id: "pd-1", externalDeviceId: "ext-1", smartDeviceId: "sd-1" },
  ]);
  db.smartDeviceFindMany.mockResolvedValue([
    { id: "sd-c1", externalDeviceId: "mac-1" },
  ]);
  db.providerDeviceUpdate.mockResolvedValue({});
  db.smartDeviceUpdate.mockResolvedValue({});
  db.listNest.mockResolvedValue([
    {
      externalDeviceId: "ext-1",
      connectivity: "ONLINE",
      ambientTemperatureCelsius: 21,
    },
  ]);
  db.listCielo.mockResolvedValue([
    { id: "mac-1", name: "Living Room", online: true },
  ]);
  db.transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  );
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("refreshThermostatsAutomatic — disabled by default", () => {
  it.each([undefined, "false", "TRUE", "1"])(
    "THERMOSTAT_AUTO_REFRESH_ENABLED=%s → disabled before any database or provider call",
    async (value) => {
      if (value === undefined)
        delete process.env.THERMOSTAT_AUTO_REFRESH_ENABLED;
      else process.env.THERMOSTAT_AUTO_REFRESH_ENABLED = value;

      expect(await refreshThermostatsAutomatic(NOW)).toEqual({
        status: "disabled",
      });
      expect(db.ensureConnectionRows).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
      expect(db.listNest).not.toHaveBeenCalled();
      expect(db.listCielo).not.toHaveBeenCalled();
    },
  );
});

describe("refreshThermostatsAutomatic — no user session, no RBAC call", () => {
  it("runs both providers without a signed-in user and never calls assertPermission", async () => {
    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toEqual({
      status: "completed",
      nest: { status: "success", refreshed: 1, notReturnedByProvider: 0 },
      cielo: { status: "success", refreshed: 1, notReturnedByProvider: 0 },
    });
    expect(db.assertPermission).not.toHaveBeenCalled();
    expect(db.listNest).toHaveBeenCalledTimes(1);
    expect(db.listCielo).toHaveBeenCalledTimes(1);
  });
});

describe("refreshThermostatsAutomatic — overlap protection", () => {
  it("advisory lock held by another run → already_running; no run row, no provider call", async () => {
    db.queryRaw.mockResolvedValue([{ locked: false }]);

    expect(await refreshThermostatsAutomatic(NOW)).toEqual({
      status: "already_running",
    });
    expect(db.syncLogCreate).not.toHaveBeenCalled();
    expect(db.listNest).not.toHaveBeenCalled();
    expect(db.listCielo).not.toHaveBeenCalled();
  });

  it("a RUNNING automatic run younger than 10 min → already_running; nothing written", async () => {
    db.syncLogFindFirst.mockResolvedValue({
      id: "other-run",
      startedAt: new Date(NOW.getTime() - 2 * MIN),
    });

    expect(await refreshThermostatsAutomatic(NOW)).toEqual({
      status: "already_running",
    });
    expect(db.syncLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          integrationConnectionId: "conn-nest",
          entityType: "ThermostatAutoRefresh",
          status: "RUNNING",
        },
      }),
    );
    expect(db.syncLogUpdate).not.toHaveBeenCalled();
    expect(db.syncLogCreate).not.toHaveBeenCalled();
    expect(db.listNest).not.toHaveBeenCalled();
  });

  it("a stale RUNNING row (crashed run) is closed FAILED, then this run proceeds", async () => {
    db.syncLogFindFirst.mockResolvedValue({
      id: "crashed-run",
      startedAt: new Date(NOW.getTime() - 11 * MIN),
    });

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome.status).toBe("completed");
    expect(db.syncLogUpdate).toHaveBeenCalledWith({
      where: { id: "crashed-run" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
    expect(db.listNest).toHaveBeenCalledTimes(1);
  });

  it("claims with its own advisory-lock namespace, inside one transaction, before any provider call", async () => {
    const order: string[] = [];
    db.queryRaw.mockImplementation(async () => {
      order.push("lock");
      return [{ locked: true }];
    });
    db.listNest.mockImplementation(async () => {
      order.push("nest");
      return [];
    });

    await refreshThermostatsAutomatic(NOW);

    expect(order[0]).toBe("lock");
    const sql = db.queryRaw.mock.calls[0]![0].join("?");
    expect(sql).toContain("pg_try_advisory_xact_lock");
    expect(db.queryRaw.mock.calls[0]).toContain("thermostat_auto_refresh");
    expect(createdRows("ThermostatAutoRefresh")).toEqual([
      expect.objectContaining({
        integrationConnectionId: "conn-nest",
        status: "RUNNING",
      }),
    ]);
  });

  it("closes the run row with a summary of statuses and counts only", async () => {
    await refreshThermostatsAutomatic(NOW);

    expect(runRowClose()).toEqual(
      expect.objectContaining({
        status: "SUCCEEDED",
        recordsProcessed: 2,
        errorMessage: "nest=success(1) cielo=success(1)",
      }),
    );
  });
});

describe("refreshThermostatsAutomatic — scheduling decisions", () => {
  it("Cielo refreshed within the last hour → skipped as not_due; Nest still runs (every other run for Cielo)", async () => {
    history([], [attempt("SUCCEEDED", 30)]);

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "success" },
      cielo: { status: "skipped", reason: "not_due" },
    });
    expect(db.listCielo).not.toHaveBeenCalled();
    expect(runRowClose()?.errorMessage).toBe(
      "nest=success(1) cielo=skipped(not_due)",
    );
  });

  it("a Nest refresh (e.g. a manual click) in the last 10 min → Nest skipped as recently_refreshed", async () => {
    history([attempt("SUCCEEDED", 4)], []);

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "skipped", reason: "recently_refreshed" },
    });
    expect(db.listNest).not.toHaveBeenCalled();
  });

  it("both skipped → no provider call; the run row still closes SUCCEEDED with 0 records", async () => {
    history([attempt("SUCCEEDED", 4)], [attempt("SUCCEEDED", 30)]);

    await refreshThermostatsAutomatic(NOW);

    expect(db.listNest).not.toHaveBeenCalled();
    expect(db.listCielo).not.toHaveBeenCalled();
    expect(runRowClose()).toEqual(
      expect.objectContaining({ status: "SUCCEEDED", recordsProcessed: 0 }),
    );
  });
});

describe("refreshThermostatsAutomatic — authorization expiry", () => {
  const nestAuthError = () =>
    new NestOAuthRefreshError({
      httpStatus: 400,
      oauthError: "invalid_grant",
      oauthErrorDescription: "Token has been expired or revoked.",
      clientIdPresent: true,
      clientSecretPresent: true,
      refreshTokenPresent: true,
      clientIdHasWhitespace: false,
      clientSecretHasWhitespace: false,
      refreshTokenHasWhitespace: false,
    });

  it("Google invalid_grant → Nest failed NEST_AUTH_EXPIRED, recorded like a manual refresh; Cielo unaffected", async () => {
    db.listNest.mockRejectedValue(nestAuthError());

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "failed", code: "NEST_AUTH_EXPIRED" },
      cielo: { status: "success" },
    });
    expect(createdRows("NestTelemetryRefresh")).toEqual([
      expect.objectContaining({
        status: "FAILED",
        errorMessage: formatNestRefreshFailure("NEST_AUTH_EXPIRED"),
      }),
    ]);
    expect(runRowClose()?.status).toBe("PARTIAL");
  });

  it("after NEST_AUTH_EXPIRED with no success since → Nest is not called (auth_required)", async () => {
    history(
      [attempt("FAILED", 30, formatNestRefreshFailure("NEST_AUTH_EXPIRED"))],
      [],
    );

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "skipped", reason: "auth_required" },
    });
    expect(db.listNest).not.toHaveBeenCalled();
  });

  it("a successful (manual) refresh after the auth failure → automatic Nest resumes", async () => {
    history(
      [
        attempt("SUCCEEDED", 20),
        attempt("FAILED", 60, formatNestRefreshFailure("NEST_AUTH_EXPIRED")),
      ],
      [],
    );

    await refreshThermostatsAutomatic(NOW);

    expect(db.listNest).toHaveBeenCalledTimes(1);
  });

  it("Cielo refusing the sign-in → CIELO_AUTH_FAILED recorded with a fixed sentence — never Cielo's own text", async () => {
    db.listCielo.mockRejectedValue(
      new Error("Cielo login failed: Invalid password for cielo-user-value"),
    );

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      cielo: { status: "failed", code: "CIELO_AUTH_FAILED" },
    });
    const rows = createdRows("CieloTelemetryRefresh");
    expect(rows).toEqual([
      expect.objectContaining({
        integrationConnectionId: "conn-cielo",
        status: "FAILED",
        errorMessage: formatCieloRefreshFailure("CIELO_AUTH_FAILED"),
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("Invalid password");
  });

  it("within 6 h of a refused Cielo sign-in → Cielo is not called (auth_retry_wait)", async () => {
    history(
      [],
      [attempt("FAILED", 90, formatCieloRefreshFailure("CIELO_AUTH_FAILED"))],
    );

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      cielo: { status: "skipped", reason: "auth_retry_wait" },
    });
    expect(db.listCielo).not.toHaveBeenCalled();
  });
});

describe("refreshThermostatsAutomatic — provider failures", () => {
  it("Nest API error → failed NEST_PROVIDER_ERROR; Cielo still runs and succeeds", async () => {
    db.listNest.mockRejectedValue(
      new HttpRequestError("/enterprises/secret-project/devices", 503),
    );

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "failed", code: "NEST_PROVIDER_ERROR" },
      cielo: { status: "success", refreshed: 1 },
    });
    expect(JSON.stringify(outcome)).not.toContain("secret-project");
  });

  it("both fail → run row FAILED; each failure kept as a fixed code", async () => {
    db.listNest.mockRejectedValue(new Error("socket hang up"));
    db.listCielo.mockRejectedValue(new HttpRequestError("/web/devices", 500));

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "failed", code: "NEST_REFRESH_FAILED" },
      cielo: { status: "failed", code: "CIELO_PROVIDER_ERROR" },
    });
    expect(runRowClose()).toEqual(
      expect.objectContaining({
        status: "FAILED",
        errorMessage:
          "nest=failed(NEST_REFRESH_FAILED) cielo=failed(CIELO_PROVIDER_ERROR)",
      }),
    );
  });

  it("missing credentials → not_configured (and recorded), never a fake success", async () => {
    delete process.env.NEST_REFRESH_TOKEN;
    delete process.env.CIELO_PASSWORD;

    const outcome = await refreshThermostatsAutomatic(NOW);

    expect(outcome).toMatchObject({
      nest: { status: "not_configured" },
      cielo: { status: "not_configured" },
    });
    expect(db.listNest).not.toHaveBeenCalled();
    expect(db.listCielo).not.toHaveBeenCalled();
    expect(runRowClose()?.status).toBe("FAILED");
  });

  it("a failing run-row close never throws out of the run", async () => {
    db.syncLogUpdate.mockRejectedValue(new Error("db down"));

    await expect(refreshThermostatsAutomatic(NOW)).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("refreshThermostatsAutomatic — never exposes or changes more than readings", () => {
  it("the outcome carries no device id, name, credential or provider text", async () => {
    const outcome = JSON.stringify(await refreshThermostatsAutomatic(NOW));
    for (const forbidden of [
      "ext-1",
      "mac-1",
      "sd-1",
      "pd-1",
      "Living Room",
      "nest-refresh-token-value",
      "cielo-password-value",
      "conn-nest",
    ]) {
      expect(outcome).not.toContain(forbidden);
    }
  });

  it("writes only updates to existing device rows — no create/upsert/delete on any device model", async () => {
    await refreshThermostatsAutomatic(NOW);

    expect(db.smartDeviceUpdate).toHaveBeenCalled();
    const deviceModels = [prisma.smartDevice, prisma.providerDevice];
    for (const model of deviceModels) {
      expect(Object.keys(model).sort()).toEqual(["findMany", "update"]);
    }
  });

  it("never logs a credential value", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await refreshThermostatsAutomatic(NOW);
    const logged = JSON.stringify(log.mock.calls);
    for (const value of [
      "nest-client-secret-value",
      "nest-refresh-token-value",
      "cielo-password-value",
    ]) {
      expect(logged).not.toContain(value);
    }
    log.mockRestore();
  });
});

describe("classifyCieloRefreshFailure", () => {
  it.each([
    [
      new Error("Cielo isn't configured — set CIELO_USERNAME"),
      "CIELO_NOT_CONFIGURED",
    ],
    [new Error("Cielo login failed: anything Cielo says"), "CIELO_AUTH_FAILED"],
    [new HttpRequestError("/user/login", 401), "CIELO_AUTH_FAILED"],
    [new HttpRequestError("/user/login", 403), "CIELO_AUTH_FAILED"],
    [new HttpRequestError("/web/devices", 502), "CIELO_PROVIDER_ERROR"],
    [new Error("boom"), "CIELO_REFRESH_FAILED"],
    ["not even an error", "CIELO_REFRESH_FAILED"],
  ])("%s → %s", (err, code) => {
    expect(classifyCieloRefreshFailure(err).startsWith(`${code}:`)).toBe(true);
  });
});

describe("source-level guarantee — the automatic path cannot send a thermostat command", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = [
    "./thermostat-refresh.service.ts",
    "./thermostat-refresh-alerts.service.ts",
    "../lib/thermostat-auto-refresh.ts",
  ];

  /** Every name and module imported by a file — comments and doc text are ignored. */
  function importedNamesAndModules(source: string): string {
    return [...source.matchAll(/^import[\s\S]*?from "[^"]+";/gm)]
      .map((m) => m[0])
      .join("\n");
  }

  it.each(files)("%s never names a command function anywhere", (file) => {
    const source = readFileSync(resolve(here, file), "utf8");
    for (const forbidden of [
      "executeNestThermostatCommand",
      "sendNestThermostatCommand",
      "openControlSession",
      "buildCieloSetpointFrame",
      "SET_HEAT",
      "SET_COOL",
      "SET_RANGE",
      "SET_MODE",
      "SET_FAN",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each(files)(
    "%s imports no command, control, discovery or sync module",
    (file) => {
      const imports = importedNamesAndModules(
        readFileSync(resolve(here, file), "utf8"),
      );
      for (const forbidden of [
        "nest-commands",
        "cielo-commands",
        "cielo/control",
        "smart-devices.service",
        "discover",
        "syncCieloDevices",
        "mapProviderDevice",
        "setProviderDeviceEnabled",
        "../actions",
      ]) {
        expect(imports).not.toContain(forbidden);
      }
    },
  );
});
