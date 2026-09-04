// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as RefreshThermostatsButton.test.tsx: jsdom does not
// correctly emulate the browser's real click-to-submit / requestSubmit()
// path that React's <form action={fn}> (useActionState) interception relies
// on, so useActionState is mocked directly (every other React export stays
// real) to test what this component actually controls — rendering per
// state and disabled={isPending} wiring.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { RefreshLocksButton } from "./RefreshLocksButton";

afterEach(cleanup);

const noopFormAction = vi.fn();

function isDisabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("RefreshLocksButton", () => {
  it("renders enabled with no status message in the idle state, and always shows the 'not Sync Now' clarification", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Refresh telemetry" });
    expect(isDisabled(button)).toBe(false);
    expect(screen.queryByText(/refreshed/)).toBeNull();
    expect(screen.getByText(/not the same as August Sync Now/)).toBeTruthy();
  });

  it("shows 'Refreshing…' and disables the button while isPending is true — this is what prevents a duplicate click from starting a second refresh", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Refreshing…" });
    expect(isDisabled(button)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Refresh telemetry" }),
    ).toBeNull();
  });

  it("shows the exact refreshed count and the last-refreshed timestamp on full success", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 37,
        notReturnedByProvider: 0,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(screen.getByText("August: 37 locks refreshed.")).toBeTruthy();
    expect(screen.getByText(/Last refreshed:/)).toBeTruthy();
  });

  it("uses correct singular wording for exactly one lock refreshed", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 1,
        notReturnedByProvider: 0,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(screen.getByText("August: 1 lock refreshed.")).toBeTruthy();
  });

  it("shows a distinct partial-failure message when some devices could not be refreshed", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 35,
        notReturnedByProvider: 2,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(
      screen.getByText("August: 35 refreshed, 2 could not be refreshed."),
    ).toBeTruthy();
  });

  it("shows a distinct all-failed message when every eligible device failed", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 0,
        notReturnedByProvider: 3,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(
      screen.getByText("August: 0 refreshed, 3 could not be refreshed."),
    ).toBeTruthy();
  });

  it("shows a distinct zero-eligible message, never claiming a failure", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 0,
        notReturnedByProvider: 0,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(
      screen.getByText("August: no enabled locks to refresh."),
    ).toBeTruthy();
  });

  it("never mentions connectivity/online/offline in its summary — a batch of UNKNOWN-connectivity locks is never implied to be offline", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        refreshed: 37,
        notReturnedByProvider: 0,
        refreshedAt: "2026-09-04T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.queryByText(/online/i)).toBeNull();
  });

  it("shows a clear failure message when the whole refresh call failed, and no last-refreshed line", () => {
    mockUseActionState.mockReturnValue([
      { status: "failure", error: "ForbiddenError" },
      noopFormAction,
      false,
    ]);

    render(<RefreshLocksButton action={vi.fn()} />);

    expect(screen.getByText("Refresh failed: ForbiddenError")).toBeTruthy();
    expect(screen.queryByText(/Last refreshed:/)).toBeNull();
  });

  it("passes the given action straight through to useActionState with the idle initial state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);
    const action = vi.fn();

    render(<RefreshLocksButton action={action} />);

    expect(mockUseActionState).toHaveBeenCalledWith(action, {
      status: "idle",
    });
  });
});
