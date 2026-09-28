// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SyncOwnerRezReservationsButton } from "./SyncOwnerRezReservationsButton";

afterEach(cleanup);

const baseSuccess = {
  status: "success" as const,
  syncedAt: "2026-09-28T04:00:00.000Z",
  created: 40,
  updated: 0,
  unmatchedProperty: [],
  unrecognizedStatus: [],
  guestErrors: [],
  guestDeferred: [] as Array<{ ownerRezBookingId: number; reason: string }>,
  deferredUntil: null as string | null,
};

function renderButton(action = vi.fn()) {
  render(<SyncOwnerRezReservationsButton action={action} />);
  return action;
}

const dialog = () => document.querySelector("dialog")!;
const openDialog = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Sync OwnerRez$/ }));

describe("SyncOwnerRezReservationsButton — explicit confirmation (2026-09-28)", () => {
  it("the first click only opens the confirmation dialog — the sync is NOT executed", () => {
    const action = renderButton();
    expect(dialog().hasAttribute("open")).toBe(false);

    openDialog();

    expect(dialog().hasAttribute("open")).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain(
      "This will read reservation and guest information from OwnerRez and create or update Guests and Reservations in the StayWhile database.",
    );
    expect(dialog().textContent).toContain(
      "OwnerRez itself will not be modified.",
    );
    expect(screen.getByRole("button", { name: /Confirm Sync/ })).toBeTruthy();
  });

  it("Cancel closes the dialog and does nothing", () => {
    const action = renderButton();
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("closing the dialog (close button / Escape) does nothing", () => {
    const action = renderButton();
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(dialog().hasAttribute("open")).toBe(false);
    openDialog();
    fireEvent(dialog(), new Event("cancel"));
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("only Confirm Sync invokes the real sync — exactly once", async () => {
    const action = renderButton(vi.fn().mockResolvedValue(baseSuccess));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Sync/ }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/40 new, 0 updated/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm Sync/ })).toBeNull();
  });

  it("double-submit is prevented: while syncing Confirm is gone and Cancel is disabled; a second click can't start another sync", async () => {
    let finish: (v: unknown) => void = () => {};
    const action = renderButton(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    openDialog();
    const confirm = screen.getByRole("button", { name: /Confirm Sync/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /Confirm Sync/ })).toBeNull();
    await act(async () => finish(baseSuccess));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("SyncOwnerRezReservationsButton — rate-limit reporting (2026-09-28)", () => {
  async function confirmWith(state: unknown) {
    renderButton(vi.fn().mockResolvedValue(state));
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Sync/ }));
  }

  it("a partial run says how many bookings were deferred and when to run again", async () => {
    await confirmWith({
      ...baseSuccess,
      guestDeferred: [
        { ownerRezBookingId: 1, reason: "x" },
        { ownerRezBookingId: 2, reason: "y" },
      ],
      deferredUntil: "2026-09-28T04:05:00.000Z",
    });
    expect(await screen.findByText(/2 deferred/)).toBeTruthy();
    expect(
      screen.getByText(/2 bookings were deferred\. Run the sync again after/),
    ).toBeTruthy();
  });

  it("a cooldown refusal explains the wait instead of looking like a failure", async () => {
    await confirmWith({
      status: "cooldown",
      cooldownUntil: "2026-09-28T04:05:00.000Z",
    });
    expect(
      await screen.findByText(/Waiting for OwnerRez's request limit to reset/),
    ).toBeTruthy();
    expect(screen.queryByText(/Sync failed/)).toBeNull();
  });

  it("a complete run shows no deferral warning", async () => {
    await confirmWith(baseSuccess);
    expect(await screen.findByText(/40 new, 0 updated/)).toBeTruthy();
    expect(screen.queryByText(/deferred/)).toBeNull();
  });
});
