// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AugustLockControlButton } from "./AugustLockControlButton";

afterEach(cleanup);

function renderButton(
  overrides: Partial<Parameters<typeof AugustLockControlButton>[0]> = {},
) {
  const action = vi.fn();
  render(
    <AugustLockControlButton
      smartDeviceId="lock-1"
      operation="UNLOCK"
      lockName="Front Door"
      propertyName="Bahamas"
      action={action}
      {...overrides}
    />,
  );
  return action;
}

describe("AugustLockControlButton", () => {
  it("does not submit on the trigger click alone — opens a confirmation dialog instead", () => {
    const action = renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("confirmation dialog names the exact lock and property, and the requested action", () => {
    renderButton({
      operation: "UNLOCK",
      lockName: "Bahamas - Front Door",
      propertyName: "Bahamas",
    });

    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(
      screen.getByText(/Unlock.*Bahamas - Front Door.*at Bahamas/s),
    ).toBeTruthy();
  });

  it("Cancel closes the dialog without ever submitting", () => {
    const action = renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("Confirm submits with exactly this row's smartDeviceId and the requested operation — no fuzzy/derived targeting", () => {
    const action = vi.fn().mockResolvedValue({ status: "idle" });
    render(
      <AugustLockControlButton
        smartDeviceId="lock-xyz"
        operation="LOCK"
        lockName="Side Door"
        propertyName="Camingo"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Lock" }));

    expect(action).toHaveBeenCalled();
    const submittedFormData = action.mock.calls[0]?.[1] as FormData;
    expect(submittedFormData.get("smartDeviceId")).toBe("lock-xyz");
    expect(submittedFormData.get("operation")).toBe("LOCK");
  });

  describe("emphasis (2026-09-18 /locks UI cleanup)", () => {
    it("defaults to the normal secondary-button treatment when emphasis is omitted", () => {
      renderButton({ emphasis: undefined });

      const button = screen.getByRole("button", { name: "Unlock" });
      // Secondary variant's own distinguishing class (Button.tsx) — never a
      // disabled attribute either way; see the "still clickable" test below.
      expect(button.className).toMatch(/border-border/);
    });

    it("'subdued' renders the trigger as a quieter ghost button, not the normal one", () => {
      renderButton({ emphasis: "subdued" });

      const button = screen.getByRole("button", { name: "Unlock" });
      expect(button.className).not.toMatch(/border-border/);
    });

    it("'subdued' never disables the trigger — a stale known state must not block a legitimate command", () => {
      const action = renderButton({ emphasis: "subdued" });

      const button = screen.getByRole("button", { name: "Unlock" });
      expect((button as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(button);
      expect(
        screen.getByRole("button", { name: "Confirm Unlock" }),
      ).toBeTruthy();
      // Still requires explicit confirmation, exactly like the primary case —
      // subdued styling never skips the safety dialog.
      expect(action).not.toHaveBeenCalled();
    });
  });
});
