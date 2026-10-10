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
 * Staff/contact-directory exclusion for webhook events (2026-10-11 fix).
 *
 * The real webhook payload (developers.notion.com/reference/webhooks-events-
 * delivery) identifies where an entity lives with `data.parent: { id, type }`,
 * type "page" | "database" | "data_source" | "space" | "block". Under API
 * versions from 2025-09-03 (the subscription uses 2026-03-11) a database
 * ROW's parent is its DATA SOURCE (`type: "data_source"`), and database
 * content/schema changes arrive as `data_source.*` events whose entity IS the
 * data source. The excluded list holds DATABASE ids (the same ids "Search
 * Notion" excludes), so a data source is resolved to its parent database with
 * a read-only lookup before comparing. The older API-object shape
 * (`{ type: "database_id", database_id }`) is still recognized.
 *
 * Fail-closed:
 *   - "excluded"   → drop: belongs to an excluded database, OR its data
 *                    source's database can't be determined (the lookup
 *                    definitively returns null — e.g. the integration
 *                    can't read it), since it can't be proven not to be a
 *                    directory;
 *   - "unresolved" → the lookup failed for another reason (network/5xx):
 *                    store nothing and ask Notion to redeliver later;
 *   - "allowed"    → not in a database, or in a non-excluded one. The
 *                    default-sensitive visibility rules still apply after
 *                    storage, unchanged.
 * Only ids are compared — never titles or keywords.
 */
export type NotionWebhookExclusion = "excluded" | "allowed" | "unresolved";

/**
 * A data source's parent DATABASE id. Resolves null when Notion definitively
 * won't say (no access / not found / no database parent); throws on any other
 * failure.
 */
export type NotionDataSourceParentLookup = (
  dataSourceId: string,
) => Promise<string | null>;

type NotionContainerRef =
  { kind: "database"; id: string } | { kind: "data_source"; id: string };

const normalizeId = (id: string) => id.replace(/-/g, "").toLowerCase();
const EXCLUDED_DATABASE_KEYS = new Set(
  [...EXCLUDED_DATABASE_IDS].map(normalizeId),
);

function parentContainerRef(data: unknown): NotionContainerRef | null {
  if (typeof data !== "object" || data === null) return null;
  const parent = (data as Record<string, unknown>).parent;
  if (typeof parent !== "object" || parent === null) return null;
  const p = parent as Record<string, unknown>;
  // Webhook payload shape: { id, type }.
  if (typeof p.id === "string" && p.id) {
    if (p.type === "database") return { kind: "database", id: p.id };
    if (p.type === "data_source") return { kind: "data_source", id: p.id };
  }
  // Older API-object shape, still accepted defensively.
  if (p.type === "database_id" && typeof p.database_id === "string") {
    return { kind: "database", id: p.database_id };
  }
  if (p.type === "data_source_id" && typeof p.data_source_id === "string") {
    return { kind: "data_source", id: p.data_source_id };
  }
  return null;
}

/** The database or data source an event belongs to (or IS), if any. */
function eventContainerRef(
  event: NotionWebhookEvent,
): NotionContainerRef | null {
  switch (event.entity.type) {
    case "database":
      return { kind: "database", id: event.entity.id };
    case "data_source":
      return { kind: "data_source", id: event.entity.id };
    case "page":
    case "block":
      return parentContainerRef(event.data);
    default:
      // comment.* — not subscribed; sensitive-by-default display applies.
      return null;
  }
}

export async function resolveNotionWebhookExclusion(
  event: NotionWebhookEvent,
  lookupDataSourceParent: NotionDataSourceParentLookup,
): Promise<NotionWebhookExclusion> {
  const ref = eventContainerRef(event);
  if (!ref) return "allowed";

  let databaseId: string | null;
  if (ref.kind === "database") {
    databaseId = ref.id;
  } else {
    try {
      databaseId = await lookupDataSourceParent(ref.id);
    } catch {
      return "unresolved";
    }
    if (!databaseId) return "excluded";
  }
  return EXCLUDED_DATABASE_KEYS.has(normalizeId(databaseId))
    ? "excluded"
    : "allowed";
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
