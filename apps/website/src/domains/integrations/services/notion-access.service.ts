import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import type { NotionClient, NotionParentRef } from "@stayw/integrations/notion";

import { NOTION_SOPS_ROOT_PAGE_ID } from "../config/notion-sop-library";
import type { NotionVisibility } from "../config/notion-visibility";

import {
  canViewNotionVisibility,
  resolveNotionVisibility,
  withCacheAndBudget,
  type NotionObjectKind,
} from "./notion-visibility";

/**
 * Server-side wiring for the Notion visibility layer (2026-09-30).
 * Standard Notion content requires `notion:read`; sensitive content
 * requires `notion:manage` (see config/notion-visibility.ts). Nothing here
 * grants access — it only decides what an already-permitted actor may see.
 */

export interface NotionAccess {
  canReadStandard: boolean;
  canReadSensitive: boolean;
}

export async function getNotionAccess(
  actor: AuthContext,
): Promise<NotionAccess> {
  const [canReadStandard, canReadSensitive] = await Promise.all([
    hasPermission(actor, "notion:read"),
    hasPermission(actor, "notion:manage"),
  ]);
  return { canReadStandard, canReadSensitive };
}

/** Throws (ForbiddenError) unless the actor may read at least standard Notion content. */
export async function assertNotionContentAccess(
  actor: AuthContext,
): Promise<NotionAccess> {
  const access = await getNotionAccess(actor);
  if (!access.canReadStandard && !access.canReadSensitive) {
    await assertPermission(actor, "notion:read");
  }
  return access;
}

// Parent relationships barely change; a short TTL keeps page moves honest.
const PARENT_CACHE_TTL_MS = 10 * 60 * 1000;
const parentCache = new Map<string, { parent: NotionParentRef; at: number }>();
let listingsDatabaseIds: { ids: string[]; at: number } | null = null;

async function resolveListingsDatabaseIds(
  client: NotionClient,
): Promise<string[]> {
  const dataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  if (!dataSourceId) return [];
  if (
    listingsDatabaseIds &&
    Date.now() - listingsDatabaseIds.at < PARENT_CACHE_TTL_MS
  ) {
    return listingsDatabaseIds.ids;
  }
  try {
    const id = await client.getDataSourceParentDatabaseId(dataSourceId);
    listingsDatabaseIds = { ids: id ? [id] : [], at: Date.now() };
  } catch (err) {
    console.error("resolveListingsDatabaseIds failed:", err);
    // Fail closed: listing rows then resolve as sensitive until next try.
    return [];
  }
  return listingsDatabaseIds.ids;
}

export type NotionVisibilityResolver = (
  kind: NotionObjectKind,
  id: string,
) => Promise<NotionVisibility>;

/**
 * One resolver per request. `maxLookups` bounds the Notion calls it may
 * make (cache hits are free); anything beyond the budget resolves as
 * sensitive — never as visible.
 */
export async function createNotionVisibilityResolver(
  client: NotionClient,
  maxLookups = 40,
): Promise<NotionVisibilityResolver> {
  const listingsIds = await resolveListingsDatabaseIds(client);
  const lookup = withCacheAndBudget(
    (kind, id) => client.getObjectParent(kind, id),
    parentCache,
    { maxCalls: maxLookups, ttlMs: PARENT_CACHE_TTL_MS },
  );
  return (kind, id) =>
    resolveNotionVisibility({ kind, id }, lookup, {
      sopRootPageId: NOTION_SOPS_ROOT_PAGE_ID,
      listingsDatabaseIds: listingsIds,
    });
}

/**
 * Keeps only the items this actor may see. An actor with sensitive access
 * sees everything the integration can read, so no lookups are made for it.
 */
export async function filterVisibleNotionItems<T>(
  items: readonly T[],
  access: NotionAccess,
  resolve: NotionVisibilityResolver,
  refOf: (item: T) => { kind: NotionObjectKind; id: string },
): Promise<T[]> {
  if (access.canReadSensitive) return [...items];
  if (!access.canReadStandard) return [];
  const kept: T[] = [];
  for (const item of items) {
    const ref = refOf(item);
    const visibility = await resolve(ref.kind, ref.id);
    if (canViewNotionVisibility(visibility, access)) kept.push(item);
  }
  return kept;
}

/** Exported for tests only. */
export function __resetNotionAccessCachesForTests(): void {
  parentCache.clear();
  listingsDatabaseIds = null;
}
