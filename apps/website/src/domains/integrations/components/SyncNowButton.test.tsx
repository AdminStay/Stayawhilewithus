// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as RefreshLocksButton.test.tsx: jsdom does not correctly
// emulate the browser's real click-to-submit / requestSubmit() path that
// React's <form action={fn}> (useActionState) interception relies on, so
// useActionState is mocked directly (every other React export stays real)
// to test what this component actually controls — rendering per state and
// disabled={isPending} wiring.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { SyncNowButton } from "./SyncNowButton";

afterEach(cleanup);

const noopFormAction = vi.fn();

function isDisabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("SyncNowButton", () => {
  it("renders enabled with no status message in the idle state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Sync now" });
    expect(isDisabled(button)).toBe(false);
  });

  it("shows 'Syncing…' and disables the button while isPending is true", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Syncing…" });
    expect(isDisabled(button)).toBe(true);
  });

  it("shows a plain success message when everything synced with nothing skipped or already mapped", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", synced: 7, skipped: 0, alreadyMapped: 0 },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(screen.getByText("Synced 7 devices.")).toBeTruthy();
  });

  it("never calls an already-mapped device 'no property mapping' — reports it as a separate, non-alarming note", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", synced: 7, skipped: 0, alreadyMapped: 36 },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(
      screen.getByText(
        "Synced 7 devices (36 already mapped via device mapping — kept up to date separately).",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/no property mapping/)).toBeNull();
  });

  it("still shows 'no property mapping' for locks that are genuinely unmapped", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", synced: 7, skipped: 2, alreadyMapped: 34 },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(
      screen.getByText(
        "Synced 7 devices (34 already mapped via device mapping — kept up to date separately; 2 found but skipped — no property mapping).",
      ),
    ).toBeTruthy();
  });

  it("shows a distinct zero-synced message when nothing was written but devices were found already mapped elsewhere", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", synced: 0, skipped: 0, alreadyMapped: 36 },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(
      screen.getByText(
        "Synced 0 devices (36 already mapped via device mapping — kept up to date separately).",
      ),
    ).toBeTruthy();
  });

  it("shows the plain zero-devices message only when the provider genuinely returned nothing at all", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", synced: 0, skipped: 0, alreadyMapped: 0 },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(
      screen.getByText("Provider returned 0 devices — nothing to sync."),
    ).toBeTruthy();
  });

  it("shows a clear failure message on failure", () => {
    mockUseActionState.mockReturnValue([
      { status: "failure", error: "ForbiddenError" },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(screen.getByText("Sync failed: ForbiddenError")).toBeTruthy();
  });

  it("shows the already-running message distinctly", () => {
    mockUseActionState.mockReturnValue([
      { status: "already_running" },
      noopFormAction,
      false,
    ]);

    render(<SyncNowButton connectionId="conn-1" action={vi.fn()} />);

    expect(
      screen.getByText("A sync is already in progress for this connection."),
    ).toBeTruthy();
  });
});
