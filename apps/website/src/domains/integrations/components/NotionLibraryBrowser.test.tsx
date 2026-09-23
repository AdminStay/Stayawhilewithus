// @vitest-environment jsdom
import type { NotionLibraryEntry } from "@stayw/integrations/notion";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotionLibraryBrowser } from "./NotionLibraryBrowser";

afterEach(cleanup);

const LAST_EDITED = "2026-09-23T00:00:00.000Z";

const PROPERTY_DIRECTORY: NotionLibraryEntry = {
  id: "entry-1",
  title: "Property Directory",
  url: "https://notion.so/entry-1",
  lastEditedTime: LAST_EDITED,
};

const OWNER_INFO: NotionLibraryEntry = {
  id: "entry-2",
  title: "Owner Info",
  url: "https://notion.so/entry-2",
  lastEditedTime: LAST_EDITED,
};

const LOCKBOX_CODES: NotionLibraryEntry = {
  id: "entry-3",
  title: "Property Lockboxes Code",
  url: "https://notion.so/entry-3",
  lastEditedTime: LAST_EDITED,
};

const ENTRIES = [PROPERTY_DIRECTORY, OWNER_INFO, LOCKBOX_CODES];

const noopUpdateBlockAction = vi.fn();

describe("NotionLibraryBrowser", () => {
  it("lists every real Library entry by title only", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Property Directory" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Owner Info" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Property Lockboxes Code" }),
    ).toBeTruthy();
  });

  it("does not fetch or render any entry's content before it is selected — a lockbox code is never present on load", () => {
    const fetchContentAction = vi.fn();
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(fetchContentAction).not.toHaveBeenCalled();
    expect(screen.queryByText(/[0-9]{4,}/)).toBeNull();
  });

  it("selecting an entry fetches its real content on demand via the same content action, and shows Open in Notion", async () => {
    const fetchContentAction = vi.fn().mockResolvedValue({
      status: "success",
      content: {
        blocks: [
          {
            id: "p1",
            lastEditedTime: LAST_EDITED,
            type: "paragraph",
            text: [
              {
                text: "123 Main St",
                href: null,
                bold: false,
                italic: false,
                code: false,
              },
            ],
            children: [],
          },
        ],
        truncated: false,
      },
      editableBlockIds: [],
    });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Property Directory" }));

    expect(fetchContentAction).toHaveBeenCalledWith("entry-1");
    await waitFor(() => {
      expect(screen.getByText("123 Main St")).toBeTruthy();
    });
    expect(
      screen.getAllByRole("link", { name: "Open in Notion" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows a loading state while an entry's content is being fetched", () => {
    const fetchContentAction = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Owner Info" }));

    expect(screen.getByText("Loading content…")).toBeTruthy();
  });

  it("filters the entry list by a plain client-side substring match — never a second provider search call", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "lockbox" },
    });

    expect(
      screen.getByRole("button", { name: "Property Lockboxes Code" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Property Directory" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Owner Info" })).toBeNull();
  });

  it("filters case-insensitively", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "OWNER" },
    });

    expect(screen.getByRole("button", { name: "Owner Info" })).toBeTruthy();
  });

  it("shows a safe empty-filter message when no entry matches the query", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "zzz-no-match" },
    });

    expect(screen.getByText(/No Library entries match/)).toBeTruthy();
  });

  it("shows a safe empty-state message when there are no Library entries at all, without implying a config error", () => {
    render(
      <NotionLibraryBrowser
        entries={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(screen.getByText(/No Library entries found yet/)).toBeTruthy();
  });

  it("never renders an Edit affordance for any entry by default — the write allowlist stays empty", async () => {
    const fetchContentAction = vi.fn().mockResolvedValue({
      status: "success",
      content: {
        blocks: [
          {
            id: "p1",
            lastEditedTime: LAST_EDITED,
            type: "paragraph",
            text: [
              {
                text: "Some content.",
                href: null,
                bold: false,
                italic: false,
                code: false,
              },
            ],
            children: [],
          },
        ],
        truncated: false,
      },
      editableBlockIds: [],
    });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Property Directory" }));

    await waitFor(() => {
      expect(screen.getByText("Some content.")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
