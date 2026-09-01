"use client";

import { Badge, Button, EmptyState, Input, StatusIndicator } from "@stayw/ui";
import { Search } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import type { NotionSearchState } from "../services/integrations.service";
import { isSafeHttpUrl } from "./notion-link.utils";

type ActionState = NotionSearchState | { status: "idle" };

const INITIAL_STATE: ActionState = { status: "idle" };

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
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [query, setQuery] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

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
                    className="rounded-lg border border-line-subtle p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">
                        {result.title}
                      </span>
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
                          className="text-forest-600 underline underline-offset-2 hover:text-forest-700"
                        >
                          Open in Notion
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </div>
  );
}
