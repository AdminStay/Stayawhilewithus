import { describe, expect, it, vi } from "vitest";

const mockRequest = vi.fn();

vi.mock("../core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core")>();
  return {
    ...actual,
    HttpClient: class MockHttpClient {
      request = mockRequest;
    },
  };
});

import { CieloClient, parseCieloDevice } from "./client";

const credentials = { username: "test@example.com", password: "hunter2" };

const LOGIN_SUCCESS = {
  status: 200,
  message: "SUCCESS",
  data: { user: { accessToken: "access-1", userId: "user-1" } },
};

describe("CieloClient", () => {
  it("declares sync + webhook capabilities for the CIELO provider", () => {
    const client = new CieloClient(credentials);

    expect(client.provider).toBe("CIELO");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("connect() logs in and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    const client = new CieloClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith(
      "/user/smarthvac/login/1",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.connected).toBe(true);
    expect(result.connectedAt).toBeInstanceOf(Date);
  });

  it("login sends the password as a SHA-256 hash, never the plaintext", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    const client = new CieloClient(credentials);

    await client.connect();

    const [, init] = mockRequest.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.user.password).not.toBe(credentials.password);
    expect(body.user.password).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validateCredentials() returns invalid with a reason when login fails", async () => {
    mockRequest.mockResolvedValueOnce({
      status: 401,
      message: "Invalid credentials",
    });
    const client = new CieloClient(credentials);

    const result = await client.validateCredentials();

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Invalid credentials/);
  });

  it("healthCheck() returns unhealthy with details when the request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));
    const client = new CieloClient(credentials);

    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details).toBe("network error");
  });

  it("listDevices() logs in, then reads deviceStatus/macAddress/deviceName from /web/devices", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS).mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [
          {
            deviceName: "Living Room",
            macAddress: "aa:bb:cc",
            deviceStatus: 1,
          },
          { deviceName: "Main", macAddress: "dd:ee:ff", deviceStatus: 0 },
        ],
      },
    });
    const client = new CieloClient(credentials);

    const devices = await client.listDevices();

    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      "/web/devices?limit=420",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "access-1" }),
      }),
    );
    expect(devices).toEqual([
      { id: "aa:bb:cc", name: "Living Room", online: true },
      { id: "dd:ee:ff", name: "Main", online: false },
    ]);
  });

  it("sync(INBOUND) fetches devices and reports the count processed, without writing to the database", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS).mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [{ deviceName: "A", macAddress: "1", deviceStatus: 1 }],
      },
    });
    const client = new CieloClient(credentials);

    const result = await client.sync("INBOUND");

    expect(result).toEqual({ recordsProcessed: 1, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — Cielo is the system of record for its own device state", async () => {
    const client = new CieloClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() throws NotImplementedError — no webhook payload shape has been researched", async () => {
    const client = new CieloClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
      /not implemented yet/,
    );
  });

  it("never exposes any HVAC command/control method — read-only by construction", () => {
    const client = new CieloClient(credentials);
    for (const forbidden of [
      "setTemperature",
      "setMode",
      "setFan",
      "setPower",
      "setFanspeed",
      "sendCommand",
      "control",
    ]) {
      expect(
        (client as unknown as Record<string, unknown>)[forbidden],
      ).toBeUndefined();
    }
  });
});

describe("parseCieloDevice", () => {
  const baseRaw = {
    deviceName: "Island Tides - Man cave",
    macAddress: "aa:bb:cc",
    deviceStatus: 1,
  };

  it("parses realistic rich /web/devices fields when isFaren=1 (real observed Island Tides shape)", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latEnv: { temp: 69, humidity: 42 },
      latestAction: {
        temp: "72",
        mode: "cool",
        fanspeed: "auto",
        power: "on",
        timestamp: 1799000000, // seconds-epoch shape
      },
    });

    expect(device).toEqual({
      id: "aa:bb:cc",
      name: "Island Tides - Man cave",
      online: true,
      currentTemperature: 69,
      targetTemperature: 72,
      mode: "cool",
      fanSpeed: "auto",
      humidity: 42,
      power: "on",
      telemetryUpdatedAt: new Date(1799000000 * 1000).toISOString(),
    });
  });

  it('accepts a numeric-string target temperature (observed live as "72", a string) identically to a real number', () => {
    const withString = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latestAction: { temp: "72" },
    });
    const withNumber = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latestAction: { temp: 72 },
    });

    expect(withString.targetTemperature).toBe(72);
    expect(withNumber.targetTemperature).toBe(72);
  });

  it("FAIL-SAFE: omits both temperature fields entirely when isFaren is not confirmed (0)", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 0,
      latEnv: { temp: 21 },
      latestAction: { temp: 24 },
    });

    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
  });

  it("FAIL-SAFE: omits both temperature fields entirely when isFaren is missing — never assumes a unit", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      latEnv: { temp: 69 },
      latestAction: { temp: 72 },
    });

    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
  });

  it("still parses humidity/mode/fanSpeed/power/telemetryUpdatedAt even when isFaren is not confirmed — only temperature is unit-gated", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      latEnv: { humidity: 55 },
      latestAction: {
        mode: "heat",
        fanspeed: "high",
        power: "off",
        timestamp: 1799000000,
      },
    });

    expect(device.humidity).toBe(55);
    expect(device.mode).toBe("heat");
    expect(device.fanSpeed).toBe("high");
    expect(device.power).toBe("off");
    expect(device.telemetryUpdatedAt).toBe(
      new Date(1799000000 * 1000).toISOString(),
    );
  });

  it("preserves a legitimate humidity of 0 — never treated as absent", () => {
    const device = parseCieloDevice({ ...baseRaw, latEnv: { humidity: 0 } });

    expect(device.humidity).toBe(0);
  });

  it("preserves a legitimate currentTemperature of 0°F — never treated as absent", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latEnv: { temp: 0 },
    });

    expect(device.currentTemperature).toBe(0);
  });

  it("omits each field individually when missing, never fabricating a value", () => {
    const device = parseCieloDevice(baseRaw);

    expect(device).toEqual({
      id: "aa:bb:cc",
      name: "Island Tides - Man cave",
      online: true,
    });
    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
    expect(device).not.toHaveProperty("mode");
    expect(device).not.toHaveProperty("fanSpeed");
    expect(device).not.toHaveProperty("humidity");
    expect(device).not.toHaveProperty("power");
    expect(device).not.toHaveProperty("telemetryUpdatedAt");
  });

  it("MALFORMED VALUES: a non-numeric temperature/humidity string is treated as absent, never crashes", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latEnv: { temp: "not-a-number", humidity: "also-not-a-number" },
      latestAction: { temp: "also-nan" },
    });

    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
    expect(device).not.toHaveProperty("humidity");
  });

  it('REGRESSION: an empty string never becomes a fabricated 0 — Number("") is 0 in JavaScript, this must not leak through', () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latEnv: { temp: "", humidity: "" },
      latestAction: { temp: "" },
    });

    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
    expect(device).not.toHaveProperty("humidity");
  });

  it("REGRESSION: a whitespace-only string never becomes a fabricated 0", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      isFaren: 1,
      latEnv: { temp: "   ", humidity: "\t" },
      latestAction: { temp: "  " },
    });

    expect(device).not.toHaveProperty("currentTemperature");
    expect(device).not.toHaveProperty("targetTemperature");
    expect(device).not.toHaveProperty("humidity");
  });

  it("REGRESSION: an empty-string timestamp never becomes a fabricated 'now' or epoch-0 date", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: "" },
    });

    expect(device).not.toHaveProperty("telemetryUpdatedAt");
  });

  it("MALFORMED VALUES: a non-string mode/fanspeed is treated as absent, never crashes", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: {
        mode: 12345 as unknown as string,
        fanspeed: null as unknown as string,
      },
    });

    expect(device).not.toHaveProperty("mode");
    expect(device).not.toHaveProperty("fanSpeed");
  });

  it("TIMESTAMP: parses a milliseconds-epoch value correctly (magnitude > 1e12)", () => {
    const millis = Date.now();
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: millis },
    });

    expect(device.telemetryUpdatedAt).toBe(new Date(millis).toISOString());
  });

  it("TIMESTAMP: parses a seconds-epoch value correctly (magnitude <= 1e12)", () => {
    const seconds = Math.floor(Date.now() / 1000);
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: seconds },
    });

    expect(device.telemetryUpdatedAt).toBe(
      new Date(seconds * 1000).toISOString(),
    );
  });

  it("TIMESTAMP: accepts a numeric-string timestamp", () => {
    const seconds = Math.floor(Date.now() / 1000);
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: String(seconds) },
    });

    expect(device.telemetryUpdatedAt).toBe(
      new Date(seconds * 1000).toISOString(),
    );
  });

  it("TIMESTAMP: missing/malformed timestamp results in the key being omitted, never fabricated as 'now'", () => {
    const missing = parseCieloDevice({ ...baseRaw, latestAction: {} });
    const malformed = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: "not-a-timestamp" },
    });
    const zero = parseCieloDevice({
      ...baseRaw,
      latestAction: { timestamp: 0 },
    });

    expect(missing).not.toHaveProperty("telemetryUpdatedAt");
    expect(malformed).not.toHaveProperty("telemetryUpdatedAt");
    expect(zero).not.toHaveProperty("telemetryUpdatedAt");
  });

  it("never uses ontimestamp or statustimestamp for telemetryUpdatedAt, even when present", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      latestAction: {
        ontimestamp: 1111111111,
        statustimestamp: 2222222222,
      } as unknown as { timestamp?: number },
    });

    expect(device).not.toHaveProperty("telemetryUpdatedAt");
  });

  it("OFFLINE + rich telemetry: an offline device still gets its reported temperature/mode/etc. parsed — connectivity and telemetry are independent", () => {
    const device = parseCieloDevice({
      ...baseRaw,
      deviceStatus: 0,
      isFaren: 1,
      latEnv: { temp: 69, humidity: 40 },
      latestAction: { temp: "72", mode: "cool" },
    });

    expect(device.online).toBe(false);
    expect(device.currentTemperature).toBe(69);
    expect(device.targetTemperature).toBe(72);
    expect(device.mode).toBe("cool");
  });

  it('existing ONLINE/OFFLINE derivation from deviceStatus is unchanged (1/"on" = online, else offline)', () => {
    expect(parseCieloDevice({ ...baseRaw, deviceStatus: 1 }).online).toBe(true);
    expect(parseCieloDevice({ ...baseRaw, deviceStatus: "on" }).online).toBe(
      true,
    );
    expect(parseCieloDevice({ ...baseRaw, deviceStatus: 0 }).online).toBe(
      false,
    );
    expect(parseCieloDevice({ ...baseRaw, deviceStatus: "off" }).online).toBe(
      false,
    );
  });
});
