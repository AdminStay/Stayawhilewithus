// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as RefreshLocksButton.test.tsx/SyncNowButton.test.tsx:
// jsdom does not correctly emulate the browser's real click-to-submit /
// requestSubmit() path useActionState's automatic form binding relies on,
// so useActionState is mocked directly (every other React export stays
// real) to control exactly which state this component receives.
const { mockUseActionState, mockRouterRefresh } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { NotionFieldEditor } from "./NotionFieldEditor";

afterEach(cleanup);

const noopDispatch = vi.fn();
const mockAction = vi.fn();

const BASE_PROPS = {
  pageId: "page-1",
  dataSourceId: "ds-1",
  field: "guidebookUrl",
  lastEditedTime: "2026-09-01T00:00:00.000Z",
  fieldType: "url" as const,
  action: mockAction,
};

describe("NotionFieldEditor", () => {
  it("starts in read-only display with an Edit affordance, showing the current value", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(
      <NotionFieldEditor
        {...BASE_PROPS}
        value="https://guidebook.example/old"
      />,
    );

    expect(screen.getByText("https://guidebook.example/old")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("clicking Edit reveals the control and Save/Cancel, never calling Notion directly (dispatch untouched until Save)", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://x.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(noopDispatch).not.toHaveBeenCalled();
  });

  it("Save calls the passed-in action (never Notion directly) with the exact submitted shape, including the conflict token", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://old.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("https://old.example");
    fireEvent.change(input, { target: { value: "https://new.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(noopDispatch).toHaveBeenCalledWith({
      pageId: "page-1",
      dataSourceId: "ds-1",
      field: "guidebookUrl",
      expectedLastEditedTime: "2026-09-01T00:00:00.000Z",
      value: "https://new.example",
    });
  });

  it("on success: displays the server-confirmed value/time (never the browser's own optimistic guess) and exits edit mode with a Saved indicator", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "success",
        newValue: "https://server-confirmed.example",
        newLastEditedTime: "2026-09-02T00:00:00.000Z",
      },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://stale.example" />);

    expect(screen.getByText("https://server-confirmed.example")).toBeTruthy();
    expect(screen.queryByText("https://stale.example")).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("on validation failure: keeps the user in edit mode with their draft intact and shows the message", () => {
    mockUseActionState.mockReturnValue([
      { status: "validation_error", message: "Must be a valid URL" },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://x.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Must be a valid URL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("on provider failure: shows the already-sanitized message only, never a raw response or credential, and stays editable", () => {
    mockUseActionState.mockReturnValue([
      {
        status: "provider_error",
        message: "Request to /pages/page-1 failed with 503",
      },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://x.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText("Request to /pages/page-1 failed with 503"),
    ).toBeTruthy();
    expect(screen.queryByText(/secret|token|bearer|api[_-]?key/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("on conflict: never overwrites silently — shows a distinct message and a reload action that calls router.refresh()", () => {
    mockUseActionState.mockReturnValue([
      { status: "conflict" },
      noopDispatch,
      false,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://x.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.getByText(
        "This value changed in Notion since it was loaded here.",
      ),
    ).toBeTruthy();
    const reloadButton = screen.getByRole("button", {
      name: "Reload the current value",
    });
    fireEvent.click(reloadButton);
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    // Conflict must never silently apply the draft — dispatch is only ever
    // called by an explicit Save, and no Save happened in this test.
    expect(noopDispatch).not.toHaveBeenCalled();
  });

  it("disables Save/Cancel while a save is pending, showing a clear pending label", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      true,
    ]);

    render(<NotionFieldEditor {...BASE_PROPS} value="https://x.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const savingButton = screen.getByRole("button", { name: "Saving…" });
    expect((savingButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("throws rather than guessing a control for an unsupported/unrecognized Notion field type — never silently renders the wrong control", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopDispatch,
      false,
    ]);
    // Deliberately outside NotionEditableFieldType's closed set — proves
    // the defensive exhaustiveness guard, never reachable from a real
    // NOTION_EDIT_ALLOWLIST entry (TypeScript already closes that off).
    const badFieldType =
      "people" as unknown as (typeof BASE_PROPS)["fieldType"];

    expect(() => {
      render(
        <NotionFieldEditor
          {...BASE_PROPS}
          fieldType={badFieldType}
          value={null}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    }).toThrow(/Unsupported Notion editable field type/);
  });
});
