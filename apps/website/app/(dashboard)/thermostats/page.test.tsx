// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHasPermission,
  mockListSmartDevices,
  mockGetControl,
  mockGetNestHealth,
  listProps,
  switchProps,
  bannerProps,
} = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  mockListSmartDevices: vi.fn(),
  mockGetControl: vi.fn(),
  mockGetNestHealth: vi.fn(),
  listProps: [] as Record<string, unknown>[],
  switchProps: [] as Record<string, unknown>[],
  bannerProps: [] as Record<string, unknown>[],
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
  setThermostatControlEnabledAction: vi.fn(),
}));

vi.mock("@/domains/smart-devices/components/ThermostatsList", () => ({
  ThermostatsList: (props: Record<string, unknown>) => {
    listProps.push(props);
    return null;
  },
}));

// Nest Phase 1 (2026-09-27): the new banners are captured, not rendered,
// so the Refresh-form regression test below still sees exactly one form.
vi.mock(
  "@/domains/smart-devices/components/ThermostatControlKillSwitch",
  () => ({
    ThermostatControlKillSwitch: (props: Record<string, unknown>) => {
      switchProps.push(props);
      return null;
    },
  }),
);
vi.mock("@/domains/smart-devices/components/NestHealthBanner", () => ({
  NestHealthBanner: (props: Record<string, unknown>) => {
    bannerProps.push(props);
    return null;
  },
}));
vi.mock(
  "@/domains/smart-devices/services/thermostat-control-settings.service",
  () => ({ getThermostatControlSetting: mockGetControl }),
);
vi.mock("@/domains/smart-devices/services/thermostat-refresh.service", () => ({
  getNestRefreshHealthRecord: mockGetNestHealth,
}));

import ThermostatsPage from "./page";

afterEach(cleanup);

beforeEach(() => {
  mockListSmartDevices.mockReset().mockResolvedValue([]);
  mockHasPermission.mockReset();
  mockGetControl.mockReset().mockResolvedValue({
    enabled: false,
    updatedAt: null,
    updatedByUserId: null,
  });
  mockGetNestHealth
    .mockReset()
    .mockResolvedValue({ lastAttempt: null, lastSucceededAt: null });
  listProps.length = 0;
  switchProps.length = 0;
  bannerProps.length = 0;
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

describe("ThermostatsPage — Nest Phase 1 safety + freshness wiring (2026-09-27)", () => {
  const HOUR = 60 * 60 * 1000;
  const nest = (id: string, readingAgoMs: number | null) => ({
    id,
    name: id,
    provider: "NEST",
    deviceType: "THERMOSTAT",
    propertyId: "p1",
    property: { name: "P" },
    metadata:
      readingAgoMs === null
        ? {}
        : {
            telemetryUpdatedAt: new Date(
              Date.now() - readingAgoMs,
            ).toISOString(),
          },
  });

  it("passes the kill switch state (default OFF) to both the switch banner and the list — admins don't get live controls", async () => {
    mockHasPermission.mockResolvedValue(true);
    render(await ThermostatsPage());

    expect(switchProps[0]).toMatchObject({ enabled: false, canToggle: true });
    expect(listProps[0]).toMatchObject({ controlEnabled: false });
    expect(mockHasPermission).toHaveBeenCalledWith(
      { userId: "user-1" },
      "thermostats:manage",
    );
  });

  it("marks each reading older than 24 h (or missing) stale per row; the banner goes by the newest Nest reading (fresh here, so ok)", async () => {
    mockHasPermission.mockResolvedValue(false);
    mockListSmartDevices.mockResolvedValue([
      nest("fresh", 2 * HOUR),
      nest("old", 17 * 24 * HOUR),
      nest("none", null),
    ]);
    render(await ThermostatsPage());

    expect(listProps[0]!.staleReadingIds).toEqual(["old", "none"]);
    expect(bannerProps[0]).toMatchObject({
      health: expect.objectContaining({ state: "ok" }),
    });
  });

  it("when every Nest reading is older than 24 h the banner says stale — before any refresh has ever been recorded", async () => {
    mockHasPermission.mockResolvedValue(false);
    mockListSmartDevices.mockResolvedValue([
      nest("a", 17 * 24 * HOUR),
      nest("b", 17 * 24 * HOUR),
    ]);
    render(await ThermostatsPage());

    expect(bannerProps[0]).toMatchObject({
      health: expect.objectContaining({ state: "stale" }),
    });
  });

  it("a recorded Google authorization failure puts the banner in needs_reauthorization", async () => {
    mockHasPermission.mockResolvedValue(false);
    mockListSmartDevices.mockResolvedValue([nest("a", 17 * 24 * HOUR)]);
    mockGetNestHealth.mockResolvedValue({
      lastAttempt: {
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        errorMessage: "NEST_AUTH_EXPIRED: Google authorization expired.",
      },
      lastSucceededAt: null,
    });
    render(await ThermostatsPage());

    expect(bannerProps[0]).toMatchObject({
      health: expect.objectContaining({ state: "needs_reauthorization" }),
    });
  });
});

describe("ThermostatsPage — obsolete [nest-diag] debug log removed (2026-09-27)", () => {
  it("rendering the page emits no [nest-diag] log line", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockListSmartDevices.mockResolvedValue([
      {
        id: "t1",
        name: "Aqua Palm - Living room",
        provider: "NEST",
        deviceType: "THERMOSTAT",
        propertyId: "p1",
        property: { name: "Aqua Palm" },
        metadata: {},
      },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      render(await ThermostatsPage());
      expect(
        log.mock.calls.some((call) => String(call[0]).includes("[nest-diag]")),
      ).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("the page source hard-codes no device name and no [nest-diag] diagnostic", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "./page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("[nest-diag]");
    expect(source).not.toContain("Aqua Palm");
  });
});
