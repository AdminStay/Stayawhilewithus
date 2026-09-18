import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the 2026-09-18/19 fix: syncCieloDevices()
 * ("Sync Now") used to unconditionally write `metadata: {}` on every run,
 * which would silently erase whatever rich telemetry
 * refreshCieloTelemetry() ("Refresh") had already written. The fix makes
 * sync own identity/property-mapping/connectivity only, never `metadata`.
 *
 * This file runs the two REAL service functions (syncCieloDevices,
 * refreshCieloTelemetry) back-to-back against a small stateful in-memory
 * fake of `prisma.smartDevice` — not a call-count assertion on an
 * opaque mock — specifically so a genuine "sync then refresh" / "refresh
 * then sync" ordering bug would actually surface here, the same way it
 * would against a real database.
 */

const mockRequest = vi.fn();

vi.mock("@stayw/integrations/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/core")>();
  return {
    ...actual,
    HttpClient: class MockHttpClient {
      request = mockRequest;
    },
  };
});

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
}));

interface FakeRow {
  id: string;
  provider: string;
  externalDeviceId: string;
  propertyId: string | null;
  name: string;
  deviceType: string;
  status: string;
  lastSeenAt: Date | null;
  metadata: Record<string, unknown>;
}

let rows: FakeRow[] = [];
let nextId = 1;

function keyOf(provider: string, externalDeviceId: string) {
  return `${provider}:${externalDeviceId}`;
}

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: {
            provider_externalDeviceId: {
              provider: string;
              externalDeviceId: string;
            };
          };
          update: Partial<FakeRow>;
          create: Omit<FakeRow, "id">;
        }) => {
          const { provider, externalDeviceId } =
            where.provider_externalDeviceId;
          const existing = rows.find(
            (r) =>
              keyOf(r.provider, r.externalDeviceId) ===
              keyOf(provider, externalDeviceId),
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created: FakeRow = { id: `row-${nextId++}`, ...create };
          rows.push(created);
          return created;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { provider: string };
          select: Record<string, boolean>;
        }) => {
          return rows
            .filter((r) => r.provider === where.provider)
            .map((r) => {
              const projected: Record<string, unknown> = {};
              for (const key of Object.keys(select)) {
                projected[key] = (r as unknown as Record<string, unknown>)[key];
              }
              return projected;
            });
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeRow>;
        }) => {
          const existing = rows.find((r) => r.id === where.id);
          if (!existing) throw new Error(`no fake row with id ${where.id}`);
          Object.assign(existing, data);
          return existing;
        },
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (writes: Promise<unknown>[]) =>
      Promise.all(writes),
    ),
  },
}));

import { prisma } from "@stayw/database";

import { refreshCieloTelemetry } from "./thermostat-refresh.service";
import { syncCieloDevices } from "./smart-devices.service";

const actor = { userId: "user-1" };

const ENV_KEYS = [
  "CIELO_USERNAME",
  "CIELO_PASSWORD",
  "CIELO_PROPERTY_MAP",
] as const;
const original: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

const LOGIN_SUCCESS = {
  status: 200,
  message: "SUCCESS",
  data: { user: { accessToken: "access-1", userId: "user-1" } },
};

function deviceListResponse(entry: Record<string, unknown>) {
  return {
    status: 200,
    message: "SUCCESS",
    data: { listDevices: [entry] },
  };
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  vi.clearAllMocks();
  rows = [];
  nextId = 1;
});

describe("Cielo sync <-> refresh interaction", () => {
  it("sync creates a new device with empty metadata (nothing fabricated), then refresh populates real telemetry on that same row", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-ridge",
    });

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
      }),
    );

    const syncResult = await syncCieloDevices(actor);
    expect(syncResult).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({});

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
        isFaren: 1,
        latEnv: { temp: 71, humidity: 44 },
        latestAction: {
          temp: 70,
          mode: "cool",
          fanspeed: "auto",
          power: "on",
          timestamp: 1_726_000_000,
        },
      }),
    );

    const refreshResult = await refreshCieloTelemetry(actor);
    expect(refreshResult.refreshed).toBe(1);
    expect(rows[0]!.metadata).toMatchObject({
      currentTemperature: 71,
      targetTemperature: 70,
      humidity: 44,
      mode: "cool",
      fanSpeed: "auto",
      power: "on",
    });
  });

  it("refresh populates telemetry, then a later Sync Now run does NOT erase it (the exact bug this fix corrects)", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-ridge",
    });

    // Seed one existing SmartDevice row directly (as if a prior sync had
    // already created it) with real telemetry already in metadata (as if
    // a prior refresh had already run).
    rows.push({
      id: "row-1",
      provider: "CIELO",
      externalDeviceId: "aa:bb:cc",
      propertyId: "property-ridge",
      name: "Living Room",
      deviceType: "THERMOSTAT",
      status: "ONLINE",
      lastSeenAt: new Date("2026-09-18T00:00:00.000Z"),
      metadata: {
        currentTemperature: 71,
        targetTemperature: 70,
        humidity: 44,
        mode: "cool",
        fanSpeed: "auto",
        power: "on",
        telemetryUpdatedAt: "2026-09-18T00:00:00.000Z",
      },
    });
    nextId = 2;

    // Sync Now runs again — provider still reports the device, but (as
    // Cielo's /web/devices has historically done) this particular response
    // carries no rich telemetry fields at all, only basic connectivity.
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
      }),
    );

    const syncResult = await syncCieloDevices(actor);

    expect(syncResult).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(rows).toHaveLength(1);
    // The whole point of the fix: previously-collected telemetry survives
    // a sync run whose own provider response didn't carry it.
    expect(rows[0]!.metadata).toEqual({
      currentTemperature: 71,
      targetTemperature: 70,
      humidity: 44,
      mode: "cool",
      fanSpeed: "auto",
      power: "on",
      telemetryUpdatedAt: "2026-09-18T00:00:00.000Z",
    });
    // And sync still did its own job on the fields it owns.
    expect(rows[0]!.status).toBe("ONLINE");
    expect(rows[0]!.name).toBe("Living Room");
  });

  it("sync's own upsert call never includes a `metadata` key on update, structurally — proof independent of the fake store", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-ridge",
    });

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
      }),
    );

    await syncCieloDevices(actor);

    const call = vi.mocked(prisma.smartDevice.upsert).mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(Object.keys(call.update)).not.toContain("metadata");
  });

  it("never calls any Cielo write/control method during either sync or refresh — CieloClient exposes none", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-ridge",
    });

    rows.push({
      id: "row-1",
      provider: "CIELO",
      externalDeviceId: "aa:bb:cc",
      propertyId: "property-ridge",
      name: "Living Room",
      deviceType: "THERMOSTAT",
      status: "ONLINE",
      lastSeenAt: new Date(),
      metadata: {},
    });
    nextId = 2;

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
      }),
    );
    await syncCieloDevices(actor);

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce(
      deviceListResponse({
        deviceName: "Living Room",
        macAddress: "aa:bb:cc",
        deviceStatus: 1,
        isFaren: 1,
        latEnv: { temp: 71 },
      }),
    );
    await refreshCieloTelemetry(actor);

    // Every HTTP call made was either the login POST or a GET to
    // /web/devices — never a PUT/POST to anything control-shaped. The
    // fake HttpClient records exactly what path/init each call received.
    for (const call of mockRequest.mock.calls) {
      const [path, init] = call as [string, RequestInit | undefined];
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        // Only the login endpoint is ever a non-GET call.
        expect(path).toBe("/user/smarthvac/login/1");
      }
    }
  });
});
