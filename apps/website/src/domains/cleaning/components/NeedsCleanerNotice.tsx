import { Badge } from "@stayw/ui";
import Link from "next/link";

import {
  NEEDS_CLEANER_DESCRIPTION,
  NEEDS_CLEANER_HREF,
  needsCleanerTitle,
} from "../lib/needs-cleaner";

/**
 * Cleaner Phase 5.3 — the "needs attention" notice at the top of /cleaning
 * for open jobs with no cleaner. Links between the filtered view
 * (/cleaning?view=needs-cleaner) and the full list. Display only: it
 * assigns nothing and sends nothing. Rendered only for viewers with
 * cleaners:read (the caller decides).
 */
export function NeedsCleanerNotice({
  count,
  filtered,
}: {
  count: number;
  /** True when the page is showing only the jobs that need a cleaner. */
  filtered: boolean;
}) {
  if (count === 0) {
    if (!filtered) return null;
    return (
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
      >
        <span className="text-ink">No cleaning jobs need attention.</span>
        <Link
          href="/cleaning"
          className="font-medium text-forest-700 hover:underline"
        >
          Show all cleanings
        </Link>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-warning-50 px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <Badge tone="warning">Needs cleaner</Badge>
        <span className="font-medium text-ink">{needsCleanerTitle(count)}</span>
        <span className="text-ink-muted">{NEEDS_CLEANER_DESCRIPTION}</span>
      </span>
      {filtered ? (
        <Link
          href="/cleaning"
          className="font-medium text-forest-700 hover:underline"
        >
          Show all cleanings
        </Link>
      ) : (
        <Link
          href={NEEDS_CLEANER_HREF}
          className="font-medium text-forest-700 hover:underline"
        >
          Show only these
        </Link>
      )}
    </div>
  );
}
