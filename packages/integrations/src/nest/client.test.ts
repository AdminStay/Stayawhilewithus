import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  NestClient,
  NestOAuthRefreshError,
  computeNestDeviceCapabilities,
  executeNestThermostatCommand,
  getSupportedNestControls,
  parseNestDevice,
  sanitizeTraits,
  validateNestCommand,
} from "./client";
import type { NestDeviceCapabilities, RawSdmDevice } from "./types";

const credentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  projectId: "test-project-id",
  refreshToken: "test-refresh-token",
};

function mockTokenFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "test-access-token", expires_in: 3600 }),
  });
}

describe("parseNestDevice", () => {
  it("only sets fields for traits the device actually reports, never fabricating a missing one", () => {
    const raw: RawSdmDevice = {
      name: "enterprises/proj/devices/device-1",
      type: "sdm.devices.types.THERMOSTAT",
      traits: {
        "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 21.5 },
        "sdm.devices.traits.Connectivity": { status: "ONLINE" },
      },
    };

    const device = parseNestDevice(raw);

    expect(device.externalDeviceId).toBe("device-1");
    expect(device.ambientTemperatureCelsius).toBe(21.5);
    expect(device.connectivity).toBe("ONLINE");
    expect(device.ambientHumidityPercent).toBeUndefined();
    expect(device.hvacStatus).toBeUndefined();
    expect(device.thermostatMode).toBeUndefined();
    expect(device.heatCelsius).toBeUndefined();
    expect(device.fanTimerMode).toBeUndefined();
  });

  it("parses every documented thermostat trait when all are present", () => {
    const raw: RawSdmDevice = {
      name: "enterprises/proj/devices/device-2",
      type: "sdm.devices.types.THERMOSTAT",
      traits: {
        "sdm.devices.traits.Info": { customName: "Living Room" },
        "sdm.devices.traits.Connectivity": { status: "ONLINE" },
        "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 20 },
        "sdm.devices.traits.Humidity": { ambientHumidityPercent: 40 },
        "sdm.devices.traits.ThermostatHvac": { status: "HEATING" },
        "sdm.devices.traits.ThermostatMode": {
          mode: "HEAT",
          availableModes: ["HEAT", "COOL", "OFF"],
        },
        "sdm.devices.traits.ThermostatTemperatureSetpoint": { heatCelsius: 22 },
        "sdm.devices.traits.ThermostatEco": { mode: "OFF" },
        "sdm.devices.traits.Fan": { timerMode: "OFF" },
      },
      parentRelations: [
        {
          parent: "enterprises/proj/structures/s/rooms/r",
          displayName: "Living Room",
        },
      ],
    };

    const device = parseNestDevice(raw);

    expect(device.customName).toBe("Living Room");
    expect(device.roomName).toBe("Living Room");
    expect(device.connectivity).toBe("ONLINE");
    expect(device.ambientTemperatureCelsius).toBe(20);
    expect(device.ambientHumidityPercent).toBe(40);
    expect(device.hvacStatus).toBe("HEATING");
    expect(device.thermostatMode).toBe("HEAT");
    expect(device.availableThermostatModes).toEqual(["HEAT", "COOL", "OFF"]);
    expect(device.heatCelsius).toBe(22);
    expect(device.ecoMode).toBe("OFF");
    expect(device.fanTimerMode).toBe("OFF");
    expect(device.rawTraits).toEqual(raw.traits);
  });

  it("handles a device with no traits object at all", () => {
    const raw: RawSdmDevice = {
      name: "enterprises/proj/devices/device-3",
      type: "sdm.devices.types.THERMOSTAT",
    };

    const device = parseNestDevice(raw);

    expect(device.externalDeviceId).toBe("device-3");
    expect(device.rawTraits).toEqual({});
    expect(device.connectivity).toBeUndefined();
  });

  it("drops any trait key not on the explicit allowlist, even one that looks plausible", () => {
    const raw: RawSdmDevice = {
      name: "enterprises/proj/devices/device-4",
      type: "sdm.devices.types.THERMOSTAT",
      traits: {
        "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 19 },
        "sdm.devices.traits.OwnerAccount": { email: "owner@example.com" },
        "some.unexpected.future.Trait": { secret: "should never persist" },
      },
    };

    const device = parseNestDevice(raw);

    expect(device.rawTraits).toEqual({
      "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 19 },
    });
    expect(device.rawTraits["sdm.devices.traits.OwnerAccount"]).toBeUndefined();
    expect(device.rawTraits["some.unexpected.future.Trait"]).toBeUndefined();
  });
});

describe("sanitizeTraits", () => {
  it("keeps only allowlisted trait namespaces", () => {
    const result = sanitizeTraits({
      "sdm.devices.traits.Humidity": { ambientHumidityPercent: 30 },
      "sdm.devices.traits.NotOnAllowlist": { anything: true },
    });

    expect(result).toEqual({
      "sdm.devices.traits.Humidity": { ambientHumidityPercent: 30 },
    });
  });

  it("strips unallowlisted fields WITHIN a kept trait, keeping only the documented field(s)", () => {
    const result = sanitizeTraits({
      "sdm.devices.traits.Info": {
        customName: "Living Room",
        // hypothetical future field Google could add — must be dropped
        // even though the trait itself is allowlisted.
        ownerEmail: "owner@example.com",
      },
    });

    expect(result).toEqual({
      "sdm.devices.traits.Info": { customName: "Living Room" },
    });
    expect(
      (result["sdm.devices.traits.Info"] as Record<string, unknown>).ownerEmail,
    ).toBeUndefined();
  });

  it("strips unallowlisted fields from Settings, keeping only temperatureScale", () => {
    const result = sanitizeTraits({
      "sdm.devices.traits.Settings": {
        temperatureScale: "FAHRENHEIT",
        someFutureAccountLinkedSetting: "unexpected",
      },
    });

    expect(result).toEqual({
      "sdm.devices.traits.Settings": { temperatureScale: "FAHRENHEIT" },
    });
  });

  it("returns an empty fields object for a kept trait that reports no allowlisted fields at all", () => {
    const result = sanitizeTraits({
      "sdm.devices.traits.Humidity": { someUnknownField: 1 },
    });

    expect(result).toEqual({ "sdm.devices.traits.Humidity": {} });
  });

  it("returns an empty object for an empty input, never fabricating a trait", () => {
    expect(sanitizeTraits({})).toEqual({});
  });
});

describe("computeNestDeviceCapabilities", () => {
  it("derives setpoint support strictly from availableModes, not from setpoint-trait presence alone", () => {
    const capabilities = computeNestDeviceCapabilities({
      "sdm.devices.traits.ThermostatMode": {
        mode: "HEAT",
        availableModes: ["HEAT", "OFF"],
      },
    });

    expect(capabilities.supportsHeatSetpoint).toBe(true);
    expect(capabilities.supportsCoolSetpoint).toBe(false);
    expect(capabilities.supportsHeatCoolRange).toBe(false);
    expect(capabilities.availableThermostatModes).toEqual(["HEAT", "OFF"]);
  });

  it("marks heat+cool range support only when HEATCOOL is in availableModes", () => {
    const capabilities = computeNestDeviceCapabilities({
      "sdm.devices.traits.ThermostatMode": {
        mode: "HEATCOOL",
        availableModes: ["HEAT", "COOL", "HEATCOOL", "OFF"],
      },
    });

    expect(capabilities.supportsHeatSetpoint).toBe(true);
    expect(capabilities.supportsCoolSetpoint).toBe(true);
    expect(capabilities.supportsHeatCoolRange).toBe(true);
  });

  it("flags unknown capability (not false) when no ThermostatMode trait is reported at all", () => {
    const capabilities = computeNestDeviceCapabilities({});

    expect(capabilities.supportsHeatSetpoint).toBe(false);
    expect(capabilities.supportsCoolSetpoint).toBe(false);
    expect(capabilities.availableThermostatModes).toEqual([]);
    expect(capabilities.restrictions).toContain(
      "No ThermostatMode.availableModes reported by this device — mode/setpoint capability is unknown, not assumed unsupported.",
    );
  });

  it("flags Eco mode as an active restriction on setpoint commands, per SDM's documented behavior", () => {
    const capabilities = computeNestDeviceCapabilities({
      "sdm.devices.traits.ThermostatMode": {
        mode: "HEAT",
        availableModes: ["HEAT", "OFF"],
      },
      "sdm.devices.traits.ThermostatEco": { mode: "MANUAL_ECO" },
    });

    expect(capabilities.hasEcoTrait).toBe(true);
    expect(capabilities.ecoModeActive).toBe(true);
    expect(capabilities.restrictions).toContain(
      "Eco mode is currently active — per Google's SDM API, temperature setpoint commands are rejected while Eco mode is on.",
    );
  });

  it("does not flag Eco as active when the trait is present but off", () => {
    const capabilities = computeNestDeviceCapabilities({
      "sdm.devices.traits.ThermostatEco": { mode: "OFF" },
    });

    expect(capabilities.hasEcoTrait).toBe(true);
    expect(capabilities.ecoModeActive).toBe(false);
  });

  it("reports fan trait presence independently of thermostat mode data", () => {
    const withFan = computeNestDeviceCapabilities({
      "sdm.devices.traits.Fan": { timerMode: "OFF" },
    });
    const withoutFan = computeNestDeviceCapabilities({});

    expect(withFan.hasFanTrait).toBe(true);
    expect(withoutFan.hasFanTrait).toBe(false);
  });
});

describe("NestClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    mockRequest.mockReset();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("declares sync + webhook capabilities for the NEST provider", () => {
    const client = new NestClient(credentials);

    expect(client.provider).toBe("NEST");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("listDevices() exchanges the refresh token for an access token, then calls the SDM devices endpoint with it", async () => {
    const tokenFetch = mockTokenFetch();
    global.fetch = tokenFetch as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({
      devices: [
        {
          name: "enterprises/proj/devices/d1",
          type: "sdm.devices.types.THERMOSTAT",
          traits: {},
        },
      ],
    });

    const client = new NestClient(credentials);
    const devices = await client.listDevices();

    expect(tokenFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices",
      { headers: { Authorization: "Bearer test-access-token" } },
    );
    expect(devices).toHaveLength(1);
    expect(devices[0]!.externalDeviceId).toBe("d1");
  });

  it("reuses a cached access token across calls instead of refreshing every time", async () => {
    const tokenFetch = mockTokenFetch();
    global.fetch = tokenFetch as unknown as typeof fetch;
    mockRequest.mockResolvedValue({ devices: [] });

    const client = new NestClient(credentials);
    await client.listDevices();
    await client.listDevices();

    expect(tokenFetch).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clear error when the OAuth token refresh itself fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    const client = new NestClient(credentials);

    await expect(client.listDevices()).rejects.toThrow(
      /token refresh failed with 401/,
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  describe("OAuth failure diagnostic (NestOAuthRefreshError)", () => {
    function mockFailedTokenFetch(
      status: number,
      body?: unknown,
    ): ReturnType<typeof vi.fn> {
      return vi.fn().mockResolvedValue({
        ok: false,
        status,
        json:
          body === undefined
            ? async () => {
                throw new Error("Unexpected token < in JSON");
              }
            : async () => body,
      });
    }

    it("captures a real invalid_grant response correctly, and never calls the device API afterward", async () => {
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }) as unknown as typeof fetch;

      const client = new NestClient(credentials);
      const error = await client.listDevices().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NestOAuthRefreshError);
      const diag = (error as NestOAuthRefreshError).diagnostic;
      expect(diag.httpStatus).toBe(400);
      expect(diag.oauthError).toBe("invalid_grant");
      expect(diag.oauthErrorDescription).toBe(
        "Token has been expired or revoked.",
      );
      expect(diag.clientIdPresent).toBe(true);
      expect(diag.clientSecretPresent).toBe(true);
      expect(diag.refreshTokenPresent).toBe(true);
      expect(diag.clientIdHasWhitespace).toBe(false);
      expect(diag.clientSecretHasWhitespace).toBe(false);
      expect(diag.refreshTokenHasWhitespace).toBe(false);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("never crashes on a malformed/non-JSON Google response — falls back to null error fields instead of throwing out of the diagnostic handler", async () => {
      global.fetch = mockFailedTokenFetch(500) as unknown as typeof fetch;

      const client = new NestClient(credentials);
      const error = await client.listDevices().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NestOAuthRefreshError);
      const diag = (error as NestOAuthRefreshError).diagnostic;
      expect(diag.httpStatus).toBe(500);
      expect(diag.oauthError).toBeNull();
      expect(diag.oauthErrorDescription).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("never leaks unexpected/extra fields from Google's response — only the two named OAuth fields are ever extracted", async () => {
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
        // A hypothetical, real-world-implausible but defensively-tested
        // case: Google's response body echoes something token/secret-shaped
        // under a field name this code doesn't expect.
        access_token: "should-never-appear-anywhere",
        client_secret: "should-never-appear-anywhere-either",
      }) as unknown as typeof fetch;

      const client = new NestClient(credentials);
      const error = await client.listDevices().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NestOAuthRefreshError);
      const diag = (error as NestOAuthRefreshError).diagnostic;
      expect(Object.keys(diag).sort()).toEqual(
        [
          "clientIdHasWhitespace",
          "clientIdPresent",
          "clientSecretHasWhitespace",
          "clientSecretPresent",
          "httpStatus",
          "oauthError",
          "oauthErrorDescription",
          "refreshTokenHasWhitespace",
          "refreshTokenPresent",
        ].sort(),
      );
      expect(JSON.stringify(diag)).not.toContain("should-never-appear");
      expect((error as Error).message).not.toContain("should-never-appear");
    });

    it("SECRET-SAFETY: the real refresh token, client secret, and client ID values never appear anywhere in the thrown error — message or diagnostic", async () => {
      const realCredentials = {
        clientId: "real-client-id-value-12345",
        clientSecret: "real-client-secret-value-67890",
        projectId: "test-project-id",
        refreshToken: "real-refresh-token-value-abcdef",
      };
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }) as unknown as typeof fetch;

      const client = new NestClient(realCredentials);
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      const serialized = JSON.stringify({
        message: error.message,
        diagnostic: error.diagnostic,
        name: error.name,
      });
      for (const secretValue of [
        realCredentials.clientId,
        realCredentials.clientSecret,
        realCredentials.refreshToken,
      ]) {
        expect(serialized).not.toContain(secretValue);
      }
    });

    it("reports presence=false for an empty-string credential, without ever including the (empty) value itself", async () => {
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
      }) as unknown as typeof fetch;

      const client = new NestClient({
        ...credentials,
        clientSecret: "",
      });
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.clientSecretPresent).toBe(false);
    });

    it("reports whitespace=true for a credential with leading/trailing whitespace, without including the value", async () => {
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
      }) as unknown as typeof fetch;

      const client = new NestClient({
        ...credentials,
        refreshToken: " test-refresh-token ",
      });
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.refreshTokenHasWhitespace).toBe(true);
      expect(error.diagnostic.refreshTokenPresent).toBe(true);
      expect(JSON.stringify(error.diagnostic)).not.toContain(
        "test-refresh-token",
      );
    });

    it("SANITIZATION: redacts oauthErrorDescription entirely if it happens to contain the actual configured refresh token value", async () => {
      const realCredentials = {
        ...credentials,
        refreshToken: "sensitive-refresh-token-xyz",
      };
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
        error_description:
          "The refresh token sensitive-refresh-token-xyz is invalid.",
      }) as unknown as typeof fetch;

      const client = new NestClient(realCredentials);
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.oauthErrorDescription).toBe(
        "[redacted — response text unexpectedly matched a configured credential value]",
      );
      expect(error.diagnostic.oauthErrorDescription).not.toContain(
        "sensitive-refresh-token-xyz",
      );
    });

    it("SANITIZATION: redacts oauthErrorDescription entirely if it happens to contain the actual configured client secret value", async () => {
      const realCredentials = {
        ...credentials,
        clientSecret: "sensitive-client-secret-abc",
      };
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_client",
        error_description: "sensitive-client-secret-abc mismatch",
      }) as unknown as typeof fetch;

      const client = new NestClient(realCredentials);
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.oauthErrorDescription).toBe(
        "[redacted — response text unexpectedly matched a configured credential value]",
      );
    });

    it("SANITIZATION: truncates an oversized oauthErrorDescription to 200 characters plus an ellipsis, never logging it in full", async () => {
      const hugeDescription = "x".repeat(5000);
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_request",
        error_description: hugeDescription,
      }) as unknown as typeof fetch;

      const client = new NestClient(credentials);
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.oauthErrorDescription).toHaveLength(201); // 200 chars + "…"
      expect(error.diagnostic.oauthErrorDescription).toBe(
        `${"x".repeat(200)}…`,
      );
    });

    it("SANITIZATION: passes through a normal, short, credential-free description unchanged", async () => {
      global.fetch = mockFailedTokenFetch(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }) as unknown as typeof fetch;

      const client = new NestClient(credentials);
      const error = (await client
        .listDevices()
        .catch((e: unknown) => e)) as NestOAuthRefreshError;

      expect(error.diagnostic.oauthErrorDescription).toBe(
        "Token has been expired or revoked.",
      );
    });

    it("a successful token refresh is completely unaffected by this diagnostic path — same behavior as before", async () => {
      const tokenFetch = mockTokenFetch();
      global.fetch = tokenFetch as unknown as typeof fetch;
      mockRequest.mockResolvedValueOnce({ devices: [] });

      const client = new NestClient(credentials);
      const devices = await client.listDevices();

      expect(devices).toEqual([]);
      expect(tokenFetch).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  it("validateCredentials() returns invalid with a reason when the request fails", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 403"));

    const client = new NestClient(credentials);
    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "Request failed with 403" });
  });

  it("healthCheck() returns unhealthy with details when the request fails", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockRejectedValueOnce(new Error("timeout"));

    const client = new NestClient(credentials);
    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details).toBe("timeout");
  });

  it("sync(INBOUND) fetches devices and reports the count processed, without writing anywhere", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({
      devices: [
        {
          name: "enterprises/proj/devices/d1",
          type: "sdm.devices.types.THERMOSTAT",
          traits: {},
        },
        {
          name: "enterprises/proj/devices/d2",
          type: "sdm.devices.types.THERMOSTAT",
          traits: {},
        },
      ],
    });

    const client = new NestClient(credentials);
    const result = await client.sync("INBOUND");

    expect(result).toEqual({ recordsProcessed: 2, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — Nest is the system of record for its own device state", async () => {
    const client = new NestClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() still throws NotImplementedError — payload shape is an open design question", async () => {
    const client = new NestClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(/NEST/i);
  });

  it("setHeatSetpoint() calls the documented SetHeat command with the right device/params", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setHeatSetpoint("device-1", 21);

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat",
          params: { heatCelsius: 21 },
        }),
      }),
    );
  });

  it("setCoolSetpoint() calls the documented SetCool command", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setCoolSetpoint("device-1", 24);

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        body: JSON.stringify({
          command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
          params: { coolCelsius: 24 },
        }),
      }),
    );
  });

  it("setHeatCoolRange() calls the documented SetRange command with both values", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setHeatCoolRange("device-1", 19, 25);

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        body: JSON.stringify({
          command:
            "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange",
          params: { heatCelsius: 19, coolCelsius: 25 },
        }),
      }),
    );
  });

  it("setThermostatMode() calls the documented SetMode command", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setThermostatMode("device-1", "HEATCOOL");

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        body: JSON.stringify({
          command: "sdm.devices.commands.ThermostatMode.SetMode",
          params: { mode: "HEATCOOL" },
        }),
      }),
    );
  });

  it("setFanTimer() calls the documented SetTimer command, converting seconds to the SDM duration string", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setFanTimer("device-1", "ON", 900);

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        body: JSON.stringify({
          command: "sdm.devices.commands.Fan.SetTimer",
          params: { timerMode: "ON", duration: "900s" },
        }),
      }),
    );
  });

  it("setFanTimer() caps duration at SDM's documented 12h maximum", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({});

    const client = new NestClient(credentials);
    await client.setFanTimer("device-1", "ON", 999_999);

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1:executeCommand",
      expect.objectContaining({
        body: JSON.stringify({
          command: "sdm.devices.commands.Fan.SetTimer",
          params: { timerMode: "ON", duration: "43200s" },
        }),
      }),
    );
  });

  it("getDevice() fetches a single device by id and parses it the same way listDevices() does", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockResolvedValueOnce({
      name: "enterprises/test-project-id/devices/device-1",
      type: "sdm.devices.types.THERMOSTAT",
      traits: {
        "sdm.devices.traits.Temperature": { ambientTemperatureCelsius: 22 },
      },
    });

    const client = new NestClient(credentials);
    const device = await client.getDevice("device-1");

    expect(mockRequest).toHaveBeenCalledWith(
      "/enterprises/test-project-id/devices/device-1",
      { headers: { Authorization: "Bearer test-access-token" } },
    );
    expect(device.externalDeviceId).toBe("device-1");
    expect(device.ambientTemperatureCelsius).toBe(22);
  });

  it("propagates a command failure (e.g. a real provider error) without swallowing it", async () => {
    global.fetch = mockTokenFetch() as unknown as typeof fetch;
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 400"));

    const client = new NestClient(credentials);

    await expect(client.setHeatSetpoint("device-1", 21)).rejects.toThrow(
      "Request failed with 400",
    );
  });
});

function capabilities(
  overrides: Partial<NestDeviceCapabilities> = {},
): NestDeviceCapabilities {
  return {
    supportsHeatSetpoint: false,
    supportsCoolSetpoint: false,
    supportsHeatCoolRange: false,
    availableThermostatModes: [],
    hasEcoTrait: false,
    ecoModeActive: false,
    hasFanTrait: false,
    restrictions: [],
    ...overrides,
  };
}

describe("validateNestCommand", () => {
  it("allows SET_HEAT only when the device supports a heat setpoint", () => {
    const heatCapable = capabilities({ supportsHeatSetpoint: true });
    const coolOnly = capabilities({ supportsCoolSetpoint: true });

    expect(
      validateNestCommand({ type: "SET_HEAT", heatCelsius: 20 }, heatCapable),
    ).toEqual({
      allowed: true,
    });
    const rejected = validateNestCommand(
      { type: "SET_HEAT", heatCelsius: 20 },
      coolOnly,
    );
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toMatch(/heat-setpoint/);
  });

  it("allows SET_COOL only when the device supports a cool setpoint — the real Mahalo-Upstair case", () => {
    // This mirrors a real device from the fleet: Cool/Fan only, no Heat.
    const coolFanOnly = capabilities({
      supportsCoolSetpoint: true,
      hasFanTrait: true,
      availableThermostatModes: ["COOL", "OFF"],
    });

    expect(
      validateNestCommand({ type: "SET_COOL", coolCelsius: 24 }, coolFanOnly),
    ).toEqual({ allowed: true });
    const heatRejected = validateNestCommand(
      { type: "SET_HEAT", heatCelsius: 20 },
      coolFanOnly,
    );
    expect(heatRejected.allowed).toBe(false);
    const rangeRejected = validateNestCommand(
      { type: "SET_RANGE", heatCelsius: 20, coolCelsius: 24 },
      coolFanOnly,
    );
    expect(rangeRejected.allowed).toBe(false);
  });

  it("allows SET_RANGE only when the device reports HEATCOOL range support", () => {
    const rangeCapable = capabilities({ supportsHeatCoolRange: true });
    const heatOnly = capabilities({ supportsHeatSetpoint: true });

    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: 19, coolCelsius: 25 },
        rangeCapable,
      ),
    ).toEqual({ allowed: true });
    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: 19, coolCelsius: 25 },
        heatOnly,
      ).allowed,
    ).toBe(false);
  });

  it("rejects SET_MODE for a mode the device doesn't report as available", () => {
    const heatCoolOnly = capabilities({
      availableThermostatModes: ["HEAT", "COOL", "OFF"],
    });

    const rejected = validateNestCommand(
      { type: "SET_MODE", mode: "HEATCOOL" },
      heatCoolOnly,
    );
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toMatch(/HEATCOOL/);

    expect(
      validateNestCommand({ type: "SET_MODE", mode: "HEAT" }, heatCoolOnly),
    ).toEqual({ allowed: true });
  });

  it("rejects a non-finite heat/cool value (NaN, Infinity) regardless of capability", () => {
    const fullyCapable = capabilities({
      supportsHeatSetpoint: true,
      supportsCoolSetpoint: true,
      supportsHeatCoolRange: true,
    });

    expect(
      validateNestCommand(
        { type: "SET_HEAT", heatCelsius: Number.NaN },
        fullyCapable,
      ).allowed,
    ).toBe(false);
    expect(
      validateNestCommand(
        { type: "SET_COOL", coolCelsius: Number.POSITIVE_INFINITY },
        fullyCapable,
      ).allowed,
    ).toBe(false);
    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: Number.NaN, coolCelsius: 24 },
        fullyCapable,
      ).allowed,
    ).toBe(false);
  });

  it("rejects SET_RANGE when cool does not strictly exceed heat, per Google's documented rule", () => {
    const rangeCapable = capabilities({ supportsHeatCoolRange: true });

    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: 24, coolCelsius: 20 },
        rangeCapable,
      ).allowed,
    ).toBe(false);
    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: 20, coolCelsius: 20 },
        rangeCapable,
      ).allowed,
    ).toBe(false);
    expect(
      validateNestCommand(
        { type: "SET_RANGE", heatCelsius: 19, coolCelsius: 25 },
        rangeCapable,
      ),
    ).toEqual({ allowed: true });
  });

  it("rejects SET_FAN when the device has no Fan trait at all", () => {
    const noFan = capabilities({ supportsHeatSetpoint: true });
    const withFan = capabilities({ hasFanTrait: true });

    expect(
      validateNestCommand({ type: "SET_FAN", timerMode: "ON" }, noFan).allowed,
    ).toBe(false);
    expect(
      validateNestCommand({ type: "SET_FAN", timerMode: "ON" }, withFan),
    ).toEqual({ allowed: true });
  });

  it("rejects every setpoint command while Eco mode is active, even on an otherwise fully-capable device", () => {
    const ecoActive = capabilities({
      supportsHeatSetpoint: true,
      supportsCoolSetpoint: true,
      supportsHeatCoolRange: true,
      ecoModeActive: true,
    });

    for (const command of [
      { type: "SET_HEAT" as const, heatCelsius: 20 },
      { type: "SET_COOL" as const, coolCelsius: 24 },
      { type: "SET_RANGE" as const, heatCelsius: 20, coolCelsius: 24 },
    ]) {
      const result = validateNestCommand(command, ecoActive);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Eco mode/);
    }
  });

  it("does NOT block mode changes or fan control while Eco mode is active — only setpoint commands are Eco-blocked per SDM docs", () => {
    const ecoActive = capabilities({
      availableThermostatModes: ["HEAT", "OFF"],
      hasFanTrait: true,
      ecoModeActive: true,
    });

    expect(
      validateNestCommand({ type: "SET_MODE", mode: "OFF" }, ecoActive),
    ).toEqual({ allowed: true });
    expect(
      validateNestCommand({ type: "SET_FAN", timerMode: "OFF" }, ecoActive),
    ).toEqual({ allowed: true });
  });
});

describe("getSupportedNestControls", () => {
  it("mirrors validateNestCommand's rules exactly for the real Cool/Fan-only device", () => {
    const coolFanOnly = capabilities({
      supportsCoolSetpoint: true,
      hasFanTrait: true,
      availableThermostatModes: ["COOL", "OFF"],
    });

    const availability = getSupportedNestControls(coolFanOnly);

    expect(availability).toEqual({
      canSetHeat: false,
      canSetCool: true,
      canSetRange: false,
      availableModes: ["COOL", "OFF"],
      canUseFan: true,
      blockedByEco: false,
    });
  });

  it("hides setpoint controls but keeps mode/fan visible while Eco is active", () => {
    const ecoActive = capabilities({
      supportsHeatSetpoint: true,
      supportsCoolSetpoint: true,
      availableThermostatModes: ["HEAT", "COOL", "OFF"],
      hasFanTrait: true,
      ecoModeActive: true,
    });

    const availability = getSupportedNestControls(ecoActive);

    expect(availability.canSetHeat).toBe(false);
    expect(availability.canSetCool).toBe(false);
    expect(availability.blockedByEco).toBe(true);
    expect(availability.availableModes).toEqual(["HEAT", "COOL", "OFF"]);
    expect(availability.canUseFan).toBe(true);
  });
});

describe("executeNestThermostatCommand", () => {
  it("dispatches each command type to the matching client method with the right arguments", async () => {
    const client = {
      setHeatSetpoint: vi.fn(),
      setCoolSetpoint: vi.fn(),
      setHeatCoolRange: vi.fn(),
      setThermostatMode: vi.fn(),
      setFanTimer: vi.fn(),
    };

    await executeNestThermostatCommand(client, "device-1", {
      type: "SET_HEAT",
      heatCelsius: 20,
    });
    expect(client.setHeatSetpoint).toHaveBeenCalledWith("device-1", 20);

    await executeNestThermostatCommand(client, "device-1", {
      type: "SET_COOL",
      coolCelsius: 24,
    });
    expect(client.setCoolSetpoint).toHaveBeenCalledWith("device-1", 24);

    await executeNestThermostatCommand(client, "device-1", {
      type: "SET_RANGE",
      heatCelsius: 19,
      coolCelsius: 25,
    });
    expect(client.setHeatCoolRange).toHaveBeenCalledWith("device-1", 19, 25);

    await executeNestThermostatCommand(client, "device-1", {
      type: "SET_MODE",
      mode: "OFF",
    });
    expect(client.setThermostatMode).toHaveBeenCalledWith("device-1", "OFF");

    await executeNestThermostatCommand(client, "device-1", {
      type: "SET_FAN",
      timerMode: "ON",
      durationSeconds: 600,
    });
    expect(client.setFanTimer).toHaveBeenCalledWith("device-1", "ON", 600);
  });
});
