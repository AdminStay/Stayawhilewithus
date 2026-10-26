import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefreshAutomatic, mockAlerts } = vi.hoisted(() => ({
  mockRefreshAutomatic: vi.fn(),
  mockAlerts: vi.fn(),
}));

vi.mock("@/domains/smart-devices/services/thermostat-refresh.service", () => ({
  refreshThermostatsAutomatic: mockRefreshAutomatic,
}));
vi.mock(
  "@/domains/smart-devices/services/thermostat-refresh-alerts.service",
  () => ({ checkThermostatRefreshHealthAndAlert: mockAlerts }),
);

const { GET, maxDuration } = await import("./route");

const SECRET = "s3cret-value-for-tests";
const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/thermostat-refresh", {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mockAlerts.mockResolvedValue([]);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/thermostat-refresh — authentication", () => {
  it("503 when CRON_SECRET is not configured — nothing runs", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request("Bearer anything"));
    expect(res.status).toBe(503);
    expect(mockRefreshAutomatic).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "Bearer wrong",
    SECRET,
    `bearer ${SECRET}`,
    `Basic ${SECRET}`,
  ])("401 for authorization=%s — nothing runs", async (header) => {
    const res = await GET(request(header));
    expect(res.status).toBe(401);
    expect(mockRefreshAutomatic).not.toHaveBeenCalled();
    expect(mockAlerts).not.toHaveBeenCalled();
  });

  it("an error response never echoes the secret", async () => {
    const res = await GET(request("Bearer wrong"));
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });
});

describe("GET /api/cron/thermostat-refresh — outcomes", () => {
  const auth = `Bearer ${SECRET}`;

  it("kill switch off (the default) → 200 disabled, no alert check", async () => {
    mockRefreshAutomatic.mockResolvedValue({ status: "disabled" });
    const res = await GET(request(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "disabled" });
    expect(mockAlerts).not.toHaveBeenCalled();
  });

  it("another run in progress → 200 already_running, no alert check", async () => {
    mockRefreshAutomatic.mockResolvedValue({ status: "already_running" });
    const res = await GET(request(auth));
    expect(await res.json()).toEqual({ ok: true, status: "already_running" });
    expect(mockAlerts).not.toHaveBeenCalled();
  });

  it("a completed run → statuses and counts only, then the alert check runs", async () => {
    mockRefreshAutomatic.mockResolvedValue({
      status: "completed",
      nest: { status: "success", refreshed: 39, notReturnedByProvider: 0 },
      cielo: { status: "skipped", reason: "not_due" },
    });
    const res = await GET(request(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "completed",
      nest: { status: "success", refreshed: 39, notReturnedByProvider: 0 },
      cielo: { status: "skipped", reason: "not_due" },
    });
    expect(mockAlerts).toHaveBeenCalledTimes(1);
  });

  it("includes any alert raised (provider + reason only)", async () => {
    mockRefreshAutomatic.mockResolvedValue({
      status: "completed",
      nest: { status: "failed", code: "NEST_AUTH_EXPIRED" },
      cielo: { status: "skipped", reason: "not_due" },
    });
    mockAlerts.mockResolvedValue([{ provider: "NEST", reason: "auth_failed" }]);
    const body = await (await GET(request(auth))).json();
    expect(body.alerts).toEqual([{ provider: "NEST", reason: "auth_failed" }]);
  });

  it("an unexpected error → 500 with a generic body; the error text is not returned or logged", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockRefreshAutomatic.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:pw@db"),
    );
    const res = await GET(request(auth));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("pw@db");
    consoleError.mockRestore();
  });

  it("maxDuration 60 s", () => {
    expect(maxDuration).toBe(60);
  });
});

describe("route source — read-only by construction", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "./route.ts"),
    "utf8",
  );

  it("is GET-only", () => {
    expect(source).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("imports nothing but the automatic refresh and its alert check", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      "@/domains/smart-devices/services/thermostat-refresh-alerts.service",
      "@/domains/smart-devices/services/thermostat-refresh.service",
      "next/server",
    ]);
  });

  it("never references a thermostat command, discovery or mapping function", () => {
    for (const forbidden of [
      "Command",
      "Setpoint",
      "discoverNestDevices",
      "syncCieloDevices",
      "mapProviderDevice",
      "setProviderDeviceEnabled",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
