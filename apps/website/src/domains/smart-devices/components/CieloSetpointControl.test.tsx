// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CieloSetpointControl, cieloInputBounds } from "./CieloSetpointControl";

afterEach(cleanup);

const renderControl = (action = vi.fn(), currentTargetF: number | null = 72) =>
  render(
    <CieloSetpointControl
      smartDeviceId="11111111-1111-4111-8111-111111111111"
      propertyName="Island Tides"
      deviceName="Island Tides - Man cave"
      currentTargetF={currentTargetF}
      action={action}
    />,
  );

const input = () =>
  screen.getByLabelText(
    /New setpoint for Island Tides - Man cave/,
  ) as HTMLInputElement;
const setButton = () => screen.getByRole("button", { name: /Set temperature/ });

describe("cieloInputBounds", () => {
  it("±5°F around the current setpoint, clamped to 60–85", () => {
    expect(cieloInputBounds(72)).toEqual({ min: 67, max: 77 });
    expect(cieloInputBounds(62)).toEqual({ min: 60, max: 67 });
    expect(cieloInputBounds(84)).toEqual({ min: 79, max: 85 });
    expect(cieloInputBounds(null)).toEqual({ min: 60, max: 85 });
  });
});

describe("CieloSetpointControl", () => {
  it("disables the button for the current value and out-of-range values", () => {
    renderControl();
    expect((setButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "78" } });
    expect((setButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "73.5" } });
    expect((setButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "74" } });
    expect((setButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("the first click only opens a confirmation naming the property, device and exact change — nothing is sent", () => {
    const action = vi.fn();
    renderControl(action);
    fireEvent.change(input(), { target: { value: "74" } });
    fireEvent.click(setButton());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("Island Tides - Man cave");
    expect(dialog.textContent).toContain("Island Tides");
    expect(dialog.textContent).toContain("72°F → 74°F");
    expect(dialog.textContent).toContain(
      "Nothing else (power, mode, fan) is changed.",
    );
    expect(
      screen.getByRole("button", { name: "Confirm and send" }),
    ).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("the confirm form carries only the device id and the chosen target", () => {
    renderControl();
    fireEvent.change(input(), { target: { value: "70" } });
    fireEvent.click(setButton());
    const form = document.querySelector("dialog form")!;
    const fields = Object.fromEntries(
      new FormData(form as HTMLFormElement).entries(),
    );
    expect(fields).toEqual({
      smartDeviceId: "11111111-1111-4111-8111-111111111111",
      targetTemperatureF: "70",
    });
  });
});
