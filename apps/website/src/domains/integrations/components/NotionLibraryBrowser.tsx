"use client";

import type { NotionLibraryEntry } from "@stayw/integrations/notion";
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
 * The real, browsable "Notion Library" experience — item "Notion Library"
 * (2026-09-24), Michelle's request. Structurally mirrors NotionSopLibrary
 * (the same clean filterable-list + detail-dialog pattern, the same
 * NotionDetailView/NotionFetchedPageContent renderer), but simpler: every
 * LIBRARY entry IS a real, separate Notion page (never a `toggle` whose
 * content already arrived with the list), so every selection is fetched on
 * demand via the exact same fetchContentAction() flow already proven for
 * SOPs' own `child_page` entries and general search results — same
 * sanitized-error/conflict/verification/audit guarantees, since it's
 * literally the same server action.
 *
 * Deliberately separate from NotionSopLibrary rather than a shared
 * component with a mode flag: the two sources differ in kind (a single
 * page's own top-level blocks vs. a database's rows), and forcing one
 * component to branch on that would obscure both, not simplify either.
 *
 * Never renders a LIBRARY entry's own page content until the authorized
 * user actually opens it — the list itself only ever shows titles (see
 * NotionLibraryEntry / listNotionLibraryEntries()), so nothing from a
 * page's body (where a lockbox code or owner detail might actually live)
 * is ever fetched, logged, or rendered until that specific authorized
 * click.
 */
export function NotionLibraryBrowser({
  entries,
  fetchContentAction,
  updateBlockAction,
}: {
  /** The real LIBRARY database's own top-level entries — already fetched server-side (see the /notion page), title/id/url only. */
  entries: NotionLibraryEntry[];
  fetchContentAction: (pageId: string) => Promise<NotionPageContentActionState>;
  updateBlockAction: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
}) {
  const [query, setQuery] = useState("");
  const [openEntry, setOpenEntry] = useState<NotionLibraryEntry | null>(null);
  const [contentState, setContentState] =
    useState<NotionFetchedPageContentState>({ status: "idle" });

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.title.toLowerCase().includes(q));
  }, [entries, query]);

  function handleSelectEntry(entry: NotionLibraryEntry) {
    setOpenEntry(entry);
    setContentState({ status: "loading" });
    fetchContentAction(entry.id).then(setContentState);
  }

  function handleClose() {
    setOpenEntry(null);
    setContentState({ status: "idle" });
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No Library entries found yet — check that the LIBRARY database is shared
        with the StayWhile Notion integration.
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

      <NotionDetailView
        open={openEntry != null}
        onClose={handleClose}
        title={openEntry?.title ?? ""}
        sections={[]}
        bodyContent={
          <NotionFetchedPageContent
            state={contentState}
            pageId={openEntry?.id ?? null}
            updateBlockAction={updateBlockAction}
          />
        }
        lastEditedTime={openEntry?.lastEditedTime ?? null}
        notionUrl={openEntry?.url ?? null}
        propertyContext={null}
      />
    </div>
  );
}
