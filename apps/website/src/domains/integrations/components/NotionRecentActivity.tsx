import { Badge, Card, SectionHeader, type Tone } from "@stayw/ui";

import { relativeTime } from "../services/notion-activity-view";
import type { NotionActivityView } from "../services/notion-activity.service";
import type { NotionActivityAction } from "../services/notion-event-enrichment";

import { isSafeHttpUrl } from "./notion-link.utils";

import {
  formatExactTimestamp,
  formatTimestamp,
} from "@/domains/smart-devices/lib/format-timestamp";

const ACTION_TONE: Partial<Record<NotionActivityAction, Tone>> = {
  deleted: "error",
  moved: "warning",
  restored: "success",
  created: "info",
};

/**
 * Recent Notion Activity (2026-09-30): one readable line per change made
 * directly in Notion — "[Who] [did what] [where] — [what changed] — [when]".
 * Server component; items arrive already redacted for this viewer (see
 * notion-activity-view.ts) and never carry values or raw Notion ids — only
 * an "Open in Notion" link for rows the viewer may see (Phase 0,
 * 2026-10-15). The dashboard stays read-only: edits happen in Notion.
 */
export function NotionRecentActivity({
  items,
  now = new Date(),
}: {
  items: NotionActivityView[];
  now?: Date;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        No Notion changes have been recorded yet.
      </p>
    );
  }

  return (
    <div>
      <SectionHeader
        title="Recent Notion Activity"
        description="Changes made directly in Notion. Field names are shown; values are not."
        size="lg"
      />
      <Card noPadding>
        <ul className="divide-y divide-border">
          {items.map((item) => {
            // Exact stored receive time with seconds, America/Chicago
            // (StayWhile's operating timezone); omitted if missing/invalid.
            const received = formatExactTimestamp(item.receivedAt);
            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      (item.action && ACTION_TONE[item.action]) || "neutral"
                    }
                  >
                    {item.actionLabel}
                  </Badge>
                  <span className="text-sm text-ink">
                    <span className="font-medium">{item.who}</span> {item.verb}{" "}
                    <span className="font-medium">{item.where}</span>
                  </span>
                  {item.restricted && <Badge tone="neutral">Restricted</Badge>}
                </div>
                {item.change && (
                  <p className="mt-1 text-xs text-ink-muted">{item.change}</p>
                )}
                {item.earlierValueUnknown && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Earlier value unknown
                  </p>
                )}
                <p
                  className="mt-1 text-xs text-ink-faint"
                  title={formatTimestamp(item.occurredAt)}
                >
                  {relativeTime(item.occurredAt, now)}
                </p>
                {received && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Received {received}
                  </p>
                )}
                {item.notionUrl && isSafeHttpUrl(item.notionUrl) && (
                  <a
                    href={item.notionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    Open in Notion
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
