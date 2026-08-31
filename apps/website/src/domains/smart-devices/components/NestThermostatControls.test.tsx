// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same reason as DiscoverDevicesButton.test.tsx: jsdom cannot emulate the
// real click-to-submit/requestSubmit() path React's <form action={fn}>
// (useActionState) interception relies on. This component calls
// useActionState 5 times (one per command form) — mocked by matching on
// which real action reference was passed in, not by call order, so
// reordering the hooks in the component would still route each test's
// state to the right form.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

const {
  mockSetNestHeatSetpointAction,
  mockSetNestCoolSetpointAction,
  mockSetNestHeatCoolRangeAction,
  mockSetNestModeAction,
  mockSetNestFanAction,
} = vi.hoisted(() => ({
  mockSetNestHeatSetpointAction: vi.fn(),
  mockSetNestCoolSetpointAction: vi.fn(),
  mockSetNestHeatCoolRangeAction: vi.fn(),
  mockSetNestModeAction: vi.fn(),
  mockSetNestFanAction: vi.fn(),
}));
vi.mock("../actions", () => ({
  setNestHeatSetpointAction: mockSetNestHeatSetpointAction,
  setNestCoolSetpointAction: mockSetNestCoolSetpointAction,
  setNestHeatCoolRangeAction: mockSetNestHeatCoolRangeAction,
  setNestModeAction: mockSetNestModeAction,
  setNestFanAction: mockSetNestFanAction,
}));

import { NestThermostatControls } from "./NestThermostatControls";

afterEach(cleanup);

type ActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "rejected"; reason: string }
  | { status: "already_running" }
  | { status: "failure"; reason: string };

function mockActionStates(
  overrides: Partial<{
    heat: [ActionState, boolean];
    cool: [ActionState, boolean];
    range: [ActionState, boolean];
    mode: [ActionState, boolean];
    fan: [ActionState, boolean];
  }> = {},
) {
  const idle: [ActionState, boolean] = [{ status: "idle" }, false];
  const map = new Map<unknown, [ActionState, boolean]>([
    [mockSetNestHeatSetpointAction, overrides.heat ?? idle],
    [mockSetNestCoolSetpointAction, overrides.cool ?? idle],
    [mockSetNestHeatCoolRangeAction, overrides.range ?? idle],
    [mockSetNestModeAction, overrides.mode ?? idle],
    [mockSetNestFanAction, overrides.fan ?? idle],
  ]);
  mockUseActionState.mockImplementation((action: unknown) => {
    const [state, pending] = map.get(action) ?? idle;
    return [state, vi.fn(), pending];
  });
}

// Real trait shapes, exercising the actual computeNestDeviceCapabilities/
// getSupportedNestControls logic end-to-end rather than faking their output.
const HEAT_COOL_TRAITS = {
  "sdm.devices.traits.ThermostatMode": {
    mode: "HEAT",
    availableModes: ["HEAT", "COOL"],
  },
};
const HEATCOOL_RANGE_TRAITS = {
  "sdm.devices.traits.ThermostatMode": {
    mode: "HEATCOOL",
    availableModes: ["HEATCOOL"],
  },
};
const WITH_FAN_TRAITS = {
  ...HEAT_COOL_TRAITS,
  "sdm.devices.traits.Fan": { timerMode: "OFF" },
};
const ECO_ACTIVE_TRAITS = {
  ...HEAT_COOL_TRAITS,
  "sdm.devices.traits.ThermostatEco": { mode: "MANUAL_ECO" },
};
const NO_MODE_TRAITS = {};

describe("NestThermostatControls", () => {
  it("renders 'No verified controls available' when the device reports no capabilities at all", () => {
    mockActionStates();
    render(
      <NestThermostatControls smartDeviceId="d1" rawTraits={NO_MODE_TRAITS} />,
    );

    expect(
      screen.getByText("No verified controls available for this device yet."),
    ).toBeTruthy();
  });

  it("renders Heat and Cool as two independent forms, never merged into one submission", () => {
    mockActionStates();
    const { container } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );

    // getByPlaceholderText has no `selector` filter option — both inputs
    // share the literal placeholder "°F", so a direct attribute query is
    // the unambiguous way to grab each one specifically.
    const heatInput = container.querySelector('input[name="heatFahrenheit"]');
    const coolInput = container.querySelector('input[name="coolFahrenheit"]');
    expect(heatInput).toBeTruthy();
    expect(coolInput).toBeTruthy();
    expect(heatInput!.closest("form")).not.toBe(coolInput!.closest("form"));
    // Mode + Heat + Cool all render for this fixture (availableModes: ["HEAT", "COOL"]).
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(3);
  });

  it("renders one combined Range form (shared heat+cool inputs, one submission) alongside the independent Mode/Heat/Cool forms when the device reports HEATCOOL", () => {
    mockActionStates();
    const { container } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEATCOOL_RANGE_TRAITS}
      />,
    );

    // A HEATCOOL-capable device legitimately satisfies supportsHeatSetpoint,
    // supportsCoolSetpoint, AND supportsHeatCoolRange simultaneously (see
    // computeNestDeviceCapabilities) — so Mode, Heat, Cool, and Range all
    // render together here. This test only asserts the Range form's own
    // two inputs are still one shared submission, not that Range excludes
    // the standalone Heat/Cool forms.
    const rangeHeat = container.querySelector(
      'input[placeholder="Heat"][name="heatFahrenheit"]',
    );
    const rangeCool = container.querySelector(
      'input[placeholder="Cool"][name="coolFahrenheit"]',
    );
    expect(rangeHeat).toBeTruthy();
    expect(rangeCool).toBeTruthy();
    expect(rangeHeat!.closest("form")).toBe(rangeCool!.closest("form"));
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(4);
  });

  it("renders the Fan control only when the device reports a Fan trait", () => {
    mockActionStates();
    const { unmount } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );
    expect(screen.queryByText("Fan")).toBeNull();
    unmount();

    render(
      <NestThermostatControls smartDeviceId="d1" rawTraits={WITH_FAN_TRAITS} />,
    );
    expect(screen.getByText("Fan")).toBeTruthy();
  });

  it("shows the Eco-mode warning and disables Heat/Cool commands when Eco mode is active", () => {
    mockActionStates();
    const { container } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={ECO_ACTIVE_TRAITS}
      />,
    );

    expect(screen.getByText(/Eco mode is active/)).toBeTruthy();
    expect(container.querySelector('input[name="heatFahrenheit"]')).toBeNull();
  });

  it("shows 'Setting…' and disables the button while a command is pending", () => {
    mockActionStates({ heat: [{ status: "idle" }, true] });
    render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );

    const button = screen.getByRole("button", { name: "Setting…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a success/rejected/failure/already_running result message per form independently", () => {
    mockActionStates({
      heat: [{ status: "success" }, false],
      cool: [{ status: "rejected", reason: "Not supported." }, false],
    });
    render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );

    expect(screen.getByText("Command sent.")).toBeTruthy();
    expect(screen.getByText("Not supported.")).toBeTruthy();
  });

  it("shows the pre-formatted current/target/mode/humidity summary line when provided, and omits it when not", () => {
    mockActionStates();
    const { unmount } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
        currentTemperatureLabel="72°"
        targetTemperatureLabel="70°"
        modeLabel="HEAT"
        humidityLabel="48%"
      />,
    );
    expect(
      screen.getByText("Current 72° · Target 70° · Mode HEAT · Humidity 48%"),
    ).toBeTruthy();
    unmount();

    render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );
    expect(screen.queryByText(/Current/)).toBeNull();
  });

  it("renders a Close button that calls onClose when provided, and renders no Close button when omitted", () => {
    mockActionStates();
    const onClose = vi.fn();
    const { unmount } = render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close controls" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <NestThermostatControls
        smartDeviceId="d1"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );
    expect(screen.queryByRole("button", { name: "Close controls" })).toBeNull();
  });

  it("passes the real smartDeviceId through as each form's hidden field", () => {
    mockActionStates();
    render(
      <NestThermostatControls
        smartDeviceId="device-xyz"
        rawTraits={HEAT_COOL_TRAITS}
      />,
    );

    const hiddenInputs = document.querySelectorAll(
      'input[name="smartDeviceId"]',
    );
    expect(hiddenInputs.length).toBeGreaterThan(0);
    for (const input of hiddenInputs) {
      expect((input as HTMLInputElement).value).toBe("device-xyz");
    }
  });
});
