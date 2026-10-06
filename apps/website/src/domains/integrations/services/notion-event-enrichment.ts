/**
 * Turns a classified Notion webhook event into a sanitized, human-readable
 * summary (2026-09-30, activity monitoring). Pure apart from injected
 * read-only Notion lookups, so it is fully testable with fake data.
 *
 * What it produces (layer B of the monitoring design — safe enrichment):
 *   - WHAT ACTION: from the event type;
 *   - WHERE: the page/database title and a breadcrumb up to its approved
 *     root (LIBRARY, SOPs, Property Listings);
 *   - WHO: display names from the Notion Users API — ONLY when Notion
 *     returns one (needs the integration's user-information capability);
 *     otherwise the name stays null and the UI says so honestly;
 *   - WHICH FIELDS: property NAMES for properties_updated, and counts.
 * It never reads or stores a property/block VALUE. Before→after values and
 * added/removed text need snapshots (layer C) and are not produced here.
 */
import type {
  NotionPageMetadata,
  NotionParentRef,
} from "@stayw/integrations/notion";

import {
  NOTION_LIBRARY_DATABASE_ID,
  sameNotionId,
  type NotionVisibility,
} from "../config/notion-visibility";

import type { NotionClassifiedEvent } from "./notion-webhook-classify";

export type NotionActivityAction =
  | "created"
  | "updated_properties"
  | "updated_content"
  | "moved"
  | "deleted"
  | "restored"
  | "locked"
  | "unlocked"
  | "schema_updated"
  | "commented"
  | "comment_updated"
  | "comment_deleted";

export function notionActivityAction(
  eventType: string,
): NotionActivityAction | null {
  const verb = eventType.split(".")[1] ?? "";
  if (eventType.startsWith("comment.")) {
    return verb === "created"
      ? "commented"
      : verb === "updated"
        ? "comment_updated"
        : verb === "deleted"
          ? "comment_deleted"
          : null;
  }
  switch (verb) {
    case "created":
      return "created";
    case "properties_updated":
      return "updated_properties";
    case "content_updated":
      return "updated_content";
    case "moved":
      return "moved";
    case "deleted":
      return "deleted";
    case "undeleted":
      return "restored";
    case "locked":
      return "locked";
    case "unlocked":
      return "unlocked";
    case "schema_updated":
      return "schema_updated";
    default:
      return null;
  }
}

export interface NotionEventActor {
  type: "person" | "bot" | "agent";
  /** Null when Notion did not provide a name — never guessed. */
  name: string | null;
}

export interface NotionEventDetails {
  version: 1;
  action: NotionActivityAction | null;
  title: string | null;
  /** Root first, e.g. ["Library", "Property Directory", "Palm Haven"] — excludes the page itself. */
  breadcrumb: string[];
  visibility: NotionVisibility;
  /** The top-level LIBRARY row this lives under, when any (drives notification rules). */
  libraryEntryId: string | null;
  actors: NotionEventActor[];
  /** Property NAMES that changed (properties_updated only); never values. */
  changedProperties: string[];
  changedCount: number;
  inTrash: boolean | null;
}

export interface NotionEnrichmentDeps {
  getPageMetadata(pageId: string): Promise<NotionPageMetadata>;
  getObjectParent(
    kind: "page" | "block" | "database",
    id: string,
  ): Promise<NotionParentRef>;
  getDatabaseTitle(databaseId: string): Promise<string | null>;
  getUserDisplayName(userId: string): Promise<string | null>;
  resolveVisibility(
    kind: "page" | "database",
    id: string,
  ): Promise<NotionVisibility>;
  sopRootPageId: string;
  listingsDatabaseIds: readonly string[];
}

const MAX_BREADCRUMB_DEPTH = 5;

const decode = (id: string) => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/** Maps webhook property ids (URL-encoded) to names; unknown ids are counted, not shown. */
export function propertyNamesFor(
  changedIds: readonly string[],
  namesById: Record<string, string>,
): string[] {
  const byDecoded = new Map(
    Object.entries(namesById).map(([id, name]) => [decode(id), name]),
  );
  const names: string[] = [];
  for (const id of changedIds) {
    const name = namesById[id] ?? byDecoded.get(decode(id));
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

async function breadcrumbFor(
  start: NotionParentRef,
  deps: NotionEnrichmentDeps,
): Promise<{ breadcrumb: string[]; libraryEntryId: string | null }> {
  const trail: string[] = [];
  let libraryEntryId: string | null = null;
  let current: NotionParentRef = start;
  let lastPageId: string | null = null;

  for (let depth = 0; depth < MAX_BREADCRUMB_DEPTH; depth++) {
    if (current.type === "database") {
      if (sameNotionId(current.id, NOTION_LIBRARY_DATABASE_ID)) {
        trail.unshift("Library");
        libraryEntryId = lastPageId;
      } else if (
        deps.listingsDatabaseIds.some((l) => sameNotionId(l, current.id!))
      ) {
        trail.unshift("Property Listings");
      } else {
        const t = await deps.getDatabaseTitle(current.id).catch(() => null);
        if (t) trail.unshift(t);
      }
      break;
    }
    if (current.type === "page") {
      if (sameNotionId(current.id, deps.sopRootPageId)) {
        trail.unshift("SOPs");
        break;
      }
      const meta = await deps.getPageMetadata(current.id);
      trail.unshift(meta.title);
      lastPageId = current.id;
      current = meta.parent;
      continue;
    }
    if (current.type === "block") {
      current = await deps.getObjectParent("block", current.id);
      continue;
    }
    break; // workspace / data_source / unknown
  }
  return { breadcrumb: trail, libraryEntryId };
}

const toApiParent = (p: NotionClassifiedEvent["parent"]): NotionParentRef => {
  if (!p || !p.id)
    return p?.type === "workspace"
      ? { type: "workspace", id: null }
      : { type: "unknown", id: null };
  if (
    p.type === "page" ||
    p.type === "database" ||
    p.type === "block" ||
    p.type === "data_source"
  ) {
    return { type: p.type, id: p.id };
  }
  return { type: "unknown", id: null };
};

/**
 * Best-effort: each lookup that fails leaves its field empty/null (and a
 * failed visibility resolution means "sensitive"), so a partial summary is
 * still stored — never an invented one.
 */
export async function buildNotionEventDetails(
  event: NotionClassifiedEvent,
  deps: NotionEnrichmentDeps,
): Promise<NotionEventDetails> {
  const action = notionActivityAction(event.eventType);

  // Comments are about a page; everything else about the entity itself.
  const subjectKind: "page" | "database" =
    event.entityType === "database" || event.entityType === "data_source"
      ? "database"
      : "page";
  const subjectId =
    event.entityType === "comment" &&
    event.parent?.type === "page" &&
    event.parent.id
      ? event.parent.id
      : event.entityId;

  let title: string | null = null;
  let inTrash: boolean | null = null;
  let namesById: Record<string, string> = {};
  let parentRef: NotionParentRef = toApiParent(event.parent);

  if (subjectKind === "page") {
    try {
      const meta = await deps.getPageMetadata(subjectId);
      title = meta.title;
      inTrash = meta.inTrash;
      namesById = meta.propertyNamesById;
      parentRef = meta.parent;
    } catch {
      // keep the webhook's own parent; title stays null
    }
  } else {
    title = await deps.getDatabaseTitle(subjectId).catch(() => null);
  }

  let breadcrumb: string[] = [];
  let libraryEntryId: string | null = null;
  try {
    ({ breadcrumb, libraryEntryId } = await breadcrumbFor(parentRef, deps));
  } catch {
    breadcrumb = [];
  }
  // A LIBRARY row itself: it is its own entry.
  if (
    parentRef.type === "database" &&
    sameNotionId(parentRef.id, NOTION_LIBRARY_DATABASE_ID)
  ) {
    libraryEntryId = subjectId;
  }

  const visibility = await deps
    .resolveVisibility(subjectKind, subjectId)
    .catch((): NotionVisibility => "sensitive");

  const actors: NotionEventActor[] = [];
  for (const author of event.authors.slice(0, 5)) {
    const name =
      author.type === "person"
        ? await deps.getUserDisplayName(author.id).catch(() => null)
        : null;
    actors.push({ type: author.type, name });
  }

  const changedProperties =
    action === "updated_properties"
      ? propertyNamesFor(event.changedFieldNames, namesById)
      : [];

  return {
    version: 1,
    action,
    title,
    breadcrumb,
    visibility,
    libraryEntryId,
    actors,
    changedProperties,
    changedCount: event.changedFieldNames.length,
    inTrash,
  };
}
