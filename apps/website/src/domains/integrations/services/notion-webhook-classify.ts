import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";
import type { NotionWebhookEvent } from "../schemas/notion-webhook-event.schema";

const EXCLUDED_DATABASE_IDS = new Set(NOTION_SEARCH_EXCLUDED_DATABASE_IDS);

/**
 * The normalized, storage-ready shape of a classified event — deliberately
 * carries only ids/types/counts, never a Notion property or block VALUE
 * (Notion's own webhook payload doesn't send values either; see
 * NotionPageEvent's schema comment for why this isn't an omission).
 */
export interface NotionClassifiedEvent {
  notionEventId: string;
  entityId: string;
  entityType: NotionWebhookEvent["entity"]["type"];
  eventType: NotionWebhookEvent["type"];
  changedFieldNames: string[];
  occurredAt: Date;
  /** Notion's `authors` — ids and person/bot/agent types only (2026-09-30). */
  authors: Array<{ id: string; type: "person" | "bot" | "agent" }>;
  /** Where the entity lives, from `data.parent` (ids only); null if absent. */
  parent: NotionEventParent | null;
  attemptNumber: number | null;
}

/**
 * The event's own `data.parent` (webhook payload shape `{ id, type }`,
 * e.g. type "page" | "database" | "data_source" | "block" | "space").
 * Anything unrecognized is kept as "other" rather than guessed.
 */
export interface NotionEventParent {
  type: "page" | "database" | "data_source" | "block" | "workspace" | "other";
  id: string | null;
}

export function extractNotionEventParent(
  data: unknown,
): NotionEventParent | null {
  if (typeof data !== "object" || data === null) return null;
  const parent = (data as Record<string, unknown>).parent;
  if (typeof parent !== "object" || parent === null) return null;
  const p = parent as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : null;
  switch (p.type) {
    case "page":
    case "database":
    case "data_source":
    case "block":
      return { type: p.type, id };
    case "space":
    case "workspace":
      return { type: "workspace", id: null };
    default:
      return { type: "other", id };
  }
}

/**
 * `data.parent` follows Notion's standard parent-object shape used
 * throughout their API (`{ type: "database_id", database_id }` /
 * `{ type: "page_id", page_id }` / `{ type: "workspace", workspace: true }`)
 * — Notion's webhook-delivery docs confirm every page/database event's
 * `data` includes a `parent` field but do not show its literal JSON, so
 * this is inferred from their established object model, not guessed from
 * nothing. Deliberately defensive: any shape mismatch returns null rather
 * than throwing, since this only gates the search-exclusion check below,
 * never the base classification. **Re-verify against a real captured
 * payload before this ever backs a live subscription.**
 */
function extractParentDatabaseId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const parent = (data as Record<string, unknown>).parent;
  if (typeof parent !== "object" || parent === null) return null;
  const parentObj = parent as Record<string, unknown>;
  if (parentObj.type !== "database_id") return null;
  return typeof parentObj.database_id === "string"
    ? parentObj.database_id
    : null;
}

function extractChangedFieldNames(event: NotionWebhookEvent): string[] {
  const data = event.data;
  if (!data) return [];

  if (event.type === "page.properties_updated") {
    const updated = data.updated_properties;
    return Array.isArray(updated)
      ? updated.filter((v): v is string => typeof v === "string")
      : [];
  }

  if (event.type === "page.content_updated") {
    const blocks = data.updated_blocks;
    if (!Array.isArray(blocks)) return [];
    return blocks
      .map((b) =>
        typeof b === "object" && b !== null && "id" in b
          ? String((b as Record<string, unknown>).id)
          : null,
      )
      .filter((id): id is string => id !== null);
  }

  return [];
}

/**
 * True when the event belongs to (or, for a `database.*` event, IS) one of
 * the staff/contact-directory databases already excluded from VA search
 * (see notion-search-exclusions.ts) — reused here so a change to internal
 * contact info never surfaces in "Recent Notion Activity" either. Only
 * checked by real Notion database id, matching the same rule the search
 * feature already follows.
 */
export function isNotionWebhookEventExcluded(
  event: NotionWebhookEvent,
): boolean {
  if (event.entity.type === "database") {
    return EXCLUDED_DATABASE_IDS.has(event.entity.id);
  }
  if (event.entity.type === "page") {
    const parentDatabaseId = extractParentDatabaseId(event.data);
    return (
      parentDatabaseId !== null && EXCLUDED_DATABASE_IDS.has(parentDatabaseId)
    );
  }
  return false;
}

/**
 * Pure normalization — no I/O, no dedupe/storage decision (see
 * notion-webhook-event.service.ts for the orchestration that calls this).
 */
export function classifyNotionWebhookEvent(
  event: NotionWebhookEvent,
): NotionClassifiedEvent {
  return {
    notionEventId: event.id,
    entityId: event.entity.id,
    entityType: event.entity.type,
    eventType: event.type,
    changedFieldNames: extractChangedFieldNames(event),
    occurredAt: new Date(event.timestamp),
    authors: (event.authors ?? []).map((a) => ({ id: a.id, type: a.type })),
    parent: extractNotionEventParent(event.data),
    attemptNumber:
      typeof event.attempt_number === "number" ? event.attempt_number : null,
  };
}
