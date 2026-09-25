// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminResetLockButton } from "./AdminResetLockButton";
import { AugustFirstTestButton } from "./AugustFirstTestButton";
import { AugustLockControlButton } from "./AugustLockControlButton";
import { LockControlKillSwitch } from "./LockControlKillSwitch";

afterEach(cleanup);

describe("Re-lock prompt after UNLOCK (2026-09-25)", () => {
  it("routine UNLOCK success shows a prominent prompt whose button sends exactly one LOCK for the same lock", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({ status: "success", lockState: "unlocked" })
      .mockResolvedValueOnce({ status: "success", lockState: "locked" });
    render(
      <AugustLockControlButton
        smartDeviceId="lock-9"
        operation="UNLOCK"
        lockName="Front Door"
        propertyName="Aqua Palm"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Unlock" }));

    const prompt = await screen.findByRole("alert");
    expect(prompt.textContent).toMatch(/now UNLOCKED/);

    fireEvent.click(screen.getByRole("button", { name: /lock the door now/i }));
    expect(await screen.findByText(/Door locked again/)).toBeTruthy();

    const relockForm = action.mock.calls[1]![1] as FormData;
    expect(relockForm.get("smartDeviceId")).toBe("lock-9");
    expect(relockForm.get("operation")).toBe("LOCK");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("no prompt after a LOCK, or after an UNLOCK that did not succeed", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "rejected", reason: "nope" });
    render(
      <AugustLockControlButton
        smartDeviceId="lock-9"
        operation="UNLOCK"
        lockName="Front Door"
        propertyName="Aqua Palm"
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Unlock" }));
    await screen.findByText("nope");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("first-verification UNLOCK success also shows the prompt", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", lockState: "unlocked" });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-3"
        lockName="Front Door"
        propertyName="Bonjour"
        currentLockState="locked"
        action={action}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test unlock/i }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /now UNLOCKED/,
    );
  });
});

describe("First test must command the opposite of the known state (2026-09-25)", () => {
  it.each([
    ["locked", /confirm.*test lock$/i, /test Unlock/],
    ["unlocked", /confirm.*test unlock/i, /test Lock/],
  ])(
    "known state %s disables the same-state test button, with a hint",
    (state, sameButton, hint) => {
      render(
        <AugustFirstTestButton
          smartDeviceId="lock-3"
          lockName="Front Door"
          propertyName="Bonjour"
          currentLockState={state}
          action={vi.fn()}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /test controllability/i }),
      );
      expect(
        (screen.getByRole("button", { name: sameButton }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(screen.getByText(hint)).toBeTruthy();
    },
  );

  it("unknown known state leaves both test buttons enabled (the server still enforces the rule)", () => {
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-3"
        lockName="Front Door"
        propertyName="Bonjour"
        currentLockState={null}
        action={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: /confirm.*test lock$/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: /confirm.*test unlock/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("LockControlKillSwitch (2026-09-25)", () => {
  it("OFF is shown prominently to everyone; no toggle without canToggle", () => {
    render(
      <LockControlKillSwitch
        enabled={false}
        canToggle={false}
        action={vi.fn()}
      />,
    );
    expect(screen.getByText(/Remote lock control is OFF/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an admin toggle submits the opposite value, only after the browser confirm", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", enabled: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<LockControlKillSwitch enabled canToggle action={action} />);

    fireEvent.click(
      screen.getByRole("button", { name: /turn off remote control/i }),
    );
    expect(action).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(
      screen.getByRole("button", { name: /turn off remote control/i }),
    );
    expect(action).toHaveBeenCalled();
    expect((action.mock.calls[0]![1] as FormData).get("enabled")).toBe("false");
    confirmSpy.mockRestore();
  });
});

describe("AdminResetLockButton (2026-09-25)", () => {
  it("submits the observed state and the in-person confirmation for this exact lock", async () => {
    const action = vi.fn().mockResolvedValue({ status: "success" });
    render(
      <AdminResetLockButton
        smartDeviceId="lock-orion"
        lockName="Front Door"
        propertyName="Orion's Landing"
        action={action}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /reset after physical check/i }),
    );
    fireEvent.click(screen.getByLabelText("Locked"));
    fireEvent.click(screen.getByLabelText(/checked in person/i));
    fireEvent.click(screen.getByRole("button", { name: /record reset/i }));

    expect(await screen.findByText(/Reset recorded/)).toBeTruthy();
    const form = action.mock.calls[0]![1] as FormData;
    expect(form.get("smartDeviceId")).toBe("lock-orion");
    expect(form.get("observedLockState")).toBe("locked");
    expect(form.get("confirmedInPerson")).toBe("on");
  });

  it("says plainly that no command is sent and the lock is not marked verified", () => {
    render(
      <AdminResetLockButton
        smartDeviceId="lock-orion"
        lockName="Front Door"
        propertyName="Orion's Landing"
        action={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /reset after physical check/i }),
    );
    expect(screen.getByText(/No command is sent to the lock/)).toBeTruthy();
    expect(screen.getByText(/NOT marked as verified/)).toBeTruthy();
  });
});
