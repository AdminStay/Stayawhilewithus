"use client";

import type {
  NotionContentBlock,
  NotionPageContent,
  NotionRichTextRun,
  NotionTextContentBlock,
} from "@stayw/integrations/notion";
import { Input } from "@stayw/ui";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  NotionPageContentActionState,
  UpdateNotionBlockActionInput,
  UpdateNotionBlockActionState,
} from "../actions";

import {
  NotionFetchedPageContent,
  type NotionFetchedPageContentState,
} from "./NotionBlockRenderer";
import { NotionDetailView } from "./NotionDetailView";

/**
 * One selectable entry in the clean SOP library list — exactly a real
 * top-level `toggle` or `child_page` block from the "SOPs" root page, never
 * a hard-coded title. Every other block type on that page (a stray
 * paragraph, a link preview, etc.) is deliberately excluded from this list
 * — a real, structural filter by Notion's own block TYPE, never a guess
 * about content or title.
 */
interface SopLibraryEntry {
  id: string;
  title: string;
  kind: "toggle" | "child_page";
}

function plainTextOf(runs: NotionRichTextRun[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * Extracts the real, ordered list of SOP entries from the SOPs root page's
 * own top-level blocks. Deliberately never deduplicates by title: real
 * read-only investigation (see HANDOFF.md) confirmed there is NO
 * deterministic structural link between a `toggle` SOP and a same-titled
 * `child_page` SOP (no page-mention, no `link_to_page` block, no shared
 * parent — checked across three real pairs) — several genuinely are the
 * same procedure represented twice in Notion's own structure, with no
 * exact signal to merge them by. Per explicit instruction, both are kept
 * rather than guessed at via fuzzy title matching.
 */
function extractSopEntries(blocks: NotionContentBlock[]): SopLibraryEntry[] {
  const entries: SopLibraryEntry[] = [];
  for (const block of blocks) {
    if (block.type === "toggle") {
      entries.push({
        id: block.id,
        title: plainTextOf(block.text) || "(untitled SOP)",
        kind: "toggle",
      });
    } else if (block.type === "child_page") {
      entries.push({ id: block.id, title: block.title, kind: "child_page" });
    }
  }
  return entries;
}

function findToggleBlock(
  blocks: NotionContentBlock[],
  id: string,
): NotionTextContentBlock | null {
  for (const block of blocks) {
    if (block.type === "toggle" && block.id === id) return block;
  }
  return null;
}

/**
 * The real "browse the whole operational SOP library, without knowing an
 * exact title" experience. Renders a clean, flat, filterable list of real
 * SOP titles — never Notion's raw 22-block tree dumped as-is — sourced
 * fresh from the "SOPs" root page's own top-level blocks on every page
 * load (server-fetched, see the /notion page). The filter box is a plain
 * client-side substring match over the already-fetched titles, NOT a
 * second provider search call: Notion's own `/search` never indexes a
 * `toggle` block as an independently searchable object (only whole pages
 * are searchable), so a toggle-only SOP would otherwise be undiscoverable
 * by keyword at all — this filter is what makes it findable.
 *
 * Selecting an entry opens the same detail dialog either way: for a
 * `child_page` entry, its real content is fetched on demand via the exact
 * same fetchNotionPageContentAction() flow already used for search results
 * (same sanitized-error/conflict/verification/audit guarantees, since it's
 * literally the same server action); for a `toggle` entry, its content was
 * already included in the one root read (no extra fetch, no loading
 * state) — its nested children are shown immediately.
 */
export function NotionSopLibrary({
  rootPageId,
  library,
  rootEditableBlockIds,
  fetchContentAction,
  updateBlockAction,
}: {
  /** The real "SOPs" root page's own id (NOTION_SOPS_ROOT_PAGE_ID) — structural plumbing an edit submission on one of its own (toggle-nested) blocks needs, never rendered. */
  rootPageId: string;
  /** The real "SOPs" root page's own content — already fetched server-side (see the /notion page). */
  library: NotionPageContent;
  /** Which of the root page's own blocks (e.g. a toggle's nested paragraph) this actor may edit — same UX-only hint as everywhere else; the real boundary is updateNotionBlockContent()'s own server-side check. */
  rootEditableBlockIds: string[];
  fetchContentAction: (pageId: string) => Promise<NotionPageContentActionState>;
  updateBlockAction: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
}) {
  const entries = useMemo(
    () => extractSopEntries(library.blocks),
    [library.blocks],
  );
  const [query, setQuery] = useState("");
  const [openEntry, setOpenEntry] = useState<SopLibraryEntry | null>(null);
  const [contentState, setContentState] =
    useState<NotionFetchedPageContentState>({ status: "idle" });

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.title.toLowerCase().includes(q));
  }, [entries, query]);

  function handleSelectEntry(entry: SopLibraryEntry) {
    setOpenEntry(entry);
    if (entry.kind === "child_page") {
      setContentState({ status: "loading" });
      fetchContentAction(entry.id).then(setContentState);
      return;
    }
    // A toggle's content is already fully present from the one root read —
    // no fetch, no loading state, no separate provider call.
    const toggleBlock = findToggleBlock(library.blocks, entry.id);
    setContentState({
      status: "success",
      content: {
        blocks: toggleBlock?.children ?? [],
        truncated: library.truncated,
      },
      editableBlockIds: rootEditableBlockIds,
    });
  }

  function handleClose() {
    setOpenEntry(null);
    setContentState({ status: "idle" });
  }

  // A toggle's nested blocks belong to the SOPs root page's own tree (that's
  // what an edit submission's page-membership check verifies against); a
  // child_page's blocks belong to that separate page instead.
  const editPageId =
    openEntry == null
      ? null
      : openEntry.kind === "toggle"
        ? rootPageId
        : openEntry.id;

  // Notion resolves either URL form correctly: a bare page id for a real
  // page, or a page id + block-id hash anchor to deep-link directly to a
  // specific block (the toggle) within a page — both are Notion's own
  // documented URL conventions, never guessed.
  const notionUrl =
    openEntry == null
      ? null
      : openEntry.kind === "child_page"
        ? `https://notion.so/${openEntry.id.replace(/-/g, "")}`
        : `https://notion.so/${rootPageId.replace(/-/g, "")}#${openEntry.id.replace(/-/g, "")}`;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No SOPs found on the connected SOPs page yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search/filter SOPs…"
          aria-label="Search SOPs"
          className="pl-8"
        />
      </div>

      {filteredEntries.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No SOPs match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleSelectEntry(entry)}
              className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              {entry.title}
            </button>
          ))}
        </div>
      )}

      {library.truncated && (
        <p className="text-xs italic text-ink-faint">
          The SOPs page has more content than shown here — open it in Notion to
          see everything.
        </p>
      )}

      <NotionDetailView
        open={openEntry != null}
        onClose={handleClose}
        title={openEntry?.title ?? ""}
        sections={[]}
        bodyContent={
          <NotionFetchedPageContent
            state={contentState}
            pageId={editPageId}
            updateBlockAction={updateBlockAction}
          />
        }
        lastEditedTime={null}
        notionUrl={notionUrl}
        propertyContext={null}
      />
    </div>
  );
}
