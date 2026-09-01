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

  /**
   * Root-cause regression test for the Production incident where clicking
   * Refresh produced no POST /thermostats at all: the button rendered
   * (visible, clickable, type="submit"), but it was previously composed
   * through PageHeader's `actions` prop — the only Server-Action-submitting
   * form in this app ever routed that way, unlike every other real,
   * Production-proven immediate-submit form (DiscoverDevicesButton,
   * SyncNowButton), which render directly in the page body. A test that
   * only checks `getByRole("button", { name: "Refresh" })` (as the two
   * tests above already did) cannot catch this class of bug — a visible,
   * correctly-labeled button that isn't actually associated with any
   * submittable form would still pass those. This test asserts the real
   * DOM-level contract browsers use to decide whether a click submits
   * anything: the button's own `type` must be "submit" (never the
   * "button" a plain click on a non-form-associated element would need),
   * and its native `.form` property (which HTMLButtonElement resolves
   * from actual DOM ancestry, not from React props) must point to a real,
   * present `<form>` element — not merely that a `<form>` exists somewhere
   * on the page.
   */
  it('renders Refresh as a real submit button that is actually DOM-associated with its own form — not merely a clickable type="button" element', async () => {
    mockHasPermission.mockResolvedValue(true);

    const jsx = await ThermostatsPage();
    const { container } = render(jsx);

    const button = screen.getByRole("button", {
      name: "Refresh",
    }) as HTMLButtonElement;
    expect(button.type).toBe("submit");
    expect(button.form).not.toBeNull();
    expect(button.closest("form")).not.toBeNull();
    expect(button.form).toBe(button.closest("form"));

    // Exactly one form on the page, and it's this one — no stray/duplicate
    // or nested form that could cause the browser to associate the button
    // with the wrong (or no) form.
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBe(1);
    expect(forms[0]).toBe(button.form);
  });
});
