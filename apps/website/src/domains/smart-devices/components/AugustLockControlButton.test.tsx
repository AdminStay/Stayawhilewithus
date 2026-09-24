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

  it("no_action (2026-09-25): says no command was sent — never phrased as a confirmed transition — and offers Close, not Confirm", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "no_action", lockState: "locked" });
    renderButton({ operation: "LOCK", action });

    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Lock" }));

    expect(
      await screen.findByText(
        'No command was sent — this lock already reports "locked".',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Confirmed/)).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Close" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Confirm Lock" })).toBeNull();
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

  describe("disabled/disabledReason (2026-09-23, E — real eligibility)", () => {
    it("defaults to enabled/clickable when disabled is omitted — unchanged behavior for every existing caller", () => {
      const action = renderButton();

      const button = screen.getByRole("button", { name: "Unlock" });
      expect((button as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(button);
      expect(
        screen.getByRole("button", { name: "Confirm Unlock" }),
      ).toBeTruthy();
      expect(action).not.toHaveBeenCalled();
    });

    it("disables the trigger and shows the real reason as its tooltip when disabled is true — the confirm dialog never opens", () => {
      renderButton({
        disabled: true,
        disabledReason: "Live control isn't enabled for this lock yet.",
      });

      const button = screen.getByRole("button", {
        name: "Unlock",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("title")).toBe(
        "Live control isn't enabled for this lock yet.",
      );

      fireEvent.click(button);
      expect(
        screen.queryByRole("button", { name: "Confirm Unlock" }),
      ).toBeNull();
    });

    it("never shows a tooltip reason when disabled is false, even if a reason string is passed — a stray reason must not leak onto an enabled button", () => {
      renderButton({
        disabled: false,
        disabledReason: "Live control isn't enabled for this lock yet.",
      });

      const button = screen.getByRole("button", { name: "Unlock" });
      expect(button.getAttribute("title")).toBeNull();
    });
  });
});
