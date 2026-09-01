// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasPermission, mockListSmartDevices } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  mockListSmartDevices: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: mockHasPermission,
}));

vi.mock("@/domains/smart-devices/services/smart-devices.service", () => ({
  listSmartDevices: mockListSmartDevices,
  isThermostatVisible: () => true,
}));

// Real refreshThermostatsAction transitively imports @stayw/database (via
// thermostat-refresh.service.ts) — mocked here purely to keep this a
// render-only test, same convention as
// app/(dashboard)/properties/ownerrez/page.test.tsx.
vi.mock("@/domains/smart-devices/actions", () => ({
  refreshThermostatsAction: vi.fn(),
}));

vi.mock("@/domains/smart-devices/components/ThermostatsList", () => ({
  ThermostatsList: () => null,
}));

import ThermostatsPage from "./page";

afterEach(cleanup);

beforeEach(() => {
  mockListSmartDevices.mockReset().mockResolvedValue([]);
  mockHasPermission.mockReset();
});

describe("ThermostatsPage — Refresh button authorization", () => {
  it("shows the Refresh button when the actor can execute smart_devices:update", async () => {
    mockHasPermission.mockResolvedValue(true);

    const jsx = await ThermostatsPage();
    render(jsx);

    expect(mockHasPermission).toHaveBeenCalledWith(
      { userId: "user-1" },
      "smart_devices:update",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("hides the Refresh button entirely for a read-only actor — never shows a button that would just fail on click", async () => {
    mockHasPermission.mockResolvedValue(false);

    const jsx = await ThermostatsPage();
    render(jsx);

    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
});
