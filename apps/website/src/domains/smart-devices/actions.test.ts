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
  mockSendAugustLockCommand,
  mockRefreshThermostats,
  mockLogThermostatRefresh,
  mockRefreshAugustTelemetry,
  mockLogLockRefresh,
  mockRefreshAugustTelemetryForSelectedLocks,
  mockLogLockSpotRefresh,
} = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
  mockDiscoverNestDevices: vi.fn(),
  mockDiscoverAugustDevices: vi.fn(),
  mockMapProviderDeviceToProperty: vi.fn(),
  mockSetProviderDeviceEnabled: vi.fn(),
  mockUnmapProviderDevice: vi.fn(),
  mockSendNestThermostatCommand: vi.fn(),
  mockSendAugustLockCommand: vi.fn(),
  mockRefreshThermostats: vi.fn(),
  mockLogThermostatRefresh: vi.fn(),
  mockRefreshAugustTelemetry: vi.fn(),
  mockLogLockRefresh: vi.fn(),
  mockRefreshAugustTelemetryForSelectedLocks: vi.fn(),
  mockLogLockSpotRefresh: vi.fn(),
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

vi.mock("./services/august-commands.service", () => ({
  sendAugustLockCommand: mockSendAugustLockCommand,
}));

vi.mock("./services/thermostat-refresh.service", () => ({
  refreshThermostats: mockRefreshThermostats,
  logThermostatRefresh: mockLogThermostatRefresh,
}));

vi.mock("./services/lock-refresh.service", () => ({
  refreshAugustTelemetry: mockRefreshAugustTelemetry,
  logLockRefresh: mockLogLockRefresh,
}));

vi.mock("./services/lock-spot-refresh.service", () => ({
  refreshAugustTelemetryForSelectedLocks:
    mockRefreshAugustTelemetryForSelectedLocks,
  logLockSpotRefresh: mockLogLockSpotRefresh,
}));

import {
  discoverAugustDevicesAction,
  discoverNestDevicesAction,
  refreshAugustAction,
  refreshAugustTelemetryBatchAction,
  refreshAugustTelemetrySpotAction,
  refreshThermostatsAction,
  sendAugustLockCommandAction,
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

describe("sendAugustLockCommandAction", () => {
  const IDLE_COMMAND = { status: "idle" as const };
  const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";

  it("parses smartDeviceId/operation from FormData and delegates to sendAugustLockCommand, revalidating /locks on success", async () => {
    mockSendAugustLockCommand.mockResolvedValueOnce({
      status: "success",
      lockState: "locked",
    });
    const formData = new FormData();
    formData.set("smartDeviceId", SMART_DEVICE_ID);
    formData.set("operation", "LOCK");

    const result = await sendAugustLockCommandAction(IDLE_COMMAND, formData);

    expect(mockSendAugustLockCommand).toHaveBeenCalledWith(
      { userId: "user-1" },
      { smartDeviceId: SMART_DEVICE_ID, operation: "LOCK" },
    );
    expect(result).toEqual({ status: "success", lockState: "locked" });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("does not revalidate on a rejected/failed result — never implies success", async () => {
    mockSendAugustLockCommand.mockResolvedValueOnce({
      status: "rejected",
      reason: "This device is not enabled for control.",
    });
    const formData = new FormData();
    formData.set("smartDeviceId", SMART_DEVICE_ID);
    formData.set("operation", "UNLOCK");

    const result = await sendAugustLockCommandAction(IDLE_COMMAND, formData);

    expect(result.status).toBe("rejected");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an operation value outside LOCK/UNLOCK/UNLATCH before ever calling the service — no fuzzy/derived targeting", async () => {
    const formData = new FormData();
    formData.set("smartDeviceId", SMART_DEVICE_ID);
    formData.set("operation", "OPEN_SESAME");

    await expect(
      sendAugustLockCommandAction(IDLE_COMMAND, formData),
    ).rejects.toThrow();
    expect(mockSendAugustLockCommand).not.toHaveBeenCalled();
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

describe("refreshAugustTelemetrySpotAction", () => {
  const IDLE_SPOT = { status: "idle" as const };
  const REAL_ROW_ID = "11111111-1111-1111-1111-111111111111";

  function formDataFor(smartDeviceId: string): FormData {
    const fd = new FormData();
    fd.set("smartDeviceId", smartDeviceId);
    return fd;
  }

  it("a real row submission with only smartDeviceId passes action validation and calls the service with exactly [smartDeviceId] — proves the FormData shape (one id) matches what the schema/service actually expect (an array)", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: REAL_ROW_ID, result: "success" },
    ]);

    const result = await refreshAugustTelemetrySpotAction(
      IDLE_SPOT,
      formDataFor(REAL_ROW_ID),
    );

    expect(mockRefreshAugustTelemetryForSelectedLocks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      { smartDeviceIds: [REAL_ROW_ID] },
    );
    expect(result).toEqual({
      status: "success",
      outcome: { smartDeviceId: REAL_ROW_ID, result: "success" },
    });
  });

  it("revalidates /locks only when the outcome is success", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: REAL_ROW_ID, result: "success" },
    ]);

    await refreshAugustTelemetrySpotAction(IDLE_SPOT, formDataFor(REAL_ROW_ID));

    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("does not revalidate on a provider_failure outcome", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      {
        smartDeviceId: REAL_ROW_ID,
        result: "provider_failure",
        error: "August API 500",
      },
    ]);

    const result = await refreshAugustTelemetrySpotAction(
      IDLE_SPOT,
      formDataFor(REAL_ROW_ID),
    );

    expect(result).toEqual({
      status: "success",
      outcome: {
        smartDeviceId: REAL_ROW_ID,
        result: "provider_failure",
        error: "August API 500",
      },
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns a top-level failure state instead of throwing on a malformed/missing id, and never calls the service", async () => {
    const fd = new FormData(); // no smartDeviceId set at all

    const result = await refreshAugustTelemetrySpotAction(IDLE_SPOT, fd);

    expect(result.status).toBe("failure");
    expect(mockRefreshAugustTelemetryForSelectedLocks).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns a top-level failure state instead of throwing when the service call fails (e.g. RBAC denial), and does not revalidate", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    const result = await refreshAugustTelemetrySpotAction(
      IDLE_SPOT,
      formDataFor(REAL_ROW_ID),
    );

    expect(result).toEqual({ status: "failure", error: "ForbiddenError" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("delegates only to refreshAugustTelemetryForSelectedLocks() — never touches discovery, mapping, enablement, the whole-fleet refresh, or Nest command functions", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: REAL_ROW_ID, result: "success" },
    ]);

    await refreshAugustTelemetrySpotAction(IDLE_SPOT, formDataFor(REAL_ROW_ID));

    expect(mockRefreshAugustTelemetryForSelectedLocks).toHaveBeenCalledTimes(1);
    expect(mockDiscoverAugustDevices).not.toHaveBeenCalled();
    expect(mockDiscoverNestDevices).not.toHaveBeenCalled();
    expect(mockMapProviderDeviceToProperty).not.toHaveBeenCalled();
    expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
    expect(mockUnmapProviderDevice).not.toHaveBeenCalled();
    expect(mockSendNestThermostatCommand).not.toHaveBeenCalled();
    expect(mockRefreshAugustTelemetry).not.toHaveBeenCalled();
  });
});

describe("refreshAugustTelemetryBatchAction", () => {
  const IDLE_BATCH = { status: "idle" as const };
  const ID_1 = "11111111-1111-1111-1111-111111111111";
  const ID_2 = "22222222-2222-2222-2222-222222222222";
  const ID_3 = "33333333-3333-3333-3333-333333333333";
  const ID_4 = "44444444-4444-4444-4444-444444444444";
  const ID_5 = "55555555-5555-5555-5555-555555555555";
  const ID_6 = "66666666-6666-6666-6666-666666666666";

  function formDataFor(ids: string[]): FormData {
    const fd = new FormData();
    for (const id of ids) fd.append("smartDeviceId", id);
    return fd;
  }

  it("accepts exactly 5 ids and calls the service with exactly that array", async () => {
    const ids = [ID_1, ID_2, ID_3, ID_4, ID_5];
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce(
      ids.map((id) => ({ smartDeviceId: id, result: "success" as const })),
    );

    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor(ids),
    );

    expect(mockRefreshAugustTelemetryForSelectedLocks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      { smartDeviceIds: ids },
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.outcomes).toHaveLength(5);
    }
  });

  it("rejects more than 5 ids — returns a failure state and never calls the service", async () => {
    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2, ID_3, ID_4, ID_5, ID_6]),
    );

    expect(result.status).toBe("failure");
    expect(mockRefreshAugustTelemetryForSelectedLocks).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID id — returns a failure state and never calls the service", async () => {
    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, "not-a-real-uuid"]),
    );

    expect(result.status).toBe("failure");
    expect(mockRefreshAugustTelemetryForSelectedLocks).not.toHaveBeenCalled();
  });

  it("rejects an empty submission — returns a failure state and never calls the service", async () => {
    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([]),
    );

    expect(result.status).toBe("failure");
    expect(mockRefreshAugustTelemetryForSelectedLocks).not.toHaveBeenCalled();
  });

  it("revalidates /locks when at least one outcome in the group is success", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      {
        smartDeviceId: ID_1,
        result: "provider_failure",
        error: "August API 500",
      },
      { smartDeviceId: ID_2, result: "success" },
    ]);

    await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2]),
    );

    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("does not revalidate when every outcome in the group is non-success", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      {
        smartDeviceId: ID_1,
        result: "provider_failure",
        error: "August API 500",
      },
      { smartDeviceId: ID_2, result: "not_found" },
    ]);

    await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2]),
    );

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("one device's provider_failure inside a group never hides another device's own success — the full per-device outcome array is returned unmodified", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: ID_1, result: "success" },
      { smartDeviceId: ID_2, result: "provider_failure", error: "timeout" },
      { smartDeviceId: ID_3, result: "success" },
    ]);

    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2, ID_3]),
    );

    expect(result).toEqual({
      status: "success",
      outcomes: [
        { smartDeviceId: ID_1, result: "success" },
        { smartDeviceId: ID_2, result: "provider_failure", error: "timeout" },
        { smartDeviceId: ID_3, result: "success" },
      ],
    });
  });

  it("a demo/wrong-provider/wrong-type id inside a group comes back invalid_selection, exactly as the underlying service already guarantees — this action does not re-check or re-interpret that decision itself", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: ID_1, result: "invalid_selection" },
      { smartDeviceId: ID_2, result: "success" },
    ]);

    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2]),
    );

    expect(result).toEqual({
      status: "success",
      outcomes: [
        { smartDeviceId: ID_1, result: "invalid_selection" },
        { smartDeviceId: ID_2, result: "success" },
      ],
    });
    // Still revalidates — ID_2's real success means /locks has fresh data,
    // even though ID_1 in the same group was rejected.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/locks");
  });

  it("returns a top-level failure state instead of throwing when the service call fails (e.g. RBAC denial or a 401 surfaced before any per-device result), and does not revalidate", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    const result = await refreshAugustTelemetryBatchAction(
      IDLE_BATCH,
      formDataFor([ID_1, ID_2]),
    );

    expect(result).toEqual({ status: "failure", error: "ForbiddenError" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("delegates only to refreshAugustTelemetryForSelectedLocks() — never touches discovery, mapping, enablement, the whole-fleet refresh, legacy sync, or Nest command functions", async () => {
    mockRefreshAugustTelemetryForSelectedLocks.mockResolvedValueOnce([
      { smartDeviceId: ID_1, result: "success" },
    ]);

    await refreshAugustTelemetryBatchAction(IDLE_BATCH, formDataFor([ID_1]));

    expect(mockRefreshAugustTelemetryForSelectedLocks).toHaveBeenCalledTimes(1);
    expect(mockDiscoverAugustDevices).not.toHaveBeenCalled();
    expect(mockDiscoverNestDevices).not.toHaveBeenCalled();
    expect(mockMapProviderDeviceToProperty).not.toHaveBeenCalled();
    expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
    expect(mockUnmapProviderDevice).not.toHaveBeenCalled();
    expect(mockSendNestThermostatCommand).not.toHaveBeenCalled();
    expect(mockRefreshAugustTelemetry).not.toHaveBeenCalled();
  });

  it("SOURCE-LEVEL GUARANTEE: refreshAugustTelemetryBatchAction's own function body never references the legacy Sync Now path, discovery, mapping, enablement, or any lock/unlock or PIN/access-code identifier, and never re-invents its own id-count check", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(__dirname, "./actions.ts"), "utf8");

    const start = source.indexOf(
      "export async function refreshAugustTelemetryBatchAction(",
    );
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start);
    // Unlike refreshAugustAction's own isolation test (which is safe using
    // only "next \nexport ", since nothing follows it in the file), this
    // function is immediately followed by refreshAugustAction's own doc
    // comment — which legitimately names syncAugustDevices in its prose to
    // explain what that other action does NOT call. A "next \nexport "-only
    // boundary would sweep that neighboring comment into this slice and
    // false-fail on prose, not code (the exact class of bug fixed elsewhere
    // in this file's history). Stopping at whichever comes first — the next
    // top-level export or the next doc comment — isolates just this
    // function's own body; this function's own inline comments are all `//`
    // (never `/**`), so this never truncates its own body early.
    const nextExportOffset = rest.indexOf("\nexport ", 1);
    const nextDocCommentOffset = rest.indexOf("\n/**", 1);
    const boundaryCandidates = [nextExportOffset, nextDocCommentOffset].filter(
      (offset) => offset !== -1,
    );
    const boundary =
      boundaryCandidates.length > 0 ? Math.min(...boundaryCandidates) : -1;
    const body = boundary === -1 ? rest : rest.slice(0, boundary);

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
      // The max-5 check belongs to refreshAugustBatchSchema alone — this
      // action must not duplicate it with its own length/slice guard.
      ".length > 5",
      ".slice(0, 5)",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
