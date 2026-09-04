import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const {
  mockRevalidatePath,
  mockDiscoverNestDevices,
  mockDiscoverAugustDevices,
  mockMapProviderDeviceToProperty,
  mockSetProviderDeviceEnabled,
  mockUnmapProviderDevice,
  mockSendNestThermostatCommand,
  mockRefreshThermostats,
  mockLogThermostatRefresh,
  mockRefreshAugustTelemetry,
  mockLogLockRefresh,
} = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
  mockDiscoverNestDevices: vi.fn(),
  mockDiscoverAugustDevices: vi.fn(),
  mockMapProviderDeviceToProperty: vi.fn(),
  mockSetProviderDeviceEnabled: vi.fn(),
  mockUnmapProviderDevice: vi.fn(),
  mockSendNestThermostatCommand: vi.fn(),
  mockRefreshThermostats: vi.fn(),
  mockLogThermostatRefresh: vi.fn(),
  mockRefreshAugustTelemetry: vi.fn(),
  mockLogLockRefresh: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("./services/provider-devices.service", () => ({
  discoverNestDevices: mockDiscoverNestDevices,
  discoverAugustDevices: mockDiscoverAugustDevices,
  mapProviderDeviceToProperty: mockMapProviderDeviceToProperty,
  setProviderDeviceEnabled: mockSetProviderDeviceEnabled,
  unmapProviderDevice: mockUnmapProviderDevice,
}));

vi.mock("./services/nest-commands.service", () => ({
  sendNestThermostatCommand: mockSendNestThermostatCommand,
}));

vi.mock("./services/thermostat-refresh.service", () => ({
  refreshThermostats: mockRefreshThermostats,
  logThermostatRefresh: mockLogThermostatRefresh,
}));

vi.mock("./services/lock-refresh.service", () => ({
  refreshAugustTelemetry: mockRefreshAugustTelemetry,
  logLockRefresh: mockLogLockRefresh,
}));

import {
  discoverAugustDevicesAction,
  discoverNestDevicesAction,
  refreshAugustAction,
  refreshThermostatsAction,
} from "./actions";

const IDLE = { status: "idle" as const };

describe("discoverNestDevicesAction", () => {
  it("returns a success state with the exact discovered count and revalidates the devices page", async () => {
    mockDiscoverNestDevices.mockResolvedValueOnce({ discovered: 4 });

    const result = await discoverNestDevicesAction(IDLE);

    expect(result).toEqual({ status: "success", discovered: 4 });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/integrations/devices");
  });

  it("returns a failure state instead of throwing when discovery fails, and does not revalidate", async () => {
    mockDiscoverNestDevices.mockRejectedValueOnce(
      new Error("Nest isn't configured yet."),
    );

    const result = await discoverNestDevicesAction(IDLE);

    expect(result).toEqual({
      status: "failure",
      error: "Nest isn't configured yet.",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("discoverAugustDevicesAction", () => {
  it("returns a success state with the exact discovered count and revalidates the devices page", async () => {
    mockDiscoverAugustDevices.mockResolvedValueOnce({ discovered: 43 });

    const result = await discoverAugustDevicesAction(IDLE);

    expect(result).toEqual({
      status: "success",
      discovered: 43,
      enriched: undefined,
      detailFailures: undefined,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/integrations/devices");
  });

  it("passes through enriched/detailFailures from the two-phase discovery result", async () => {
    mockDiscoverAugustDevices.mockResolvedValueOnce({
      discovered: 43,
      enriched: 41,
      detailFailures: 2,
    });

    const result = await discoverAugustDevicesAction(IDLE);

    expect(result).toEqual({
      status: "success",
      discovered: 43,
      enriched: 41,
      detailFailures: 2,
    });
  });

  it("returns a failure state instead of throwing when discovery fails (e.g. RBAC denial), and does not revalidate", async () => {
    mockDiscoverAugustDevices.mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    const result = await discoverAugustDevicesAction(IDLE);

    expect(result).toEqual({ status: "failure", error: "ForbiddenError" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("never lets a non-Error throw crash the action — falls back to String(err)", async () => {
    mockDiscoverAugustDevices.mockRejectedValueOnce("raw string rejection");

    const result = await discoverAugustDevicesAction(IDLE);

    expect(result).toEqual({
      status: "failure",
      error: "raw string rejection",
    });
  });
});

describe("refreshThermostatsAction", () => {
  const IDLE_REFRESH = { status: "idle" as const };

  it("returns the exact per-provider results and revalidates /thermostats on success", async () => {
    mockRefreshThermostats.mockResolvedValueOnce({
      providers: [
        {
          provider: "NEST",
          status: "success",
          refreshed: 31,
          notReturnedByProvider: 0,
        },
        {
          provider: "CIELO",
          status: "success",
          refreshed: 3,
          notReturnedByProvider: 0,
        },
      ],
      refreshedAt: "2026-09-02T00:00:00.000Z",
    });

    const result = await refreshThermostatsAction(IDLE_REFRESH);

    expect(result).toEqual({
      status: "success",
      providers: [
        {
          provider: "NEST",
          status: "success",
          refreshed: 31,
          notReturnedByProvider: 0,
        },
        {
          provider: "CIELO",
          status: "success",
          refreshed: 3,
          notReturnedByProvider: 0,
        },
      ],
      refreshedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/thermostats");
  });

  it("still returns a success state (with the partial per-provider results) when one provider failed — never loses the working provider's real result", async () => {
    mockRefreshThermostats.mockResolvedValueOnce({
      providers: [
        { provider: "NEST", status: "failure", error: "network error" },
        {
          provider: "CIELO",
          status: "success",
          refreshed: 3,
          notReturnedByProvider: 0,
        },
      ],
      refreshedAt: "2026-09-02T00:00:00.000Z",
    });

    const result = await refreshThermostatsAction(IDLE_REFRESH);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.providers).toContainEqual({
        provider: "NEST",
        status: "failure",
        error: "network error",
      });
      expect(result.providers).toContainEqual({
        provider: "CIELO",
        status: "success",
        refreshed: 3,
        notReturnedByProvider: 0,
      });
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith("/thermostats");
  });

  it("returns a top-level failure state instead of throwing when the whole refresh call fails (e.g. RBAC denial), and does not revalidate", async () => {
    mockRefreshThermostats.mockRejectedValueOnce(new Error("ForbiddenError"));

    const result = await refreshThermostatsAction(IDLE_REFRESH);

    expect(result).toEqual({ status: "failure", error: "ForbiddenError" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("never lets a non-Error throw crash the action — falls back to String(err)", async () => {
    mockRefreshThermostats.mockRejectedValueOnce("raw string rejection");

    const result = await refreshThermostatsAction(IDLE_REFRESH);

    expect(result).toEqual({
      status: "failure",
      error: "raw string rejection",
    });
  });

  it("logs action_succeeded on success", async () => {
    mockLogThermostatRefresh.mockReset();
    mockRefreshThermostats.mockResolvedValueOnce({
      providers: [],
      refreshedAt: "2026-09-02T00:00:00.000Z",
    });

    await refreshThermostatsAction(IDLE_REFRESH);

    expect(mockLogThermostatRefresh).toHaveBeenCalledWith(
      "action_succeeded",
      expect.objectContaining({ actorUserId: "user-1" }),
    );
  });

  it("logs action_failed with the same sanitized message already returned to the UI on failure", async () => {
    mockLogThermostatRefresh.mockReset();
    mockRefreshThermostats.mockRejectedValueOnce(new Error("ForbiddenError"));

    await refreshThermostatsAction(IDLE_REFRESH);

    expect(mockLogThermostatRefresh).toHaveBeenCalledWith(
      "action_failed",
      expect.objectContaining({ error: "ForbiddenError" }),
    );
  });
});

describe("refreshAugustAction", () => {
  const IDLE_REFRESH = { status: "idle" as const };

  it("returns the exact refresh counts and revalidates /locks on success", async () => {
    mockRefreshAugustTelemetry.mockResolvedValueOnce({
      refreshed: 37,
      notReturnedByProvider: 0,
    });

    const result = await refreshAugustAction(IDLE_REFRESH);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.refreshed).toBe(37);
      expect(result.notReturnedByProvider).toBe(0);
      expect(result.refreshedAt).toEqual(expect.any(String));
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("returns a partial-failure result (some devices could not be refreshed) as a success state with the real counts", async () => {
    mockRefreshAugustTelemetry.mockResolvedValueOnce({
      refreshed: 35,
      notReturnedByProvider: 2,
    });

    const result = await refreshAugustAction(IDLE_REFRESH);

    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        refreshed: 35,
        notReturnedByProvider: 2,
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("returns a zero-eligible result correctly — distinct from a failure", async () => {
    mockRefreshAugustTelemetry.mockResolvedValueOnce({
      refreshed: 0,
      notReturnedByProvider: 0,
    });

    const result = await refreshAugustAction(IDLE_REFRESH);

    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        refreshed: 0,
        notReturnedByProvider: 0,
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("returns a top-level failure state instead of throwing when refreshAugustTelemetry() fails (e.g. RBAC denial or missing August credentials), and does not revalidate", async () => {
    mockRefreshAugustTelemetry.mockRejectedValueOnce(
      new Error(
        "August isn't configured — set AUGUST_IDENTIFIER/AUGUST_INSTALL_ID/AUGUST_ACCESS_TOKEN.",
      ),
    );

    const result = await refreshAugustAction(IDLE_REFRESH);

    expect(result).toEqual({
      status: "failure",
      error:
        "August isn't configured — set AUGUST_IDENTIFIER/AUGUST_INSTALL_ID/AUGUST_ACCESS_TOKEN.",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("never lets a non-Error throw crash the action — falls back to String(err)", async () => {
    mockRefreshAugustTelemetry.mockRejectedValueOnce("raw string rejection");

    const result = await refreshAugustAction(IDLE_REFRESH);

    expect(result).toEqual({
      status: "failure",
      error: "raw string rejection",
    });
  });

  it("logs action_succeeded on success", async () => {
    mockLogLockRefresh.mockReset();
    mockRefreshAugustTelemetry.mockResolvedValueOnce({
      refreshed: 37,
      notReturnedByProvider: 0,
    });

    await refreshAugustAction(IDLE_REFRESH);

    expect(mockLogLockRefresh).toHaveBeenCalledWith(
      "action_succeeded",
      expect.objectContaining({ actorUserId: "user-1" }),
    );
  });

  it("logs action_failed with the same sanitized message already returned to the UI on failure", async () => {
    mockLogLockRefresh.mockReset();
    mockRefreshAugustTelemetry.mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await refreshAugustAction(IDLE_REFRESH);

    expect(mockLogLockRefresh).toHaveBeenCalledWith(
      "action_failed",
      expect.objectContaining({ error: "ForbiddenError" }),
    );
  });

  it("delegates only to refreshAugustTelemetry() — never touches discovery, mapping, enablement, or Nest command functions, even on a real successful run", async () => {
    mockRefreshAugustTelemetry.mockResolvedValueOnce({
      refreshed: 37,
      notReturnedByProvider: 0,
    });

    await refreshAugustAction(IDLE_REFRESH);

    expect(mockRefreshAugustTelemetry).toHaveBeenCalledTimes(1);
    expect(mockDiscoverAugustDevices).not.toHaveBeenCalled();
    expect(mockDiscoverNestDevices).not.toHaveBeenCalled();
    expect(mockMapProviderDeviceToProperty).not.toHaveBeenCalled();
    expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
    expect(mockUnmapProviderDevice).not.toHaveBeenCalled();
    expect(mockSendNestThermostatCommand).not.toHaveBeenCalled();
  });

  it("SOURCE-LEVEL GUARANTEE: refreshAugustAction's own function body never references the legacy Sync Now path, discovery, mapping, enablement, or any lock/unlock or PIN/access-code identifier", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(__dirname, "./actions.ts"), "utf8");

    // Isolates just this one action's function body — actions.ts
    // legitimately references discovery/mapping/enablement functions
    // elsewhere, for their own actions (discoverAugustDevicesAction,
    // setProviderDeviceEnabledAction, etc.), so a whole-file substring
    // check would false-fail. Slices from this action's own declaration to
    // the next top-level `export` after it.
    const start = source.indexOf("export async function refreshAugustAction(");
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start);
    const nextExportOffset = rest.indexOf("\nexport ", 1);
    const body =
      nextExportOffset === -1 ? rest : rest.slice(0, nextExportOffset);

    for (const forbidden of [
      "syncAugustDevices",
      "discoverAugustDevices",
      "discoverNestDevices",
      "mapProviderDeviceToProperty",
      "setProviderDeviceEnabled",
      "unmapProviderDevice",
      "sendNestThermostatCommand",
      "lockDevice",
      "unlockDevice",
      "accessCode",
      "PIN",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
