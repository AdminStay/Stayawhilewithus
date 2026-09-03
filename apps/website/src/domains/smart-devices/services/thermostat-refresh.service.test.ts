import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTransaction, mockListDevices, mockListCieloDevices } = vi.hoisted(
  () => ({
    mockTransaction: vi.fn(),
    mockListDevices: vi.fn(),
    mockListCieloDevices: vi.fn(),
  }),
);

vi.mock("@stayw/database", () => ({
  prisma: {
    providerDevice: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    smartDevice: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

// Deliberately exposes only listDevices — the real @stayw/integrations/nest
// module does export command-sending functionality (executeNestThermostatCommand
// etc.), but this mock only ever needs to prove what thermostat-refresh.service.ts
// itself calls, and a mock this narrow means any accidental call to
// anything else would throw "not a function" immediately. NestOAuthRefreshError
// is the one real (non-mocked) export passed through via importOriginal — a
// pure, side-effect-free data class (see client.ts), needed so tests below
// can construct a real instance of the exact error type
// thermostat-refresh.service.ts checks for with `instanceof`.
vi.mock("@stayw/integrations/nest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/nest")>();
  return {
    NestOAuthRefreshError: actual.NestOAuthRefreshError,
    NestClient: vi.fn().mockImplementation(() => ({
      listDevices: mockListDevices,
    })),
  };
});

// Same discipline as the Nest mock above — CieloClient exposes only
// listDevices() here, even though the real client has no control/command
// method at all (see packages/integrations/src/cielo/README.md).
vi.mock("@stayw/integrations/cielo", () => ({
  CieloClient: vi.fn().mockImplementation(() => ({
    listDevices: mockListCieloDevices,
  })),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { NestOAuthRefreshError } from "@stayw/integrations/nest";

import {
  refreshCieloTelemetry,
  refreshNestTelemetry,
  refreshThermostats,
} from "./thermostat-refresh.service";

const actor = { userId: "user-1" };

function nestDevice(
  externalDeviceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    externalDeviceId,
    resourceName: `enterprises/x/devices/${externalDeviceId}`,
    deviceType: "sdm.devices.types.THERMOSTAT",
    connectivity: "ONLINE",
    ambientTemperatureCelsius: 21,
    thermostatMode: "COOL",
    rawTraits: {},
    ...overrides,
  };
}

function cieloDevice(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: "Living Room", online: true, ...overrides };
}

function enabledProviderDevice(
  id: string,
  externalDeviceId: string,
  smartDeviceId: string,
) {
  return { id, externalDeviceId, smartDeviceId };
}

function existingCieloSmartDevice(id: string, externalDeviceId: string) {
  // Cast to `never` (not the full SmartDevice shape) — this mock only ever
  // needs the two fields refreshCieloTelemetry() actually selects.
  return { id, externalDeviceId } as never;
}

const ORIGINAL_ENV = { ...process.env };

function setNestEnv() {
  process.env.NEST_CLIENT_ID = "client-id";
  process.env.NEST_CLIENT_SECRET = "client-secret";
  process.env.NEST_PROJECT_ID = "project-id";
  process.env.NEST_REFRESH_TOKEN = "refresh-token";
}

function setCieloEnv() {
  process.env.CIELO_USERNAME = "cielo-user";
  process.env.CIELO_PASSWORD = "cielo-pass";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("thermostat-refresh.service — source-level command-safety guarantee", () => {
  it("never imports or references any Nest command-sending function — structurally impossible to send a physical command from this file", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(__dirname, "./thermostat-refresh.service.ts"),
      "utf8",
    );

    for (const forbidden of [
      "executeNestThermostatCommand",
      "sendNestThermostatCommand",
      "SET_HEAT",
      "SET_COOL",
      "SET_RANGE",
      "SET_MODE",
      "SET_FAN",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("never imports anything from smart-devices.service — Refresh cannot reach Cielo's upsert-capable sync path (syncCieloDevices lives only there)", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(__dirname, "./thermostat-refresh.service.ts"),
      "utf8",
    );

    expect(source).not.toContain('from "./smart-devices.service"');
  });
});

describe("refreshNestTelemetry", () => {
  beforeEach(() => {
    setNestEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockReset();
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockListDevices.mockReset();
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
  });
  afterEach(restoreEnv);

  it("queries only already-enabled, mapped Nest devices — never touches unmapped or disabled ones", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([]);

    await refreshNestTelemetry(actor);

    expect(prisma.providerDevice.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        smartDeviceId: { not: null },
        integrationConnection: { provider: "NEST" },
      },
      select: { id: true, externalDeviceId: true, smartDeviceId: true },
    });
  });

  it("makes zero Nest API calls when there are no enabled devices to refresh", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([]);

    const result = await refreshNestTelemetry(actor);

    expect(mockListDevices).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, notReturnedByProvider: 0 });
  });

  it("uses exactly one bulk listDevices() call regardless of how many devices are enabled", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
      enabledProviderDevice("pd-2", "ext-2", "sd-2"),
      enabledProviderDevice("pd-3", "ext-3", "sd-3"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([
      nestDevice("ext-1"),
      nestDevice("ext-2"),
      nestDevice("ext-3"),
    ]);

    await refreshNestTelemetry(actor);

    expect(mockListDevices).toHaveBeenCalledTimes(1);
  });

  it("updates the existing SmartDevice's telemetry/status and the existing ProviderDevice's snapshot/freshness for a matched device", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([
      nestDevice("ext-1", {
        connectivity: "ONLINE",
        ambientTemperatureCelsius: 22,
        thermostatMode: "HEAT",
      }),
    ]);

    const result = await refreshNestTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sd-1" },
        data: expect.objectContaining({
          status: "ONLINE",
          metadata: expect.objectContaining({
            mode: "HEAT",
            telemetryUpdatedAt: expect.any(String),
          }),
        }),
      }),
    );
    expect(prisma.providerDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pd-1" },
        data: expect.objectContaining({
          connectivityStatus: "ONLINE",
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toEqual({ refreshed: 1, notReturnedByProvider: 0 });
  });

  it("never touches any mapping field — propertyId/enabled/mappedAt/mappedByUserId/smartDeviceId never appear in the ProviderDevice write", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([nestDevice("ext-1")]);

    await refreshNestTelemetry(actor);

    const call = vi.mocked(prisma.providerDevice.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    for (const forbiddenField of [
      "propertyId",
      "enabled",
      "mappedAt",
      "mappedByUserId",
      "smartDeviceId",
    ]) {
      expect(call.data).not.toHaveProperty(forbiddenField);
    }
  });

  it("never calls create/upsert on either model — only update, on rows that already exist", () => {
    // The mocked prisma client above defines no `create`/`upsert` method on
    // either providerDevice or smartDevice at all — if this file ever
    // called one, the test run above would already have thrown
    // "is not a function". This test documents that guarantee explicitly.
    expect(
      (prisma.providerDevice as unknown as Record<string, unknown>).upsert,
    ).toBeUndefined();
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).upsert,
    ).toBeUndefined();
  });

  it("leaves a device Nest doesn't report this time completely untouched, and counts it separately — never prunes/disables it", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
      enabledProviderDevice("pd-2", "ext-2", "sd-2"),
    ] as never);
    // Only ext-1 comes back — ext-2 has temporarily dropped out of the
    // account's response, same real-world case that caused data loss for
    // Cielo before (see smart-devices.service.ts's pruning-removal comment).
    mockListDevices.mockResolvedValueOnce([nestDevice("ext-1")]);

    const result = await refreshNestTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(1);
    expect(prisma.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sd-1" } }),
    );
    expect(result).toEqual({ refreshed: 1, notReturnedByProvider: 1 });
  });

  it("propagates a not-configured error when Nest credentials are missing, even when there are zero enabled devices — never silently reports a misleading '0 refreshed' success", async () => {
    delete process.env.NEST_CLIENT_ID;

    await expect(refreshNestTelemetry(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(prisma.providerDevice.findMany).not.toHaveBeenCalled();
    expect(mockListDevices).not.toHaveBeenCalled();
  });

  it("propagates denial when the actor lacks smart_devices:update, without querying the database", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshNestTelemetry(actor)).rejects.toThrow();
    expect(prisma.providerDevice.findMany).not.toHaveBeenCalled();
  });
});

describe("refreshCieloTelemetry", () => {
  beforeEach(() => {
    setCieloEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findMany).mockReset();
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockListCieloDevices.mockReset();
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
  });
  afterEach(restoreEnv);

  it("queries only existing SmartDevice rows for CIELO — never reads CIELO_PROPERTY_MAP or anything discovery-shaped", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([]);

    await refreshCieloTelemetry(actor);

    expect(prisma.smartDevice.findMany).toHaveBeenCalledWith({
      where: { provider: "CIELO" },
      select: { id: true, externalDeviceId: true },
    });
  });

  it("THE CRITICAL SAFETY PROOF: a Cielo device with no existing SmartDevice row is never created, even if Cielo's live API reports it", async () => {
    // Zero existing rows in StayWhile's DB — but the live provider reports
    // a real device. Reusing syncCieloDevices() here would upsert-create a
    // brand-new SmartDevice row for it; refreshCieloTelemetry() must not.
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([]);
    mockListCieloDevices.mockResolvedValueOnce([cieloDevice("mac-new-device")]);

    const result = await refreshCieloTelemetry(actor);

    // Zero Cielo API calls too — there's nothing to refresh, and this
    // function must never look up CIELO_PROPERTY_MAP to decide otherwise.
    expect(mockListCieloDevices).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, notReturnedByProvider: 0 });
  });

  it("makes zero Cielo API calls when there are no existing Cielo devices to refresh", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([]);

    await refreshCieloTelemetry(actor);

    expect(mockListCieloDevices).not.toHaveBeenCalled();
  });

  it("uses exactly one bulk listDevices() call regardless of how many existing devices there are", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
      existingCieloSmartDevice("sd-2", "mac-2"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([
      cieloDevice("mac-1"),
      cieloDevice("mac-2"),
    ]);

    await refreshCieloTelemetry(actor);

    expect(mockListCieloDevices).toHaveBeenCalledTimes(1);
  });

  it("updates only status/lastSeenAt on an existing SmartDevice row for a matched device — by its own id, never an upsert", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([
      cieloDevice("mac-1", { online: true }),
    ]);

    const result = await refreshCieloTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: "sd-1" },
      data: { status: "ONLINE", lastSeenAt: expect.any(Date) },
    });
    expect(result).toEqual({ refreshed: 1, notReturnedByProvider: 0 });
  });

  it("writes OFFLINE status and a null lastSeenAt for a device Cielo reports as offline", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([
      cieloDevice("mac-1", { online: false }),
    ]);

    await refreshCieloTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: "sd-1" },
      data: { status: "OFFLINE", lastSeenAt: null },
    });
  });

  it("never writes metadata or name — this provider has no telemetry beyond online/offline status to honestly report", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([cieloDevice("mac-1")]);

    await refreshCieloTelemetry(actor);

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).not.toHaveProperty("metadata");
    expect(call.data).not.toHaveProperty("name");
  });

  it("never calls create/upsert — only update, on rows that already exist", () => {
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).upsert,
    ).toBeUndefined();
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  it("leaves a device Cielo doesn't report this time completely untouched, and counts it separately — never prunes/disables it", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
      existingCieloSmartDevice("sd-2", "mac-2"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([cieloDevice("mac-1")]);

    const result = await refreshCieloTelemetry(actor);

    expect(prisma.smartDevice.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ refreshed: 1, notReturnedByProvider: 1 });
  });

  it("propagates a not-configured error when Cielo credentials are missing, even when there are zero existing devices", async () => {
    delete process.env.CIELO_USERNAME;

    await expect(refreshCieloTelemetry(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
    expect(mockListCieloDevices).not.toHaveBeenCalled();
  });

  it("propagates denial when the actor lacks smart_devices:update, without querying the database", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshCieloTelemetry(actor)).rejects.toThrow();
    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
  });
});

describe("refreshThermostats — provider isolation", () => {
  beforeEach(() => {
    setNestEnv();
    setCieloEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.findMany).mockReset().mockResolvedValue([]);
    mockListDevices.mockReset().mockResolvedValue([]);
    mockListCieloDevices.mockReset().mockResolvedValue([]);
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
  });
  afterEach(restoreEnv);

  it("delegates Cielo to refreshCieloTelemetry(), not syncCieloDevices() — no duplicate/unsafe implementation", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-1", "mac-1"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([cieloDevice("mac-1")]);

    const result = await refreshThermostats(actor);

    expect(result.providers).toContainEqual({
      provider: "CIELO",
      status: "success",
      refreshed: 1,
      notReturnedByProvider: 0,
    });
  });

  it("reports both providers' real success together when both succeed", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([nestDevice("ext-1")]);
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-c1", "mac-1"),
      existingCieloSmartDevice("sd-c2", "mac-2"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([
      cieloDevice("mac-1"),
      cieloDevice("mac-2"),
    ]);

    const result = await refreshThermostats(actor);

    expect(result.providers).toEqual([
      {
        provider: "NEST",
        status: "success",
        refreshed: 1,
        notReturnedByProvider: 0,
      },
      {
        provider: "CIELO",
        status: "success",
        refreshed: 2,
        notReturnedByProvider: 0,
      },
    ]);
    expect(result.refreshedAt).toEqual(expect.any(String));
  });

  it("one provider failing produces a partial result — the other provider's real success is never lost", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockRejectedValueOnce(
      new Error("connection reset"),
    );
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      existingCieloSmartDevice("sd-c1", "mac-1"),
    ]);
    mockListCieloDevices.mockResolvedValueOnce([cieloDevice("mac-1")]);

    const result = await refreshThermostats(actor);

    expect(result.providers).toContainEqual({
      provider: "NEST",
      status: "failure",
      error: "connection reset",
    });
    expect(result.providers).toContainEqual({
      provider: "CIELO",
      status: "success",
      refreshed: 1,
      notReturnedByProvider: 0,
    });
  });

  it("represents total failure as two independent failure entries, not a single swallowed error", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockRejectedValueOnce(
      new Error("nest down"),
    );
    vi.mocked(prisma.smartDevice.findMany).mockRejectedValueOnce(
      new Error("cielo down"),
    );

    const result = await refreshThermostats(actor);

    expect(result.providers).toEqual([
      { provider: "NEST", status: "failure", error: "nest down" },
      { provider: "CIELO", status: "failure", error: "cielo down" },
    ]);
  });

  it("classifies a missing-credentials error as not_configured, distinct from a real failure", async () => {
    delete process.env.NEST_CLIENT_ID;
    delete process.env.CIELO_USERNAME;

    const result = await refreshThermostats(actor);

    expect(result.providers).toContainEqual({
      provider: "NEST",
      status: "not_configured",
    });
    expect(result.providers).toContainEqual({
      provider: "CIELO",
      status: "not_configured",
    });
  });

  it("propagates an RBAC denial at the top level instead of downgrading it to a per-provider failure row", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshThermostats(actor)).rejects.toThrow("ForbiddenError");
    expect(mockListDevices).not.toHaveBeenCalled();
    expect(mockListCieloDevices).not.toHaveBeenCalled();
  });
});

describe("thermostat-refresh.service — diagnostic logging", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  function loggedEvents(): Array<Record<string, unknown>> {
    return consoleLogSpy.mock.calls.map((call) =>
      JSON.parse(call[1] as string),
    );
  }

  beforeEach(() => {
    setNestEnv();
    setCieloEnv();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    vi.mocked(prisma.providerDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockListDevices.mockReset().mockResolvedValue([]);
    mockListCieloDevices.mockReset().mockResolvedValue([]);
    mockTransaction
      .mockReset()
      .mockImplementation(async (arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg,
      );
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleLogSpy.mockRestore();
    restoreEnv();
  });

  it("logs every event under the [thermostat-refresh] prefix, structured, at least once for a real run", async () => {
    await refreshThermostats(actor);

    expect(consoleLogSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of consoleLogSpy.mock.calls) {
      expect(call[0]).toBe("[thermostat-refresh]");
      // Every logged payload must be valid, parseable structured JSON with
      // a named event — never a raw string dump of something unexpected.
      const parsed = JSON.parse(call[1] as string) as { event?: unknown };
      expect(typeof parsed.event).toBe("string");
    }
  });

  it("logs a provider_outcome event with status success for a provider that refreshed real devices", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([nestDevice("ext-1")]);

    await refreshThermostats(actor);

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "provider_outcome",
        provider: "NEST",
        status: "success",
        refreshed: 1,
      }),
    );
  });

  it("logs a provider_outcome event with status not_configured when a provider's credentials are missing", async () => {
    delete process.env.CIELO_USERNAME;

    await refreshThermostats(actor);

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "provider_outcome",
        provider: "CIELO",
        status: "not_configured",
      }),
    );
  });

  it("logs a provider_outcome event with status failure and the same sanitized message already returned to the UI when a provider call fails", async () => {
    vi.mocked(prisma.smartDevice.findMany).mockRejectedValueOnce(
      new Error("Request to /web/devices failed with 500"),
    );

    await refreshThermostats(actor);

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "provider_outcome",
        provider: "CIELO",
        status: "failure",
        error: "Request to /web/devices failed with 500",
      }),
    );
  });

  it("logs the real, enforced authorization outcome at the service boundary — permission_denied when RBAC actually rejects the actor", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(refreshThermostats(actor)).rejects.toThrow();

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "permission_denied",
        actorUserId: "user-1",
        permission: "smart_devices:update",
      }),
    );
  });

  it("logs permission_granted at the service boundary when RBAC allows the actor", async () => {
    await refreshThermostats(actor);

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "permission_granted",
        actorUserId: "user-1",
        permission: "smart_devices:update",
      }),
    );
  });

  it("SECRET-SAFETY: never logs any credential/env value, even across every event this run produces, including the not-configured case that names the missing env vars", async () => {
    delete process.env.NEST_CLIENT_ID;

    await refreshThermostats(actor);

    const serialized = JSON.stringify(loggedEvents());
    for (const secretLikeValue of [
      "client-id",
      "client-secret",
      "project-id",
      "refresh-token",
      "cielo-user",
      "cielo-pass",
    ]) {
      expect(serialized).not.toContain(secretLikeValue);
    }
    // The env VAR NAMES are allowed to appear (they're not secret — see
    // getNestClientFromEnv()'s own thrown message, already shown to users
    // elsewhere in this app), but no logged event should carry a `token`,
    // `secret`, `password`, or `credential`-shaped field at all.
    for (const event of loggedEvents()) {
      for (const key of Object.keys(event)) {
        expect(key.toLowerCase()).not.toMatch(
          /token|secret|password|credential|clientid|clientsecret/,
        );
      }
    }
  });

  it("SECRET-SAFETY: never logs raw provider metadata/payloads — only counts and status strings", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockResolvedValueOnce([
      nestDevice("ext-1", {
        rawTraits: {
          "sdm.devices.traits.Info": { customName: "secret-device-label" },
        },
      }),
    ]);

    await refreshThermostats(actor);

    const serialized = JSON.stringify(loggedEvents());
    expect(serialized).not.toContain("secret-device-label");
    expect(serialized).not.toContain("rawTraits");
  });

  it("logs a nest_oauth_error_diagnostic event with the sanitized diagnostic fields when the Nest OAuth refresh itself fails", async () => {
    // This describe block's beforeEach defaults providerDevice.findMany to
    // [] (no eligible devices) — refreshNestTelemetry() would short-circuit
    // before ever calling client.listDevices() otherwise, and the rejection
    // below would never actually be exercised.
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockRejectedValueOnce(
      new NestOAuthRefreshError({
        httpStatus: 400,
        oauthError: "invalid_grant",
        oauthErrorDescription: "Token has been expired or revoked.",
        clientIdPresent: true,
        clientSecretPresent: true,
        refreshTokenPresent: true,
        clientIdHasWhitespace: false,
        clientSecretHasWhitespace: false,
        refreshTokenHasWhitespace: true,
      }),
    );

    await refreshThermostats(actor);

    expect(loggedEvents()).toContainEqual(
      expect.objectContaining({
        event: "nest_oauth_error_diagnostic",
        actorUserId: "user-1",
        httpStatus: 400,
        oauthError: "invalid_grant",
        oauthErrorDescription: "Token has been expired or revoked.",
        clientIdPresent: true,
        clientSecretPresent: true,
        refreshTokenPresent: true,
        clientIdHasWhitespace: false,
        clientSecretHasWhitespace: false,
        refreshTokenHasWhitespace: true,
      }),
    );
  });

  it("does NOT log a nest_oauth_error_diagnostic event for a non-OAuth Nest failure", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockRejectedValueOnce(
      new Error("Request to /devices failed with 500"),
    );

    await refreshThermostats(actor);

    expect(loggedEvents()).not.toContainEqual(
      expect.objectContaining({ event: "nest_oauth_error_diagnostic" }),
    );
  });

  it("UI-SAFETY: the ProviderRefreshOutcome.error surfaced to the dashboard stays generic — Google's real error_description text never appears in the returned outcome, even though it's present in the server-side diagnostic log", async () => {
    const distinctiveGoogleText =
      "This exact free-text sentence from Google must never reach a dashboard user.";
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockRejectedValueOnce(
      new NestOAuthRefreshError({
        httpStatus: 400,
        oauthError: "invalid_grant",
        oauthErrorDescription: distinctiveGoogleText,
        clientIdPresent: true,
        clientSecretPresent: true,
        refreshTokenPresent: true,
        clientIdHasWhitespace: false,
        clientSecretHasWhitespace: false,
        refreshTokenHasWhitespace: false,
      }),
    );

    const result = await refreshThermostats(actor);

    const nestOutcome = result.providers.find((p) => p.provider === "NEST");
    expect(nestOutcome).toEqual({
      provider: "NEST",
      status: "failure",
      error: "Nest OAuth token refresh failed with 400",
    });
    expect(JSON.stringify(result)).not.toContain(distinctiveGoogleText);

    // The rich diagnostic legitimately reaches server-side logs — this is
    // the intended split, not a gap: log-only, never in the returned value.
    expect(
      loggedEvents()
        .map((e) => JSON.stringify(e))
        .join(""),
    ).toContain(distinctiveGoogleText);
  });

  it("SECRET-SAFETY: an OAuth diagnostic log entry never contains a credential value, only the presence/whitespace booleans", async () => {
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      enabledProviderDevice("pd-1", "ext-1", "sd-1"),
    ] as never);
    mockListDevices.mockRejectedValueOnce(
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
      }),
    );

    await refreshThermostats(actor);

    const diagnosticEvent = loggedEvents().find(
      (e) => e.event === "nest_oauth_error_diagnostic",
    );
    expect(diagnosticEvent).toBeDefined();
    // Only the exact allowed keys ever exist on this event — booleans,
    // numbers, short known strings, and a timestamp; nothing else can leak
    // through, since a credential value would have to arrive under one of
    // these exact, pre-approved key names to be visible at all, and none of
    // them are ever assigned a credential value anywhere in this file.
    expect(Object.keys(diagnosticEvent ?? {}).sort()).toEqual(
      [
        "event",
        "actorUserId",
        "timestamp",
        "httpStatus",
        "oauthError",
        "oauthErrorDescription",
        "clientIdPresent",
        "clientSecretPresent",
        "refreshTokenPresent",
        "clientIdHasWhitespace",
        "clientSecretHasWhitespace",
        "refreshTokenHasWhitespace",
      ].sort(),
    );
  });
});
