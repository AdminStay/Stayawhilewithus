// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThermostatControlKillSwitch } from "./ThermostatControlKillSwitch";

afterEach(cleanup);

describe("ThermostatControlKillSwitch (2026-09-27, Nest Phase 1)", () => {
  it("OFF: tells everyone no Nest command can be sent", () => {
    render(<ThermostatControlKillSwitch enabled={false} canToggle={false} />);
    expect(
      screen.getByText(/Remote Nest thermostat control is OFF/),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("only an admin (canToggle + action) gets the toggle; from OFF it submits enabled=true", () => {
    render(
      <ThermostatControlKillSwitch
        enabled={false}
        canToggle
        action={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Turn on remote control",
    });
    expect(button).toBeTruthy();
    expect(
      (document.querySelector('input[name="enabled"]') as HTMLInputElement)
        .value,
    ).toBe("true");
  });

  it("ON: states that admins can send commands and offers turning it off", () => {
    render(<ThermostatControlKillSwitch enabled canToggle action={vi.fn()} />);
    expect(
      screen.getByText(/Remote Nest thermostat control is ON/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Turn off remote control" }),
    ).toBeTruthy();
  });
});
