"use client";

import { Badge, Button, EmptyState, Input, StatusIndicator } from "@stayw/ui";
import { Search } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import type { NotionPageContentActionState } from "../actions";
import type {
  NotionSearchResultCard,
  NotionSearchState,
} from "../services/integrations.service";

import { NotionBlockList } from "./NotionBlockRenderer";
import { NotionDetailView } from "./NotionDetailView";
import { isSafeHttpUrl } from "./notion-link.utils";

type ActionState = NotionSearchState | { status: "idle" };

const INITIAL_STATE: ActionState = { status: "idle" };

// A "Property listing" match already has its own richer, field-based detail
// view elsewhere (see NotionListingsSearch/notion-detail-sections.ts) — its
// real content isn't page-body blocks the way an SOP/general page's is, so
// fetching getPageContent() for one would be a wasted call. "Notion
// database" (the database object itself, e.g. "LIBRARY") has no page body
// of its own either. Only an individual page or database row's real content
// is fetched here.
const CONTENT_FETCHABLE_TYPES = new Set(["Notion page", "Database row"]);

type PageContentViewState =
  { status: "idle" } | { status: "loading" } | NotionPageContentActionState;

/**
 * The single, VA-facing "Search Notion" experience — one query, submitted
 * (Enter or the Search button, never per-keystroke) via a Server Action that
 * runs a real, server-side, read-only search against exactly what's shared
 * with the StayWhile Notion integration (see searchNotionContent() in
 * integrations.service.ts). No page/block content is ever fetched or
 * rendered here — only the minimal title/snippet/type/region/last-edited/
 * link fields the service already reduced results to. Strictly read-only:
 * no form or action anywhere in this component writes to Notion.
 */
export function NotionSearch({
  action,
  fetchContentAction,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  /** Fetches one result's real page-body content on demand — see fetchNotionPageContentAction's own doc comment for why this is a plain callable action, not a useActionState-bound form. Passed down from the page (a Server Component) rather than imported directly, same "use server" module-boundary reason as every other action prop in this domain. */
  fetchContentAction: (pageId: string) => Promise<NotionPageContentActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [query, setQuery] = useState("");
  const [openResult, setOpenResult] = useState<NotionSearchResultCard | null>(
    null,
  );
  const [contentState, setContentState] = useState<PageContentViewState>({
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);

  function handleOpenResult(result: NotionSearchResultCard) {
    setOpenResult(result);
    if (!CONTENT_FETCHABLE_TYPES.has(result.contentType)) {
      setContentState({ status: "idle" });
      return;
    }
    setContentState({ status: "loading" });
    fetchContentAction(result.id).then(setContentState);
  }

  function handleCloseResult() {
    setOpenResult(null);
    setContentState({ status: "idle" });
  }

  // Reuses the exact same "submit with an empty query" path the schema
  // already treats as idle (see searchNotionAction) — clearing the box and
  // resubmitting is what actually clears the last shown result set, rather
  // than a second, separate piece of "hide the results" client state that
  // could drift out of sync with what the server actually returned.
  function handleClear() {
    setQuery("");
    formRef.current?.requestSubmit();
  }

  function handleRetry() {
    formRef.current?.requestSubmit();
  }

  const isIdle = !("configured" in state);

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-wrap items-center gap-2"
      >
        <Input
          name="query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search property, procedure, guidebook, instruction, keyword…"
          aria-label="Search Notion"
          className="max-w-md flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={isPending || query.trim() === ""}
        >
          {isPending ? "Searching…" : "Search"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleClear}
          disabled={isPending}
        >
          Clear
        </Button>
      </form>

      {isPending && <p className="text-sm text-ink-muted">Searching Notion…</p>}

      {!isPending && isIdle && (
        <p className="text-sm text-ink-muted">
          Type a property name, procedure, keyword, or topic above and press
          Search.
        </p>
      )}

      {!isPending && !isIdle && "configured" in state && !state.configured && (
        <StatusIndicator
          label="Not connected — set NOTION_API_KEY to enable."
          tone="neutral"
        />
      )}

      {!isPending &&
        !isIdle &&
        "configured" in state &&
        state.configured &&
        !state.ok && (
          <div className="space-y-2">
            <StatusIndicator
              label={`Search failed — ${state.error}`}
              tone="error"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        )}

      {!isPending &&
        !isIdle &&
        "configured" in state &&
        state.configured &&
        state.ok && (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              {state.results.length} result
              {state.results.length === 1 ? "" : "s"} for &ldquo;{state.query}
              &rdquo;
            </p>

            {state.results.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No results"
                description="Try a different name, keyword, or topic."
              />
            ) : (
              <ul className="space-y-2">
                {state.results.map((result) => (
                  <li
                    key={result.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenResult(result)}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {result.title}
                      </button>
                      <Badge tone="neutral">{result.contentType}</Badge>
                      {result.region && (
                        <Badge tone="success">{result.region}</Badge>
                      )}
                    </div>
                    {result.snippet && (
                      <p className="mt-1 text-sm text-ink-muted">
                        {result.snippet}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                      {result.lastEditedTime && (
                        <span>
                          Last edited{" "}
                          {new Date(result.lastEditedTime).toLocaleDateString()}
                        </span>
                      )}
                      {result.url && isSafeHttpUrl(result.url) && (
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-muted underline underline-offset-2 hover:text-ink"
                        >
                          Open in Notion
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <NotionDetailView
              open={openResult != null}
              onClose={handleCloseResult}
              title={openResult?.title ?? ""}
              region={openResult?.region ?? null}
              sections={
                openResult?.snippet
                  ? [
                      {
                        layout: "list",
                        fields: [
                          {
                            key: "snippet",
                            label: "Preview",
                            value: openResult.snippet,
                          },
                        ],
                      },
                    ]
                  : []
              }
              bodyContent={<PageContentBody state={contentState} />}
              lastEditedTime={openResult?.lastEditedTime ?? null}
              notionUrl={openResult?.url ?? null}
              propertyContext={null}
            />
          </div>
        )}
    </div>
  );
}

/**
 * The body-content area of a result's detail dialog: a loading indicator
 * while getPageContent() is in flight, a safe error message on a real read
 * failure (never a raw error/stack), the real rendered blocks on success
 * (via NotionBlockList — see that component for the supported-block/
 * fallback rules), and, when the read was cut off by getPageContent()'s own
 * depth/call-budget safety caps, an honest "not everything is shown here"
 * note rather than presenting a partial page as complete. Renders nothing
 * for a result type with no page-body content to fetch (see
 * CONTENT_FETCHABLE_TYPES) or before a result has been opened at all.
 */
function PageContentBody({ state }: { state: PageContentViewState }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return <p className="text-sm text-ink-muted">Loading content…</p>;
  }

  if (state.status === "not_configured") {
    return null;
  }

  if (state.status === "error") {
    return (
      <p className="text-sm text-error-500">
        Couldn&apos;t load this page&apos;s content. You can still open it
        directly in Notion below.
      </p>
    );
  }

  const { content } = state;
  return (
    <div className="space-y-3 border-b border-border pb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Content
      </h3>
      {content.blocks.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No readable content on this page yet.
        </p>
      ) : (
        <NotionBlockList blocks={content.blocks} />
      )}
      {content.truncated && (
        <p className="text-xs italic text-ink-faint">
          This page has more content than shown here — open it in Notion to see
          everything.
        </p>
      )}
    </div>
  );
}
