import type { NotionSearchResultItem } from "@stayw/integrations/notion";

import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";

const EXCLUDED_IDS = new Set(NOTION_SEARCH_EXCLUDED_DATABASE_IDS);

/**
 * True when a general search() result belongs to one of the known
 * staff/contact-directory databases (see notion-search-exclusions.ts config)
 * — checked only by real Notion object id, never by title/keyword, so an
 * operational result is never dropped just because it mentions a person's
 * name. Two cases: the excluded database object itself (sourceType
 * "database", matched by its own id), or a row inside it (sourceType
 * "database_row", matched by parentDatabaseId — already returned by
 * Notion's /search, no extra API call). A standalone "page" is never
 * excluded by this rule; it has no parentDatabaseId at all.
 */
export function isExcludedFromVaSearch(
  item: Pick<NotionSearchResultItem, "id" | "sourceType" | "parentDatabaseId">,
): boolean {
  if (item.sourceType === "database") return EXCLUDED_IDS.has(item.id);
  if (item.sourceType === "database_row") {
    return (
      item.parentDatabaseId !== null && EXCLUDED_IDS.has(item.parentDatabaseId)
    );
  }
  return false;
}
