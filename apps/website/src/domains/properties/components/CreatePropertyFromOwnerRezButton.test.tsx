// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same reason as DiscoverDevicesButton.test.tsx: jsdom cannot emulate the
// real click-to-submit/requestSubmit() path React's <form action={fn}>
// (useActionState) interception relies on — mocking useActionState itself
// (every other React export stays real via importActual) tests what this
// component actually controls (pending/success/failure rendering and
// disabled={isPending}) without depending on jsdom's incomplete
// form-submission emulation.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

vi.mock("../actions", () => ({
  createPropertyFromOwnerRezAction: vi.fn(),
}));

import { CreatePropertyFromOwnerRezButton } from "./CreatePropertyFromOwnerRezButton";

afterEach(cleanup);

const noopFormAction = vi.fn();

function isDisabled(button: HTMLElement): boolean {
  return (button as HTMLButtonElement).disabled;
}

describe("CreatePropertyFromOwnerRezButton", () => {
  it("renders the idle state enabled, with no status message", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    const button = screen.getByRole("button", {
      name: "Create StayWhile Property",
    });
    expect(isDisabled(button)).toBe(false);
    expect(screen.queryByText(/Created/)).toBeNull();
  });

  it("submits the real OwnerRez id as the only hidden field", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    const form = screen
      .getByRole("button", {
        name: "Create StayWhile Property",
      })
      .closest("form")!;
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(
      form.querySelector('input[name="ownerRezPropertyId"]'),
    ).toHaveProperty("value", "480307");
  });

  it("gates the click behind window.confirm(), naming the specific OwnerRez property and id, before the form can submit", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );
    screen.getByRole("button", { name: "Create StayWhile Property" }).click();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Camingo"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("480307"));
    confirmSpy.mockRestore();
  });

  it("shows 'Creating…' and disables the button while isPending is true — this disabled attribute is what prevents a double submission", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    const button = screen.getByRole("button", { name: "Creating…" });
    expect(isDisabled(button)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Create StayWhile Property" }),
    ).toBeNull();
  });

  it("renders a success message naming the created property and returns the button to its normal, clickable state", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        propertyId: "prop-123",
        propertyName: "Camingo",
      },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    expect(
      screen.getByText('Created "Camingo" at Onboarding status.'),
    ).toBeTruthy();
    expect(
      isDisabled(
        screen.getByRole("button", { name: "Create StayWhile Property" }),
      ),
    ).toBe(false);
  });

  it("renders a validation/business-logic error message inline, verbatim, and leaves the button re-clickable — the page stays usable", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "failure",
        error:
          "Cannot create a StayWhile property from OwnerRez property 480307 — missing required field(s): time_zone. This property needs manual review instead.",
      },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    expect(
      screen.getByText(
        "Cannot create a StayWhile property from OwnerRez property 480307 — missing required field(s): time_zone. This property needs manual review instead.",
      ),
    ).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Create StayWhile Property",
    });
    expect(isDisabled(button)).toBe(false);
  });

  it("renders a generic safe error message inline without crashing, when the action reports an unexpected error", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "failure",
        error:
          "Something went wrong creating this property. Try again, or check with an admin if this keeps happening.",
      },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    expect(
      screen.getByText(
        "Something went wrong creating this property. Try again, or check with an admin if this keeps happening.",
      ),
    ).toBeTruthy();
    // The row itself must still be present and interactive — one failed
    // row never takes down the rest of the page.
    expect(
      isDisabled(
        screen.getByRole("button", { name: "Create StayWhile Property" }),
      ),
    ).toBe(false);
  });

  it("passes the real action straight through to useActionState with the idle initial state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(
      <CreatePropertyFromOwnerRezButton
        ownerRezPropertyId={480307}
        ownerRezPropertyName="Camingo"
      />,
    );

    expect(mockUseActionState).toHaveBeenCalledWith(expect.any(Function), {
      status: "idle",
    });
  });
});
