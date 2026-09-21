// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as SyncNowButton.test.tsx/NotionFieldEditor.test.tsx: jsdom
// does not correctly emulate the browser's real click-to-submit path
// useActionState's form binding relies on, so useActionState is mocked
// directly to control exactly which state this component receives.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { CreateResourceLinkForm } from "./CreateResourceLinkForm";

afterEach(cleanup);

const noopDispatch = vi.fn();
const noopAction = vi.fn();
const PROPERTIES = [{ id: "p1", name: "Camingo" }];

describe("CreateResourceLinkForm", () => {
  it("renders idle with no error/success message", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(
      <CreateResourceLinkForm properties={PROPERTIES} action={noopAction} />,
    );

    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("URL")).toBeTruthy();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it("renders a validation error inline instead of crashing — the form stays usable, values are not cleared", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "validation_error",
        message: "URL must start with http:// or https://",
      },
      noopDispatch,
      false,
    ]);

    render(
      <CreateResourceLinkForm properties={PROPERTIES} action={noopAction} />,
    );

    expect(
      screen.getByText("URL must start with http:// or https://"),
    ).toBeTruthy();
    // The form itself is still present and submittable — a validation
    // error must never unmount/replace the form with a crash screen.
    expect(screen.getByRole("button", { name: "Add resource" })).toBeTruthy();
  });

  it("renders a safe, generic message for an unexpected server error — never a raw error/stack/credential", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "error",
        message: "Something went wrong saving this resource. Please try again.",
      },
      noopDispatch,
      false,
    ]);

    render(
      <CreateResourceLinkForm properties={PROPERTIES} action={noopAction} />,
    );

    expect(
      screen.getByText(
        "Something went wrong saving this resource. Please try again.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/prisma|secret|token|stack|at file:/i),
    ).toBeNull();
  });

  it("shows a success confirmation on success", () => {
    mockUseActionState.mockReturnValue([
      { status: "success" },
      noopDispatch,
      false,
    ]);

    render(
      <CreateResourceLinkForm properties={PROPERTIES} action={noopAction} />,
    );

    expect(screen.getByText("Resource added.")).toBeTruthy();
  });

  it("disables the submit button and shows a pending label while saving", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      true,
    ]);

    render(
      <CreateResourceLinkForm properties={PROPERTIES} action={noopAction} />,
    );

    const button = screen.getByRole("button", { name: "Saving…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
