/**
 * Resolves a Notion page's visibility level (2026-09-30) by walking up its
 * real parent chain to an approved root — see config/notion-visibility.ts
 * for the rules. Pure apart from the injected parent lookup, so it is fully
 * testable with fake Notion data. Every uncertainty fails closed to
 * "sensitive": an unknown root, a lookup error, a depth overrun, or an
 * exhausted lookup budget.
 */
import type { NotionParentRef } from "@stayw/integrations/notion";

import {
  isForcedSensitivePage,
  isKnownLibraryEntry,
  libraryEntryVisibility,
  NOTION_LIBRARY_DATABASE_ID,
  sameNotionId,
  type NotionVisibility,
} from "../config/notion-visibility";

export type NotionObjectKind = "page" | "block" | "database";

export type NotionParentLookup = (
  kind: NotionObjectKind,
  id: string,
) => Promise<NotionParentRef>;

export interface NotionVisibilityRoots {
  sopRootPageId: string;
  /** "View of Listings" database id(s), when known. */
  listingsDatabaseIds: readonly string[];
}

export const NOTION_VISIBILITY_MAX_DEPTH = 8;

export async function resolveNotionVisibility(
  start: { kind: NotionObjectKind; id: string },
  lookup: NotionParentLookup,
  roots: NotionVisibilityRoots,
): Promise<NotionVisibility> {
  const isListingsDb = (id: string) =>
    roots.listingsDatabaseIds.some((l) => sameNotionId(l, id));
  let current = start;

  for (let depth = 0; depth <= NOTION_VISIBILITY_MAX_DEPTH; depth++) {
    if (current.kind !== "block" && isForcedSensitivePage(current.id)) {
      return "sensitive";
    }
    if (current.kind === "page") {
      if (sameNotionId(current.id, roots.sopRootPageId)) return "standard";
      if (isKnownLibraryEntry(current.id)) {
        return libraryEntryVisibility(current.id);
      }
    }
    if (current.kind === "database") {
      if (sameNotionId(current.id, NOTION_LIBRARY_DATABASE_ID))
        return "standard";
      if (isListingsDb(current.id)) return "standard";
      return "sensitive";
    }

    let parent: NotionParentRef;
    try {
      parent = await lookup(current.kind, current.id);
    } catch {
      return "sensitive";
    }

    switch (parent.type) {
      case "database":
        if (sameNotionId(parent.id, NOTION_LIBRARY_DATABASE_ID)) {
          // `current` is a LIBRARY row; a row not in the config is new/unknown.
          return libraryEntryVisibility(current.id);
        }
        return isListingsDb(parent.id) ? "standard" : "sensitive";
      case "page":
        current = { kind: "page", id: parent.id };
        break;
      case "block":
        current = { kind: "block", id: parent.id };
        break;
      default:
        // workspace root, a bare data_source, or an unrecognized shape
        return "sensitive";
    }
  }
  return "sensitive";
}

/** Whether an actor with these permissions may see content at this level. */
export function canViewNotionVisibility(
  visibility: NotionVisibility,
  access: { canReadStandard: boolean; canReadSensitive: boolean },
): boolean {
  return visibility === "standard"
    ? access.canReadStandard || access.canReadSensitive
    : access.canReadSensitive;
}

/**
 * Wraps a lookup with (a) a shared parent cache and (b) a per-request call
 * budget. When the budget runs out the lookup throws, which
 * resolveNotionVisibility turns into "sensitive" — so a large search result
 * set can never cause an unbounded burst of Notion calls, and never widens
 * access either.
 */
export function withCacheAndBudget(
  lookup: NotionParentLookup,
  cache: Map<string, { parent: NotionParentRef; at: number }>,
  options: { maxCalls: number; ttlMs: number; now?: () => number },
): NotionParentLookup {
  let calls = 0;
  const now = options.now ?? Date.now;
  return async (kind, id) => {
    const key = `${kind}:${id.replace(/-/g, "").toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < options.ttlMs) return hit.parent;
    if (calls >= options.maxCalls) {
      throw new Error("Notion visibility lookup budget exhausted.");
    }
    calls += 1;
    const parent = await lookup(kind, id);
    cache.set(key, { parent, at: now() });
    return parent;
  };
}
