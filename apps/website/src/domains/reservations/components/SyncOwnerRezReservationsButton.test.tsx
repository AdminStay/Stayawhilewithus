// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

async function submitWith(state: unknown) {
  const action = vi.fn().mockResolvedValue(state);
  render(<SyncOwnerRezReservationsButton action={action} />);
  fireEvent.click(screen.getByRole("button", { name: /Sync OwnerRez/ }));
  return action;
}

describe("SyncOwnerRezReservationsButton — rate-limit reporting (2026-09-28)", () => {
  it("a partial run says how many bookings were deferred and when to run again", async () => {
    await submitWith({
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
    await submitWith({
      status: "cooldown",
      cooldownUntil: "2026-09-28T04:05:00.000Z",
    });
    expect(
      await screen.findByText(/Waiting for OwnerRez's request limit to reset/),
    ).toBeTruthy();
    expect(screen.queryByText(/Sync failed/)).toBeNull();
  });

  it("a complete run shows no deferral warning", async () => {
    await submitWith(baseSuccess);
    expect(await screen.findByText(/40 new, 0 updated/)).toBeTruthy();
    expect(screen.queryByText(/deferred/)).toBeNull();
  });
});
