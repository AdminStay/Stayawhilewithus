import { describe, expect, it, vi } from "vitest";

const {
  mockRevalidatePath,
  mockDiscoverNestDevices,
  mockDiscoverAugustDevices,
  mockRefreshThermostats,
  mockLogThermostatRefresh,
} = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
  mockDiscoverNestDevices: vi.fn(),
  mockDiscoverAugustDevices: vi.fn(),
  mockRefreshThermostats: vi.fn(),
  mockLogThermostatRefresh: vi.fn(),
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
  mapProviderDeviceToProperty: vi.fn(),
  setProviderDeviceEnabled: vi.fn(),
  unmapProviderDevice: vi.fn(),
}));

vi.mock("./services/nest-commands.service", () => ({
  sendNestThermostatCommand: vi.fn(),
}));

vi.mock("./services/thermostat-refresh.service", () => ({
  refreshThermostats: mockRefreshThermostats,
  logThermostatRefresh: mockLogThermostatRefresh,
}));

import {
  discoverAugustDevicesAction,
  discoverNestDevicesAction,
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
