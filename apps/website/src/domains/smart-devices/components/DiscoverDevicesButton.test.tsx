// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom does not correctly emulate the browser's real click-to-submit /
// requestSubmit() path that React's <form action={fn}> (useActionState)
// interception relies on — confirmed directly: dispatching real submit
// events (fireEvent.submit, fireEvent.click, and even a native
// HTMLElement.click()) all surface React's own "form was unexpectedly
// submitted" guard instead of ever invoking the bound action in this
// environment. Mocking useActionState itself (keeping every other React
// export real via importActual) tests what this component actually
// controls — the pending/success/failure rendering and disabled={isPending}
// wiring — without depending on jsdom's incomplete form-submission
// emulation. React's own guarantee that the transition ignores a second
// dispatch while pending is a React-provided behavior, not something this
// component implements; this component's own contribution to preventing a
// double submission is exactly disabled={isPending}, which is what the
// dedicated test below verifies directly.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { DiscoverDevicesButton } from "./DiscoverDevicesButton";

afterEach(cleanup);

const noopFormAction = vi.fn();

// @testing-library/jest-dom is not installed in this project (confirmed —
// no toBeEnabled()/toBeDisabled() matcher exists), so the disabled
// attribute is checked directly against the real DOM property.
function isDisabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("DiscoverDevicesButton", () => {
  it("renders the given label, enabled, with no status message in the idle state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton label="Discover Nest devices" action={vi.fn()} />,
    );

    const button = screen.getByRole("button", {
      name: "Discover Nest devices",
    });
    expect(isDisabled(button)).toBe(false);
    expect(screen.queryByText(/Discovered/)).toBeNull();
    expect(screen.queryByText(/Discovery failed/)).toBeNull();
  });

  it("shows 'Discovering…' and disables the button while isPending is true — this disabled attribute is what actually prevents a double submission", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(
      <DiscoverDevicesButton
        label="Discover August devices"
        action={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Discovering…" });
    expect(isDisabled(button)).toBe(true);
    // The idle/original label must not also be present while pending.
    expect(
      screen.queryByRole("button", { name: "Discover August devices" }),
    ).toBeNull();
  });

  it("renders the exact discovered count on success, with correct singular wording for exactly one device", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", discovered: 1 },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton label="Discover Nest devices" action={vi.fn()} />,
    );

    expect(screen.getByText("Discovered 1 device.")).toBeTruthy();
    // Success must return the button to its normal, clickable label.
    expect(
      isDisabled(screen.getByRole("button", { name: "Discover Nest devices" })),
    ).toBe(false);
  });

  it("renders the exact discovered count on success, with correct plural wording for more than one device", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", discovered: 43 },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton
        label="Discover August devices"
        action={vi.fn()}
      />,
    );

    expect(screen.getByText("Discovered 43 devices.")).toBeTruthy();
  });

  it("shows the enriched count alongside the discovered count when the action reports it (August's two-phase discovery)", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", discovered: 43, enriched: 41, detailFailures: 0 },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton
        label="Discover August devices"
        action={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Discovered 43 devices. 41 enriched."),
    ).toBeTruthy();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it("shows a detail-lookup-failure count when enrichment partially failed, without affecting the discovered count", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", discovered: 43, enriched: 41, detailFailures: 2 },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton
        label="Discover August devices"
        action={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Discovered 43 devices. 41 enriched. 2 detail lookups failed.",
      ),
    ).toBeTruthy();
  });

  it("omits the enriched/detail-failure text entirely for Nest's plain discovered-count result", () => {
    mockUseActionState.mockReturnValue([
      { status: "success", discovered: 4 },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton label="Discover Nest devices" action={vi.fn()} />,
    );

    expect(screen.getByText("Discovered 4 devices.")).toBeTruthy();
  });

  it("renders a clear, verbatim failure message and leaves the button enabled (never stuck disabled after a failure)", () => {
    mockUseActionState.mockReturnValue([
      { status: "failure", error: "August isn't configured yet." },
      noopFormAction,
      false,
    ]);

    render(
      <DiscoverDevicesButton
        label="Discover August devices"
        action={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Discovery failed: August isn't configured yet."),
    ).toBeTruthy();
    expect(
      isDisabled(
        screen.getByRole("button", { name: "Discover August devices" }),
      ),
    ).toBe(false);
  });

  it("passes the given action straight through to useActionState with the idle initial state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);
    const action = vi.fn();

    render(
      <DiscoverDevicesButton label="Discover Nest devices" action={action} />,
    );

    expect(mockUseActionState).toHaveBeenCalledWith(action, { status: "idle" });
  });

  it("is reusable for both providers with no provider-specific logic — same component, different label/action props", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(
      <>
        <DiscoverDevicesButton label="Discover Nest devices" action={vi.fn()} />
        <DiscoverDevicesButton
          label="Discover August devices"
          action={vi.fn()}
        />
      </>,
    );

    expect(
      screen.getByRole("button", { name: "Discover Nest devices" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Discover August devices" }),
    ).toBeTruthy();
  });
});
