import { describe, expect, it, vi } from "vitest";

const {
  mockRevalidatePath,
  mockDiscoverNestDevices,
  mockDiscoverAugustDevices,
} = vi.hoisted(() => ({
  mockRevalidatePath: vi.fn(),
  mockDiscoverNestDevices: vi.fn(),
  mockDiscoverAugustDevices: vi.fn(),
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

import {
  discoverAugustDevicesAction,
  discoverNestDevicesAction,
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

    expect(result).toEqual({ status: "success", discovered: 43 });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/integrations/devices");
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
