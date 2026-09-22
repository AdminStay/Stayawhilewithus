// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as NotionFieldEditor.test.tsx: jsdom does not correctly
// emulate the browser's real click-to-submit / requestSubmit() path
// useActionState's automatic form binding relies on, so useActionState is
// mocked directly (every other React export stays real) to control exactly
// which state this component receives.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { NotionBlockEditor } from "./NotionBlockEditor";

afterEach(cleanup);

const noopDispatch = vi.fn();
const mockAction = vi.fn();

const BASE_PROPS = {
  pageId: "page-1",
  blockId: "b1",
  lastEditedTime: "2026-09-22T00:00:00.000Z",
  initialPlainText: "Call the guest before arrival.",
  initialDisplay: <p>Call the guest before arrival.</p>,
  wrap: (content: React.ReactNode) => (
    <div data-testid="wrapped">{content}</div>
  ),
  action: mockAction,
};

describe("NotionBlockEditor", () => {
  it("starts in read-only display with an Edit affordance, showing the current content via wrap()", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);

    expect(screen.getByText("Call the guest before arrival.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("clicking Edit reveals a textarea pre-filled with the plain text and Save/Cancel, never dispatching until Save", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Call the guest before arrival.");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(noopDispatch).not.toHaveBeenCalled();
  });

  it("Cancel returns to the read-only display without dispatching", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(noopDispatch).not.toHaveBeenCalled();
  });

  it("submitting Save dispatches exactly pageId/blockId/expectedLastEditedTime/text — never any other shape", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Updated instructions." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(noopDispatch).toHaveBeenCalledWith({
      pageId: "page-1",
      blockId: "b1",
      expectedLastEditedTime: "2026-09-22T00:00:00.000Z",
      text: "Updated instructions.",
    });
  });

  it("disables Save/Cancel while a submission is pending", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      true,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("on success, displays the server-confirmed plain text — never the browser's own optimistic guess", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        newLastEditedTime: "2026-09-22T01:00:00.000Z",
        newText: "Server-confirmed text",
      },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);

    expect(screen.getByText("Server-confirmed text")).toBeTruthy();
    expect(screen.queryByText("Call the guest before arrival.")).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("shows a safe, already-sanitized message on a provider_error — never a raw error/stack/credential", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "provider_error",
        message: "Couldn't save this change to Notion. Please try again.",
      },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText(
        "Couldn't save this change to Notion. Please try again.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/prisma|secret|token|stack|at file:/i),
    ).toBeNull();
  });

  it("shows a validation_error message inline", () => {
    mockUseActionState.mockReturnValue([
      { status: "validation_error", message: "Too long." },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Too long.")).toBeTruthy();
  });

  it("shows a not_editable message inline, without crashing", () => {
    mockUseActionState.mockReturnValue([
      { status: "not_editable" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText("This content is no longer editable."),
    ).toBeTruthy();
  });

  it("shows the already-sanitized verification_failed message — never claiming success when the write couldn't be confirmed", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "verification_failed",
        message:
          "The change may not have saved correctly. Please reload and check this content in Notion before trying again.",
      },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText(
        "The change may not have saved correctly. Please reload and check this content in Notion before trying again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("on conflict, tells the user to close and reopen rather than silently overwriting", () => {
    mockUseActionState.mockReturnValue([
      { status: "conflict" },
      noopDispatch,
      false,
    ]);

    render(<NotionBlockEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText(/changed in Notion since it was loaded here/),
    ).toBeTruthy();
  });
});
