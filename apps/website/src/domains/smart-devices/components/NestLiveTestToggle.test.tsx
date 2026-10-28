// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom can't drive React's <form action={fn}> submission; the action
// state is mocked so each test sets what the last submission returned.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { NestLiveTestToggle } from "./NestLiveTestToggle";

afterEach(cleanup);

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";

function hidden(name: string) {
  return (document.querySelector(`input[name="${name}"]`) as HTMLInputElement)
    .value;
}

describe("NestLiveTestToggle", () => {
  it("a device not on the list offers 'Add to live test', submitting onList=true for this device", () => {
    mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
    render(
      <NestLiveTestToggle
        smartDeviceId={DEVICE_ID}
        deviceLabel="Aqua Palm — Living Room"
        onList={false}
        action={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add to live test" }),
    ).toBeTruthy();
    expect(hidden("smartDeviceId")).toBe(DEVICE_ID);
    expect(hidden("onList")).toBe("true");
  });

  it("a listed device offers 'Remove from live test', submitting onList=false", () => {
    mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
    render(
      <NestLiveTestToggle
        smartDeviceId={DEVICE_ID}
        deviceLabel="Aqua Palm — Living Room"
        onList
        action={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove from live test" }),
    ).toBeTruthy();
    expect(hidden("onList")).toBe("false");
  });

  it("shows the server's refusal reason", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "rejected",
        reason:
          "The live-test list already has 3 thermostats. Remove one first.",
      },
      vi.fn(),
      false,
    ]);
    render(
      <NestLiveTestToggle
        smartDeviceId={DEVICE_ID}
        deviceLabel="Aqua Palm — Living Room"
        onList={false}
        action={vi.fn()}
      />,
    );

    expect(screen.getByText(/already has 3 thermostats/)).toBeTruthy();
  });

  it("disables the button while saving", () => {
    mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), true]);
    render(
      <NestLiveTestToggle
        smartDeviceId={DEVICE_ID}
        deviceLabel="Aqua Palm — Living Room"
        onList
        action={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Saving…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
