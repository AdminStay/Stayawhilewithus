/**
 * Recent Notion Activity view model (2026-09-30). Pure: turns a stored
 * event row (+ its sanitized enrichment) into one readable line —
 * "[Who] [did what] [where] — [what changed] — [when]" — for a specific
 * viewer. Never includes values or integration internals, and never a raw
 * Notion id: the only place an id appears is inside `notionUrl`, the
 * "Open in Notion" link (Phase 0, 2026-10-15), and only for rows this viewer
 * may see. Sensitive events are shown to viewers without notion:manage as
 * "a restricted Notion page", with no title, change details or link.
 */
import { notionPageUrl } from "../components/notion-link.utils";

import {
  ACTION_VERB,
  describeNotionActors,
  describeNotionChange,
  describeNotionLocation,
  UNKNOWN_EDITOR,
} from "./notion-activity-describe";
import {
  notionActivityAction,
  type NotionActivityAction,
  type NotionEventDetails,
} from "./notion-event-enrichment";

export const ACTION_LABEL: Record<NotionActivityAction, string> = {
  created: "Created",
  updated_properties: "Updated",
  updated_content: "Edited",
  moved: "Moved",
  deleted: "Moved to trash",
  restored: "Restored",
  locked: "Locked",
  unlocked: "Unlocked",
  schema_updated: "Structure changed",
  commented: "Comment",
  comment_updated: "Comment edited",
  comment_deleted: "Comment deleted",
};

export interface NotionActivityRow {
  id: string;
  /** The Notion page/database id. Used only to build `notionUrl`; never copied to the view. */
  entityId?: string | null;
  entityType: string;
  eventType: string;
  changedFieldNames: unknown;
  occurredAt: Date;
  /** When StayWhile received the event (notion_page_events.received_at). */
  receivedAt?: Date | null;
  details: unknown;
}

export interface NotionActivityView {
  id: string;
  action: NotionActivityAction | null;
  actionLabel: string;
  who: string;
  verb: string;
  where: string;
  change: string | null;
  occurredAt: Date;
  /** Stored receive time, shown as the exact timestamp (2026-10-11); null if missing. */
  receivedAt: Date | null;
  restricted: boolean;
  /** "Open in Notion" link, or null when this row must not link (see notionLinkFor). */
  notionUrl: string | null;
  /**
   * True for edits whose earlier values StayWhile never captured — always
   * the case today (no snapshots exist), so the UI says so instead of
   * implying a before→after it doesn't have.
   */
  earlierValueUnknown: boolean;
}

/** Edits that changed existing values (as opposed to create/move/trash/…). */
const VALUE_CHANGING_ACTIONS: ReadonlySet<NotionActivityAction> = new Set([
  "updated_properties",
  "updated_content",
]);

/**
 * Fail closed: link only an enriched (so its visibility is known), visible,
 * not-in-trash page or database whose id is well-formed. Data sources,
 * blocks and comments never link — their ids aren't page URLs.
 */
function notionLinkFor(
  row: NotionActivityRow,
  details: NotionEventDetails,
  action: NotionActivityAction | null,
  restricted: boolean,
): string | null {
  if (restricted) return null;
  if (row.entityType !== "page" && row.entityType !== "database") return null;
  if (details.inTrash === true || action === "deleted") return null;
  return notionPageUrl(row.entityId);
}

function readDetails(value: unknown): NotionEventDetails | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Partial<NotionEventDetails>;
  return d.version === 1 &&
    Array.isArray(d.breadcrumb) &&
    Array.isArray(d.actors)
    ? (d as NotionEventDetails)
    : null;
}

export function toNotionActivityView(
  row: NotionActivityRow,
  viewer: { canReadSensitive: boolean },
): NotionActivityView {
  const details = readDetails(row.details);
  const action = details?.action ?? notionActivityAction(row.eventType);
  const actionLabel = action ? ACTION_LABEL[action] : "Changed";
  const verb = action ? ACTION_VERB[action] : "changed";
  const noun =
    row.entityType === "database" || row.entityType === "data_source"
      ? "a Notion database"
      : "a Notion page";

  if (!details) {
    // Not enriched (older row, or Notion lookups failed): honest and generic.
    const count = Array.isArray(row.changedFieldNames)
      ? row.changedFieldNames.length
      : 0;
    return {
      id: row.id,
      action,
      actionLabel,
      who: UNKNOWN_EDITOR,
      verb,
      where: noun,
      change: count > 0 ? `${count} item${count > 1 ? "s" : ""} changed` : null,
      occurredAt: row.occurredAt,
      receivedAt: row.receivedAt ?? null,
      restricted: false,
      // Visibility is unknown without enrichment: never link.
      notionUrl: null,
      earlierValueUnknown:
        action !== null && VALUE_CHANGING_ACTIONS.has(action),
    };
  }

  const restricted =
    details.visibility === "sensitive" && !viewer.canReadSensitive;
  return {
    id: row.id,
    action,
    actionLabel,
    who: describeNotionActors(details.actors, details.additionalActors ?? 0),
    verb,
    where: restricted
      ? "a restricted Notion page"
      : describeNotionLocation(details),
    change: restricted ? null : describeNotionChange(details),
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt ?? null,
    restricted,
    notionUrl: notionLinkFor(row, details, action, restricted),
    earlierValueUnknown:
      !restricted && action !== null && VALUE_CHANGING_ACTIONS.has(action),
  };
}

/** "just now", "3 minutes ago", "2 hours ago", "4 days ago". */
export function relativeTime(date: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
