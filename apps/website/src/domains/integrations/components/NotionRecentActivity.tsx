import { Badge, EmptyState, SectionHeader } from "@stayw/ui";
import { Activity } from "lucide-react";

import type { NotionActivityItem } from "../services/notion-activity.service";

import { formatTimestamp } from "@/domains/smart-devices/lib/format-timestamp";

/**
 * Human-readable label for a raw Notion webhook `type` (e.g.
 * "page.properties_updated") — never a changed VALUE, only what kind of
 * change happened. Falls back to the raw type string for any event type
 * added to Notion's platform after this list was last updated, rather than
 * hiding the row.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  "page.created": "Page created",
  "page.content_updated": "Page content changed",
  "page.properties_updated": "Page properties changed",
  "page.moved": "Page moved",
  "page.deleted": "Page deleted",
  "page.undeleted": "Page restored",
  "page.locked": "Page locked",
  "page.unlocked": "Page unlocked",
  "database.created": "Database created",
  "database.content_updated": "Database content changed",
  "database.schema_updated": "Database schema changed",
  "database.moved": "Database moved",
  "database.deleted": "Database deleted",
  "database.undeleted": "Database restored",
  "data_source.created": "Data source created",
  "data_source.content_updated": "Data source content changed",
  "data_source.schema_updated": "Data source schema changed",
  "data_source.moved": "Data source moved",
  "data_source.deleted": "Data source deleted",
  "data_source.undeleted": "Data source restored",
  "comment.created": "Comment added",
  "comment.updated": "Comment edited",
  "comment.deleted": "Comment deleted",
};

function labelForEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

/**
 * Purely presentational, read-only — mirrors NotionListingsSearch/
 * NotionSearch's own "no write/mutation affordance anywhere" rule. Renders
 * NotionActivityItem rows exactly as the service already reduced them:
 * event type label, entity type, a changed-field COUNT (never names or
 * values), and a Chicago-timezone timestamp via the same formatTimestamp()
 * already used on /thermostats and /locks, to avoid the same
 * server/client hydration mismatch that fix addressed there.
 */
export function NotionRecentActivity({
  items,
}: {
  items: NotionActivityItem[];
}) {
  return (
    <div className="space-y-3">
      <SectionHeader
        title="Recent Notion Activity"
        description="Changes detected on shared Notion content. Values are never shown here — open the item in Notion for details."
        size="lg"
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No recent activity"
          description="Notion change monitoring isn't active in Production yet — this section will populate once it is."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-line-subtle p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">
                  {labelForEventType(item.eventType)}
                </span>
                <Badge tone="neutral">{item.entityType}</Badge>
                {item.changedFieldCount > 0 && (
                  <Badge tone="neutral">
                    {item.changedFieldCount} field
                    {item.changedFieldCount === 1 ? "" : "s"} changed
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                {formatTimestamp(item.occurredAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
