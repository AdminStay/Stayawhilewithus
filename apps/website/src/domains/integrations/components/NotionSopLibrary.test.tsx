// @vitest-environment jsdom
import type {
  NotionContentBlock,
  NotionPageContent,
} from "@stayw/integrations/notion";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotionSopLibrary } from "./NotionSopLibrary";

afterEach(cleanup);

const LAST_EDITED = "2026-09-23T00:00:00.000Z";

function run(text: string) {
  return { text, href: null, bold: false, italic: false, code: false };
}

const TOGGLE_SOP: NotionContentBlock = {
  id: "toggle-1",
  lastEditedTime: LAST_EDITED,
  type: "toggle",
  text: [run("SOP for VRBO & Direct Bookings")],
  children: [
    {
      id: "p1",
      lastEditedTime: LAST_EDITED,
      type: "paragraph",
      text: [run("Call the guest before arrival.")],
      children: [],
    },
  ],
};

const CHILD_PAGE_SOP: NotionContentBlock = {
  id: "child-page-1",
  lastEditedTime: LAST_EDITED,
  type: "child_page",
  title: "SOP for Internet",
};

// Deliberately NOT an SOP entry — a stray paragraph on the real SOPs page,
// same as the one real block Increment 131's discovery found there. Proves
// the library list is filtered by block TYPE, not "everything on the page".
const STRAY_PARAGRAPH: NotionContentBlock = {
  id: "stray-1",
  lastEditedTime: LAST_EDITED,
  type: "paragraph",
  text: [run("Some unrelated note.")],
  children: [],
};

const LIBRARY: NotionPageContent = {
  blocks: [TOGGLE_SOP, CHILD_PAGE_SOP, STRAY_PARAGRAPH],
  truncated: false,
};

const noopUpdateBlockAction = vi.fn();

describe("NotionSopLibrary", () => {
  it("lists real SOP titles for both toggle and child_page entries, excluding non-SOP blocks like a stray paragraph", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: "SOP for VRBO & Direct Bookings" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "SOP for Internet" }),
    ).toBeTruthy();
    expect(screen.queryByText("Some unrelated note.")).toBeNull();
  });

  it("does not dump the raw block tree — no content is visible before an entry is selected", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(screen.queryByText("Call the guest before arrival.")).toBeNull();
  });

  it("selecting a toggle-based SOP reveals its real content instantly, with no fetch call", () => {
    const fetchContentAction = vi.fn();
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "SOP for VRBO & Direct Bookings" }),
    );

    expect(screen.getByText("Call the guest before arrival.")).toBeTruthy();
    expect(fetchContentAction).not.toHaveBeenCalled();
  });

  it("selecting a child_page SOP fetches its real content on demand and displays it, with Open in Notion available", async () => {
    const fetchContentAction = vi.fn().mockResolvedValue({
      status: "success",
      content: {
        blocks: [
          {
            id: "p1",
            lastEditedTime: LAST_EDITED,
            type: "paragraph",
            text: [run("How to reset the router.")],
            children: [],
          },
        ],
        truncated: false,
      },
      editableBlockIds: [],
    });

    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "SOP for Internet" }));

    expect(fetchContentAction).toHaveBeenCalledWith("child-page-1");
    await waitFor(() => {
      expect(screen.getByText("How to reset the router.")).toBeTruthy();
    });
    expect(
      screen.getAllByRole("link", { name: "Open in Notion" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows a loading state only for a child_page fetch, never for a toggle", () => {
    const fetchContentAction = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "SOP for Internet" }));

    expect(screen.getByText("Loading content…")).toBeTruthy();
  });

  it("filters the entry list by a plain client-side substring match — never a second provider search call", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search SOPs"), {
      target: { value: "internet" },
    });

    expect(
      screen.getByRole("button", { name: "SOP for Internet" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "SOP for VRBO & Direct Bookings" }),
    ).toBeNull();
  });

  it("filters case-insensitively and finds a toggle-only SOP by a partial word — proving toggle-only SOPs are discoverable via this filter even though provider search can't find them", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search SOPs"), {
      target: { value: "VRBO" },
    });

    expect(
      screen.getByRole("button", { name: "SOP for VRBO & Direct Bookings" }),
    ).toBeTruthy();
  });

  it("shows a safe empty-filter message when no entry matches the query", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search SOPs"), {
      target: { value: "zzz-no-match" },
    });

    expect(screen.getByText(/No SOPs match/)).toBeTruthy();
  });

  it("keeps both entries when the same title appears as a toggle and a separate child_page — never silently merges/drops one", () => {
    const duplicateChildPage: NotionContentBlock = {
      id: "child-page-2",
      lastEditedTime: LAST_EDITED,
      type: "child_page",
      title: "SOP for VRBO & Direct Bookings",
    };
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={{ blocks: [TOGGLE_SOP, duplicateChildPage], truncated: false }}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "SOP for VRBO & Direct Bookings" })
        .length,
    ).toBe(2);
  });

  it("shows a safe empty-state message when the SOPs page has no toggle/child_page entries at all", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={{ blocks: [STRAY_PARAGRAPH], truncated: false }}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    expect(
      screen.getByText("No SOPs found on the connected SOPs page yet."),
    ).toBeTruthy();
  });

  it("never renders an Edit affordance for any real SOP block by default — rootEditableBlockIds is empty", () => {
    render(
      <NotionSopLibrary
        rootPageId="sops-root"
        library={LIBRARY}
        rootEditableBlockIds={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "SOP for VRBO & Direct Bookings" }),
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
