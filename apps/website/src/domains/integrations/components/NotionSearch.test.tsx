// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as DiscoverDevicesButton.test.tsx: jsdom does not correctly
// emulate the browser's real click-to-submit / requestSubmit() path that
// React's <form action={fn}> (useActionState) interception relies on, so
// useActionState is mocked directly (every other React export stays real)
// to test what this component actually controls — rendering per state and
// disabled={isPending}/query-empty wiring — without depending on jsdom's
// incomplete form-submission emulation.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});

import { NotionSearch } from "./NotionSearch";

afterEach(cleanup);

const noopFormAction = vi.fn();

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement | HTMLInputElement).disabled;
}

describe("NotionSearch", () => {
  it("shows idle guidance and a disabled Search button before anything is typed", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(
      screen.getByText(/Type a property name, procedure, keyword/),
    ).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "Search" }))).toBe(
      true,
    );
  });

  it("enables the Search button once text is typed into the query field", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    const input = screen.getByLabelText("Search Notion");
    fireEvent.change(input, { target: { value: "pool" } });

    expect(isDisabled(screen.getByRole("button", { name: "Search" }))).toBe(
      false,
    );
  });

  it("shows a pending message and disables Search/Clear while isPending is true", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      true,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(screen.getByText("Searching Notion…")).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "Searching…" }))).toBe(
      true,
    );
    expect(isDisabled(screen.getByRole("button", { name: "Clear" }))).toBe(
      true,
    );
  });

  it("shows the not-connected message when Notion isn't configured", () => {
    mockUseActionState.mockReturnValue([
      { configured: false },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(
      screen.getByText(/Not connected — set NOTION_API_KEY to enable\./),
    ).toBeTruthy();
  });

  it("shows the error message and a Retry button on failure, without exposing a stack trace", () => {
    mockUseActionState.mockReturnValue([
      {
        configured: true,
        ok: false,
        query: "pool",
        error: "Request to /search failed with 401",
      },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(
      screen.getByText("Search failed — Request to /search failed with 401"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows the no-results empty state when a search succeeds with zero results", () => {
    mockUseActionState.mockReturnValue([
      { configured: true, ok: true, query: "zzz", results: [] },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(screen.getByText("No results")).toBeTruthy();
    expect(screen.getByText("0 results for “zzz”")).toBeTruthy();
  });

  it("renders a result card's title, content type, region badge, snippet, last-edited date, and safe link", () => {
    mockUseActionState.mockReturnValue([
      {
        configured: true,
        ok: true,
        query: "moonlit",
        results: [
          {
            id: "1",
            title: "Moonlit Cove",
            url: "https://notion.so/1",
            lastEditedTime: "2026-08-04T00:00:00.000Z",
            contentType: "Property listing",
            region: "SRQ",
            snippet: "123 Main St",
          },
        ],
      },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.getByText("Property listing")).toBeTruthy();
    expect(screen.getByText("SRQ")).toBeTruthy();
    expect(screen.getByText("123 Main St")).toBeTruthy();
    expect(screen.getByText(/Last edited/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open in Notion" });
    expect(link.getAttribute("href")).toBe("https://notion.so/1");
  });

  it("never renders a link for a result whose url is not a safe http(s) URL", () => {
    mockUseActionState.mockReturnValue([
      {
        configured: true,
        ok: true,
        query: "test",
        results: [
          {
            id: "1",
            title: "Weird Result",
            url: "javascript:alert(1)",
            lastEditedTime: null,
            contentType: "Notion page",
            region: null,
            snippet: null,
          },
        ],
      },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(screen.queryByRole("link", { name: "Open in Notion" })).toBeNull();
  });

  it("does not render a region badge or snippet when neither is available", () => {
    mockUseActionState.mockReturnValue([
      {
        configured: true,
        ok: true,
        query: "sop",
        results: [
          {
            id: "1",
            title: "Cleaning SOP",
            url: "https://notion.so/1",
            lastEditedTime: null,
            contentType: "Notion page",
            region: null,
            snippet: null,
          },
        ],
      },
      noopFormAction,
      false,
    ]);

    render(<NotionSearch action={vi.fn()} />);

    expect(screen.getByText("Cleaning SOP")).toBeTruthy();
    expect(screen.getByText("Notion page")).toBeTruthy();
    expect(screen.queryByText("SRQ")).toBeNull();
  });

  it("passes the given action straight through to useActionState with the idle initial state", () => {
    mockUseActionState.mockReturnValue([
      { status: "idle" },
      noopFormAction,
      false,
    ]);
    const action = vi.fn();

    render(<NotionSearch action={action} />);

    expect(mockUseActionState).toHaveBeenCalledWith(action, { status: "idle" });
  });
});
