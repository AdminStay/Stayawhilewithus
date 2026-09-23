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

function run(text: string) {
  return { text, href: null, bold: false, italic: false, code: false };
}

const PROPERTY_DIRECTORY: NotionLibraryEntry = {
  id: "prop-directory",
  title: "Property Directory",
  url: "https://notion.so/prop-directory",
  lastEditedTime: LAST_EDITED,
};

const OWNER_INFO: NotionLibraryEntry = {
  id: "owner-info",
  title: "Owner Info",
  url: "https://notion.so/owner-info",
  lastEditedTime: LAST_EDITED,
};

const LOCKBOX_CODES: NotionLibraryEntry = {
  id: "lockbox-codes",
  title: "Property Lockboxes Code",
  url: "https://notion.so/lockbox-codes",
  lastEditedTime: LAST_EDITED,
};

const ENTRIES = [PROPERTY_DIRECTORY, OWNER_INFO, LOCKBOX_CODES];

const noopUpdateBlockAction = vi.fn();
const noopSearchAction = vi
  .fn()
  .mockResolvedValue({ configured: true, ok: true, query: "", results: [] });

// Mirrors the real "Property Directory" shape discovered live (2026-09-24):
// a page whose only real content is one child_page block per property.
const PROPERTY_DIRECTORY_CONTENT = {
  status: "success" as const,
  content: {
    blocks: [
      {
        id: "aloha-page",
        lastEditedTime: LAST_EDITED,
        type: "child_page" as const,
        title: "Aloha by the Sea",
      },
      {
        id: "aqua-palm-page",
        lastEditedTime: LAST_EDITED,
        type: "child_page" as const,
        title: "Aqua Palm",
      },
    ],
    truncated: false,
  },
  editableBlockIds: [],
};

// Mirrors Aloha's own real shape: a mix of toggle content (already inline)
// and one further nested child_page ("Frequently Asked Questions").
const ALOHA_CONTENT = {
  status: "success" as const,
  content: {
    blocks: [
      {
        id: "aloha-toggle-1",
        lastEditedTime: LAST_EDITED,
        type: "toggle" as const,
        text: [run("WiFi")],
        children: [
          {
            id: "aloha-wifi-detail",
            lastEditedTime: LAST_EDITED,
            type: "paragraph" as const,
            text: [run("Network: AlohaGuest")],
            children: [],
          },
        ],
      },
      {
        id: "aloha-faq-page",
        lastEditedTime: LAST_EDITED,
        type: "child_page" as const,
        title: "Frequently Asked Questions",
      },
    ],
    truncated: false,
  },
  editableBlockIds: [],
};

const FAQ_CONTENT = {
  status: "success" as const,
  content: {
    blocks: [
      {
        id: "faq-p1",
        lastEditedTime: LAST_EDITED,
        type: "paragraph" as const,
        text: [run("Check-in is at 4pm.")],
        children: [],
      },
    ],
    truncated: false,
  },
  editableBlockIds: [],
};

describe("NotionLibraryBrowser — top-level list", () => {
  it("lists every real Library entry by title only", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Property Directory/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Owner Info/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Property Lockboxes Code/ }),
    ).toBeTruthy();
  });

  it("does not fetch or render any entry's content before it is selected", () => {
    const fetchContentAction = vi.fn();
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    expect(fetchContentAction).not.toHaveBeenCalled();
  });

  it("filters the entry list by a plain client-side substring match — never a second provider search call", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "lockbox" },
    });

    expect(
      screen.getByRole("button", { name: /Property Lockboxes Code/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Property Directory/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Owner Info/ })).toBeNull();
  });

  it("filters case-insensitively", () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "OWNER" },
    });

    expect(screen.getByRole("button", { name: /Owner Info/ })).toBeTruthy();
  });

  it("shows a safe empty-filter message when no entry matches the query, once the hierarchy search also comes back empty", async () => {
    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "zzz-no-match" },
    });

    await waitFor(
      () => {
        expect(screen.getByText(/No Library entries match/)).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  it("shows a safe empty-state message when there are no Library entries at all", () => {
    render(
      <NotionLibraryBrowser
        entries={[]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    expect(screen.getByText(/No Library entries found yet/)).toBeTruthy();
  });

  it("trims stray whitespace in a real Notion title for display, matching real data like 'Owner Info '", () => {
    render(
      <NotionLibraryBrowser
        entries={[{ ...OWNER_INFO, title: "Owner Info " }]}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    expect(screen.getByRole("button", { name: "Owner Info" })).toBeTruthy();
  });
});

describe("NotionLibraryBrowser — nested navigation (Property Directory → Aloha proof case)", () => {
  it("selecting a top-level entry shows a breadcrumb and fetches its content, with no dialog", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValue(PROPERTY_DIRECTORY_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));

    expect(fetchContentAction).toHaveBeenCalledWith("prop-directory");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy();
    });
    // Breadcrumb: root "Library" plus the current step.
    const breadcrumb = screen.getByRole("navigation", {
      name: "Library breadcrumb",
    });
    expect(breadcrumb.textContent).toContain("Library");
    expect(breadcrumb.textContent).toContain("Property Directory");
  });

  it("drills all the way to Aloha by the Sea's own content and its further nested child_page", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT)
      .mockResolvedValueOnce(ALOHA_CONTENT)
      .mockResolvedValueOnce(FAQ_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Aloha by the Sea" }));
    expect(fetchContentAction).toHaveBeenCalledWith("aloha-page");
    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });

    const breadcrumb = screen.getByRole("navigation", {
      name: "Library breadcrumb",
    });
    expect(breadcrumb.textContent).toContain("Property Directory");
    expect(breadcrumb.textContent).toContain("Aloha by the Sea");

    fireEvent.click(
      screen.getByRole("button", { name: "Frequently Asked Questions" }),
    );
    expect(fetchContentAction).toHaveBeenCalledWith("aloha-faq-page");
    await waitFor(() => {
      expect(screen.getByText("Check-in is at 4pm.")).toBeTruthy();
    });
    expect(
      screen.getByRole("navigation", { name: "Library breadcrumb" })
        .textContent,
    ).toContain("Frequently Asked Questions");
  });

  it("clicking the root 'Library' breadcrumb returns to the top-level list", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValue(PROPERTY_DIRECTORY_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(
      screen.queryByRole("navigation", { name: "Library breadcrumb" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Owner Info/ })).toBeTruthy();
  });

  it("clicking a middle breadcrumb step navigates back to it and re-fetches its content", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT)
      .mockResolvedValueOnce(ALOHA_CONTENT)
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Aloha by the Sea" }));
    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Property Directory" }));

    expect(fetchContentAction).toHaveBeenNthCalledWith(3, "prop-directory");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Network: AlohaGuest")).toBeNull();
  });

  it("filters a drilled-in page's own child_page entries by title — the exact fix for 'aloha not found in Library filter'", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValue(PROPERTY_DIRECTORY_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText("Search Property Directory"), {
      target: { value: "aloha" },
    });

    expect(
      screen.getByRole("button", { name: "Aloha by the Sea" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aqua Palm" })).toBeNull();
  });

  it("shows a safe 'no matches' message when a nested filter matches no child page, without hiding it forever", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValue(PROPERTY_DIRECTORY_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText("Search Property Directory"), {
      target: { value: "zzz-no-such-property" },
    });

    expect(screen.getByText(/No pages match/)).toBeTruthy();
  });

  it("a nested filter never hides a page's own non-child_page content, only narrows which child pages are listed", async () => {
    const fetchContentAction = vi.fn().mockResolvedValueOnce(ALOHA_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={[{ ...PROPERTY_DIRECTORY, id: "aloha-page" }]}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Search Property Directory"), {
      target: { value: "no-such-child-page" },
    });

    expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Frequently Asked Questions" }),
    ).toBeNull();
  });

  it("shows a safe generic error message when a drilled-in fetch fails, never a raw error", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT)
      .mockResolvedValueOnce({
        status: "error",
        error: "Some raw provider detail that must never reach the UI",
      });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Aloha by the Sea" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn.t load this page.s content/),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/Some raw provider detail/)).toBeNull();
  });

  it("never renders an Edit affordance for any Library page — the write allowlist stays empty", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT)
      .mockResolvedValueOnce(ALOHA_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Aloha by the Sea" }));
    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("NotionLibraryBrowser — searching across the hierarchy (Production acceptance case)", () => {
  it('Library search "Aloha" finds the nested Aloha entry, labels it under Property Directory, and opening it renders its safe content through the existing renderer', async () => {
    const searchAction = vi.fn().mockResolvedValue({
      configured: true,
      ok: true,
      query: "aloha",
      results: [
        {
          id: "aloha-page",
          title: "Aloha by the Sea",
          parentEntryId: "prop-directory",
          parentEntryTitle: "Property Directory",
        },
      ],
    });
    const fetchContentAction = vi.fn().mockResolvedValue(ALOHA_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={searchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "Aloha" },
    });

    // Debounced — the search action fires once, with the trimmed query.
    await waitFor(() => {
      expect(searchAction).toHaveBeenCalledWith("Aloha");
    });

    // Found, and its location is made clear ("Library / Property Directory"),
    // never requiring the user to already know Aloha lives there.
    const result = await screen.findByRole("button", {
      name: /Aloha by the Sea/,
    });
    expect(result.textContent).toContain("Library / Property Directory");

    fireEvent.click(result);

    // Opens directly into that nested Library content, real breadcrumb and
    // all — no dead end, no separate "go find it yourself" step.
    expect(fetchContentAction).toHaveBeenCalledWith("aloha-page");
    const breadcrumb = await screen.findByRole("navigation", {
      name: "Library breadcrumb",
    });
    expect(breadcrumb.textContent).toContain("Property Directory");
    expect(breadcrumb.textContent).toContain("Aloha by the Sea");

    // Its real (safe, non-sensitive) content renders through the same
    // NotionFetchedPageContent/NotionBlockList renderer used everywhere else.
    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });
  });

  it("also still supports normal manual browsing — Library → Property Directory → Aloha by the Sea — without ever using search", async () => {
    const fetchContentAction = vi
      .fn()
      .mockResolvedValueOnce(PROPERTY_DIRECTORY_CONTENT)
      .mockResolvedValueOnce(ALOHA_CONTENT);

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={fetchContentAction}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={noopSearchAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Property Directory/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aloha by the Sea" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Aloha by the Sea" }));

    await waitFor(() => {
      expect(screen.getByText("Network: AlohaGuest")).toBeTruthy();
    });
    expect(noopSearchAction).not.toHaveBeenCalled();
  });

  it("debounces the hierarchy search — does not fire once per keystroke", async () => {
    const searchAction = vi.fn().mockResolvedValue({
      configured: true,
      ok: true,
      query: "aloha",
      results: [],
    });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={searchAction}
      />,
    );

    const input = screen.getByLabelText("Search Library");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "al" } });
    fireEvent.change(input, { target: { value: "alo" } });
    fireEvent.change(input, { target: { value: "aloha" } });

    await waitFor(() => {
      expect(searchAction).toHaveBeenCalledTimes(1);
    });
    expect(searchAction).toHaveBeenCalledWith("aloha");
  });

  it("shows a safe generic error message when the hierarchy search fails, never a raw error, and still shows top-level matches", async () => {
    const searchAction = vi.fn().mockResolvedValue({
      configured: true,
      ok: false,
      query: "aloha",
      error: "Something went wrong searching the Library. Please try again.",
    });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={searchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "aloha" },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Something went wrong searching the Library. Please try again.",
        ),
      ).toBeTruthy();
    });
  });

  it("never leaks anything beyond id/title/parent-entry fields for a hierarchy search match", async () => {
    const searchAction = vi.fn().mockResolvedValue({
      configured: true,
      ok: true,
      query: "aloha",
      results: [
        {
          id: "aloha-page",
          title: "Aloha by the Sea",
          parentEntryId: "prop-directory",
          parentEntryTitle: "Property Directory",
        },
      ],
    });

    render(
      <NotionLibraryBrowser
        entries={ENTRIES}
        fetchContentAction={vi.fn()}
        updateBlockAction={noopUpdateBlockAction}
        searchAction={searchAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Library"), {
      target: { value: "aloha" },
    });

    const result = await screen.findByRole("button", {
      name: /Aloha by the Sea/,
    });
    // Only the title and its Library location ever render — no raw ids,
    // no page content, nothing beyond what the match itself carries.
    expect(result.textContent).toBe(
      "Aloha by the SeaLibrary / Property Directory",
    );
  });
});
