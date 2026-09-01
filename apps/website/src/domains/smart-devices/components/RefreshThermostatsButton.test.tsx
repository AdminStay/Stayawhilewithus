// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as DiscoverDevicesButton.test.tsx: jsdom does not correctly
// emulate the browser's real click-to-submit / requestSubmit() path that
// React's <form action={fn}> (useActionState) interception relies on, so
// useActionState is mocked directly (every other React export stays real)
// to test what this component actually controls — rendering per state and
// disabled={isPending} wiring — without depending on jsdom's incomplete
// form-submission emulation.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { RefreshThermostatsButton } from "./RefreshThermostatsButton";

afterEach(cleanup);

const noopFormAction = vi.fn();

function isDisabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("RefreshThermostatsButton", () => {
  it("renders enabled with no status message in the idle state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Refresh" });
    expect(isDisabled(button)).toBe(false);
    expect(screen.queryByText(/refreshed/)).toBeNull();
  });

  it("shows 'Refreshing…' and disables the button while isPending is true — this is what prevents a duplicate click from starting a second refresh", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Refreshing…" });
    expect(isDisabled(button)).toBe(true);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("shows each provider's real outcome and the last-refreshed timestamp on full success", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        providers: [
          {
            provider: "NEST",
            status: "success",
            refreshed: 31,
            notReturnedByProvider: 0,
          },
          {
            provider: "CIELO",
            status: "success",
            refreshed: 3,
            notReturnedByProvider: 0,
          },
        ],
        refreshedAt: "2026-09-02T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    expect(screen.getByText("Nest: 31 devices refreshed.")).toBeTruthy();
    expect(screen.getByText("Cielo: 3 devices refreshed.")).toBeTruthy();
    expect(screen.getByText(/Last refreshed:/)).toBeTruthy();
  });

  it("uses correct singular wording for exactly one device refreshed", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        providers: [
          {
            provider: "NEST",
            status: "success",
            refreshed: 1,
            notReturnedByProvider: 0,
          },
        ],
        refreshedAt: "2026-09-02T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    expect(screen.getByText("Nest: 1 device refreshed.")).toBeTruthy();
  });

  it("shows a not-configured message for a provider that isn't connected, distinct from a real failure", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        providers: [{ provider: "CIELO", status: "not_configured" }],
        refreshedAt: "2026-09-02T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    expect(
      screen.getByText("Cielo: not connected — nothing to refresh."),
    ).toBeTruthy();
  });

  it("shows a partial-failure state — one provider's real success alongside another's real failure, never merged into one ambiguous message", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        providers: [
          { provider: "NEST", status: "failure", error: "network error" },
          {
            provider: "CIELO",
            status: "success",
            refreshed: 3,
            notReturnedByProvider: 0,
          },
        ],
        refreshedAt: "2026-09-02T12:00:00.000Z",
      },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

    expect(
      screen.getByText("Nest: refresh failed — network error"),
    ).toBeTruthy();
    expect(screen.getByText("Cielo: 3 devices refreshed.")).toBeTruthy();
  });

  it("shows a clear full-failure message when the whole refresh call failed, and no per-provider list", () => {
    mockUseActionState.mockReturnValue([
      { status: "failure", error: "ForbiddenError" },
      noopFormAction,
      false,
    ]);

    render(<RefreshThermostatsButton action={vi.fn()} />);

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

    render(<RefreshThermostatsButton action={action} />);

    expect(mockUseActionState).toHaveBeenCalledWith(action, {
      status: "idle",
    });
  });
});
