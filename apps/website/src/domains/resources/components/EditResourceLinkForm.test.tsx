// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { EditResourceLinkForm } from "./EditResourceLinkForm";

afterEach(cleanup);

const noopDispatch = vi.fn();
const noopAction = vi.fn();
const PROPERTIES = [{ id: "p1", name: "Camingo" }];
const RESOURCE_LINK = {
  id: "r1",
  name: "Pool vendor",
  url: "https://example.com/pool",
  description: "Call for service",
  category: "VENDOR" as const,
  propertyId: null,
  createdByUserId: "user-1",
  deletedAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

describe("EditResourceLinkForm", () => {
  it("pre-fills the existing values", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(
      <EditResourceLinkForm
        resourceLink={RESOURCE_LINK}
        properties={PROPERTIES}
        action={noopAction}
      />,
    );

    expect(screen.getByDisplayValue("Pool vendor")).toBeTruthy();
    expect(screen.getByDisplayValue("https://example.com/pool")).toBeTruthy();
  });

  it("renders a validation error inline instead of crashing — the form and its entered values stay present", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "validation_error",
        message: "String must contain at least 1 character(s)",
      },
      noopDispatch,
      false,
    ]);

    render(
      <EditResourceLinkForm
        resourceLink={RESOURCE_LINK}
        properties={PROPERTIES}
        action={noopAction}
      />,
    );

    expect(
      screen.getByText("String must contain at least 1 character(s)"),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Pool vendor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
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
      <EditResourceLinkForm
        resourceLink={RESOURCE_LINK}
        properties={PROPERTIES}
        action={noopAction}
      />,
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
      <EditResourceLinkForm
        resourceLink={RESOURCE_LINK}
        properties={PROPERTIES}
        action={noopAction}
      />,
    );

    expect(screen.getByText("Changes saved.")).toBeTruthy();
  });
});
