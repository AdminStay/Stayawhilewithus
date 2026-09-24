// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AugustFirstTestButton } from "./AugustFirstTestButton";

afterEach(cleanup);

function renderButton(
  overrides: Partial<Parameters<typeof AugustFirstTestButton>[0]> = {},
) {
  const action = vi.fn();
  render(
    <AugustFirstTestButton
      smartDeviceId="lock-1"
      lockName="Front Door"
      propertyName="Orion's Landing"
      currentLockState="unknown"
      action={action}
      {...overrides}
    />,
  );
  return action;
}

describe("AugustFirstTestButton", () => {
  it("does not submit on the trigger click alone — opens a confirmation dialog instead", () => {
    const action = renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(action).not.toHaveBeenCalled();
  });

  it("confirmation shows the exact property and lock name", () => {
    renderButton({ propertyName: "Bahamas", lockName: "Bahamas - Front Door" });

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(screen.getByText(/Bahamas - Front Door/)).toBeTruthy();
    expect(screen.getByText("Bahamas")).toBeTruthy();
  });

  it("shows the current known state, or UNKNOWN when there is none", () => {
    renderButton({ currentLockState: null });

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  });

  it("shows a real current known state verbatim when one exists", () => {
    renderButton({ currentLockState: "locked" });

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(screen.getByText("locked")).toBeTruthy();
  });

  it("warns that this will physically move a real lock", () => {
    renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(screen.getByText(/physically move this lock/i)).toBeTruthy();
  });

  it("never pre-selects an operation — both LOCK and UNLOCK are offered as separate, explicit choices", () => {
    const action = renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );

    expect(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /confirm.*test unlock/i }),
    ).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without ever submitting", () => {
    const action = renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("clicking 'Confirm — test LOCK' submits exactly this row's smartDeviceId with operation=LOCK — the exact operation the operator picked, never inferred", () => {
    const action = vi.fn().mockResolvedValue({ status: "idle" });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-xyz"
        lockName="Side Door"
        propertyName="Camingo"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    expect(action).toHaveBeenCalled();
    const submittedFormData = action.mock.calls[0]?.[1] as FormData;
    expect(submittedFormData.get("smartDeviceId")).toBe("lock-xyz");
    expect(submittedFormData.get("operation")).toBe("LOCK");
  });

  it("clicking 'Confirm — test UNLOCK' submits operation=UNLOCK, never LOCK", () => {
    const action = vi.fn().mockResolvedValue({ status: "idle" });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-xyz"
        lockName="Side Door"
        propertyName="Camingo"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test unlock/i }),
    );

    expect(action).toHaveBeenCalled();
    const submittedFormData = action.mock.calls[0]?.[1] as FormData;
    expect(submittedFormData.get("operation")).toBe("UNLOCK");
  });

  it("after a real FAILED outcome, both operation buttons disappear — the dialog cannot be used to immediately retry", () => {
    const action = vi
      .fn()
      .mockResolvedValue({
        status: "failure",
        reason: "August refused the command for this specific lock.",
      });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen.findByText(/blocked from further testing/i).then(() => {
      expect(
        screen.queryByRole("button", { name: /confirm.*test lock/i }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /confirm.*test unlock/i }),
      ).toBeNull();
      // "Close" also matches the dialog's own header X button (aria-label
      // "Close") — two matches confirms both it and this form's own Close
      // button (Cancel's replacement, once decided) are present.
      expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
    });
  });

  it("OUTCOME CLARITY: a FAILED reason that itself says 'try again shortly' (e.g. a real 423/408 bridge-busy/timeout) is still framed as BLOCKED/do-not-retry, never read as an invitation to immediately retry", () => {
    const action = vi.fn().mockResolvedValue({
      status: "failure",
      reason:
        "This lock's bridge is busy with another operation right now — try again shortly.",
    });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen.findByText(/BLOCKED/).then((el) => {
      expect(el.textContent).toMatch(/did not succeed/i);
      expect(el.textContent).toMatch(/Do not retry/i);
      expect(el.textContent).toMatch(/try again shortly/i); // the raw safe reason is still shown as supporting detail
    });
  });

  it("OUTCOME CLARITY: FAILED renders in the error tone, distinct from REJECTED/ALREADY_RUNNING's tone", () => {
    const action = vi
      .fn()
      .mockResolvedValue({
        status: "failure",
        reason: "August refused the command for this specific lock.",
      });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen.findByText(/BLOCKED/).then((el) => {
      expect(el.className).toMatch(/text-error-500/);
    });
  });

  it("after a real SUCCEEDED outcome, both operation buttons disappear and the success message says routine controls are now available", () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "success", lockState: "locked" });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen
      .findByText(/Routine Lock\/Unlock controls are now available/i)
      .then((el) => {
        expect(
          screen.queryByRole("button", { name: /confirm.*test lock/i }),
        ).toBeNull();
        expect(
          screen.queryByRole("button", { name: /confirm.*test unlock/i }),
        ).toBeNull();
        // OUTCOME CLARITY: success renders in its own distinct tone, never
        // the same color as a real failure or a stopped/pending outcome.
        expect(el.className).toMatch(/text-success-600/);
      });
  });

  it("after a REJECTED (preflight) outcome, both operation buttons disappear and the exact reason is shown, never a false success", () => {
    const action = vi.fn().mockResolvedValue({
      status: "rejected",
      reason: "Live control isn't enabled for this lock yet.",
    });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen
      .findByText(
        /stopped before reaching the lock.*Live control isn't enabled for this lock yet.*remains not-yet-verified/s,
      )
      .then((el) => {
        expect(
          screen.queryByRole("button", { name: /confirm.*test lock/i }),
        ).toBeNull();
        expect(
          screen.queryByRole("button", { name: /confirm.*test unlock/i }),
        ).toBeNull();
        // OUTCOME CLARITY: REJECTED never claims success and is never
        // shown in the same (error) tone as a real FAILED outcome — it
        // stopped before ever reaching the physical lock.
        expect(el.textContent).not.toMatch(/success|succeeded/i);
        expect(el.className).toMatch(/text-warning-600/);
        expect(el.className).not.toMatch(/text-error-500/);
      });
  });

  it("OUTCOME CLARITY: ALREADY_RUNNING explicitly says no new command was sent, never implies success or failure, and renders in the non-error tone", () => {
    const action = vi.fn().mockResolvedValue({ status: "already_running" });
    render(
      <AugustFirstTestButton
        smartDeviceId="lock-1"
        lockName="Front Door"
        propertyName="Orion's Landing"
        currentLockState={null}
        action={action}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /test controllability/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /confirm.*test lock/i }),
    );

    return screen.findByText(/No new command was sent/i).then((el) => {
      expect(el.textContent).not.toMatch(/success|succeeded|failed|blocked/i);
      expect(el.className).toMatch(/text-warning-600/);
      // Nothing was actually attempted — the operator can still retry
      // right in this same dialog, unlike a real outcome.
      expect(
        screen.getByRole("button", { name: /confirm.*test lock/i }),
      ).toBeTruthy();
    });
  });
});
