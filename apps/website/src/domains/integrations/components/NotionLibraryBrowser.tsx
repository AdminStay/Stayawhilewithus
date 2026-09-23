"use client";

import type { NotionLibraryEntry } from "@stayw/integrations/notion";
import { Input } from "@stayw/ui";
import { ChevronRight, Search } from "lucide-react";
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
import { isSafeHttpUrl } from "./notion-link.utils";

/** One step in the current drill-down path — never the root ("Library" itself, which has no id to fetch). */
interface NavStep {
  id: string;
  title: string;
}

/**
 * Real Notion titles in this workspace sometimes carry stray leading/
 * trailing whitespace (confirmed live, e.g. "Owner Info " and "Property
 * Lockboxes Code   ") — trimmed only for this component's own display and
 * matching, never mutated in what's sent back to any action or link.
 */
function displayTitle(title: string): string {
  return title.trim() || title;
}

function LibraryBreadcrumb({
  path,
  onRoot,
  onStep,
}: {
  path: NavStep[];
  onRoot: () => void;
  onStep: (index: number) => void;
}) {
  return (
    <nav
      aria-label="Library breadcrumb"
      className="flex flex-wrap items-center gap-1 text-sm"
    >
      <button
        type="button"
        onClick={onRoot}
        className="font-medium text-ink underline-offset-2 hover:underline"
      >
        Library
      </button>
      {path.map((step, index) => (
        <span key={step.id} className="flex items-center gap-1">
          <ChevronRight
            className="h-3.5 w-3.5 text-ink-faint"
            aria-hidden="true"
          />
          {index === path.length - 1 ? (
            <span className="font-medium text-ink">
              {displayTitle(step.title)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onStep(index)}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {displayTitle(step.title)}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * The real, browsable, NESTED "Notion Library" experience — item "Notion
 * Library nested browsing" (2026-09-24), Michelle's follow-up request.
 * Real-structure discovery (read-only, 2026-09-24) found several distinct
 * shapes among LIBRARY's own rows:
 *
 *  - "Property Directory" is a page whose own top-level content is nothing
 *    but ~46 `child_page` blocks, one per property (e.g. "🏡 Aloha by the
 *    Sea") — a second real Notion page each, fetched the same way as any
 *    SOP `child_page` entry.
 *  - A property's own page (Aloha confirmed as the proof case) is itself a
 *    mix of `toggle` blocks (content already inline, no extra fetch) and, in
 *    Aloha's case, one further nested `child_page` ("Frequently Asked
 *    Questions") — proving this can go more than one level deep.
 *  - "Service Providers List" similarly nests one level (a `child_page` per
 *    region, e.g. "SRQ PROPERTIES"), but each region's own page is flat
 *    (headings + tables, no further nesting).
 *  - "Property Lockboxes Code" and "Owner Info" are mostly flat pages
 *    (headings/tables and paragraphs/bulleted lists respectively), each
 *    with one or two of their own extra `child_page` entries.
 *
 * None of this required a new block type or a new Notion API call: every
 * shape found is already representable by the existing NotionContentBlock
 * union and already rendered correctly by NotionBlockList — the only real
 * gap was navigation. This component reuses NotionFetchedPageContent /
 * NotionBlockList exactly as SOPs and Search do, but wires `onOpenChildPage`
 * to push a breadcrumb step and fetch that child page's content in place —
 * recursively, to whatever depth Notion's own structure actually has —
 * instead of rendering child_page as a dead, non-clickable label.
 *
 * A drilled-in page's own child_page entries can be filtered by title (see
 * `nestedQuery`) — this is exactly what makes "Property Directory → Aloha
 * by the Sea" findable by typing "aloha" once inside Property Directory,
 * the missing piece the top-level Library filter alone could never provide
 * (Aloha isn't a top-level LIBRARY row, so it was never in `entries`).
 * Filtering only ever hides/shows `child_page` blocks — every other block
 * on the same page (a table of lockbox codes, a paragraph of owner info)
 * always renders in full regardless of the filter text, so a query never
 * hides real content, only narrows which child pages are listed.
 */
export function NotionLibraryBrowser({
  entries,
  fetchContentAction,
  updateBlockAction,
}: {
  /** The real LIBRARY database's own top-level entries — already fetched server-side (see the /notion page). title/id/url only. */
  entries: NotionLibraryEntry[];
  fetchContentAction: (pageId: string) => Promise<NotionPageContentActionState>;
  updateBlockAction: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
}) {
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<NavStep[]>([]);
  const [contentState, setContentState] =
    useState<NotionFetchedPageContentState>({ status: "idle" });
  const [nestedQuery, setNestedQuery] = useState("");

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      displayTitle(entry.title).toLowerCase().includes(q),
    );
  }, [entries, query]);

  function openPage(id: string, title: string) {
    setPath((prev) => [...prev, { id, title }]);
    setNestedQuery("");
    setContentState({ status: "loading" });
    fetchContentAction(id).then(setContentState);
  }

  function goToRoot() {
    setPath([]);
    setNestedQuery("");
    setContentState({ status: "idle" });
  }

  function goToStep(index: number) {
    const nextPath = path.slice(0, index + 1);
    const target = nextPath[nextPath.length - 1];
    if (!target) {
      goToRoot();
      return;
    }
    setPath(nextPath);
    setNestedQuery("");
    setContentState({ status: "loading" });
    fetchContentAction(target.id).then(setContentState);
  }

  const current = path[path.length - 1] ?? null;

  const totalChildPageCount =
    contentState.status === "success"
      ? contentState.content.blocks.filter((b) => b.type === "child_page")
          .length
      : 0;

  const trimmedNestedQuery = nestedQuery.trim().toLowerCase();

  // Only ever removes non-matching `child_page` blocks — every other block
  // type on the page (the real content: tables, paragraphs, toggles) is
  // always kept, so this can narrow which child pages are listed but can
  // never hide a page's own real content.
  const displayState: NotionFetchedPageContentState = useMemo(() => {
    if (contentState.status !== "success" || trimmedNestedQuery === "") {
      return contentState;
    }
    const filteredBlocks = contentState.content.blocks.filter(
      (b) =>
        b.type !== "child_page" ||
        displayTitle(b.title).toLowerCase().includes(trimmedNestedQuery),
    );
    return {
      ...contentState,
      content: { ...contentState.content, blocks: filteredBlocks },
    };
  }, [contentState, trimmedNestedQuery]);

  const visibleChildPageCount =
    displayState.status === "success"
      ? displayState.content.blocks.filter((b) => b.type === "child_page")
          .length
      : 0;

  const noNestedMatches =
    trimmedNestedQuery !== "" &&
    totalChildPageCount > 0 &&
    visibleChildPageCount === 0;

  const notionUrl = current
    ? `https://notion.so/${current.id.replace(/-/g, "")}`
    : null;

  if (entries.length === 0 && path.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No Library entries found yet — check that the LIBRARY database is shared
        with the StayWhile Notion integration.
      </p>
    );
  }

  if (path.length === 0) {
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
            placeholder="Search/filter Library…"
            aria-label="Search Library"
            className="pl-8"
          />
        </div>

        {filteredEntries.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No Library entries match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredEntries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => openPage(entry.id, entry.title)}
                  className="flex w-full items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {displayTitle(entry.title)}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-faint"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LibraryBreadcrumb path={path} onRoot={goToRoot} onStep={goToStep} />

      {totalChildPageCount > 0 && (
        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <Input
            value={nestedQuery}
            onChange={(e) => setNestedQuery(e.target.value)}
            placeholder={`Search within ${displayTitle(current?.title ?? "")}…`}
            aria-label={`Search ${displayTitle(current?.title ?? "")}`}
            className="pl-8"
          />
        </div>
      )}

      {noNestedMatches && (
        <p className="text-sm text-ink-muted">
          No pages match &ldquo;{nestedQuery.trim()}&rdquo; here.
        </p>
      )}

      <NotionFetchedPageContent
        state={displayState}
        pageId={current?.id ?? null}
        updateBlockAction={updateBlockAction}
        onOpenChildPage={openPage}
      />

      {notionUrl && isSafeHttpUrl(notionUrl) && (
        <a
          href={notionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Open in Notion
        </a>
      )}
    </div>
  );
}
