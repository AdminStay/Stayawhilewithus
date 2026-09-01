/**
 * Databases the VA-facing "Search Notion" feature must never surface
 * results from — real Notion database ids, confirmed live 2026-09-01 via a
 * read-only NotionClient.search() enumeration (see HANDOFF and
 * packages/integrations/src/notion/scripts/discover-accessible-scope.ts).
 * These are staff/contact-directory databases (names, emails, internal
 * contact info) — out of scope for an "operational knowledge search," not
 * operational content. Excluded by database id, never by title/keyword
 * matching, so a legitimate operational result is never dropped just
 * because it happens to mention a person's name (e.g. "SOP for VRBO
 * & Direct Bookings" staying searchable even though many operational pages
 * are attributed to or written by a named staff member).
 *
 * Identified purely from fields Notion's /search already returns on every
 * result (`object`, `parent.database_id`) — no extra API call was needed to
 * build this list, and none is needed at request time to apply it (see
 * isExcludedFromVaSearch below).
 *
 * This does NOT change what the integration can see in Notion, does not
 * touch Notion sharing/permissions, and does not affect the existing
 * "View of Listings" section — it only narrows what the new general search
 * feature returns.
 */
export const NOTION_SEARCH_EXCLUDED_DATABASE_IDS: readonly string[] = [
  "d3d6058d-b989-82df-b0d8-014512d331ec", // People
  "75c83d9c-0ea6-4aa5-a348-89a73e16c643", // Company Directory
  "20f6058d-b989-80cf-805a-edd83b6e8540", // Contact List
  "20f6058d-b989-805c-85f4-f507faaf2ba2", // Contact List (1)
  "20f6058d-b989-800b-bdff-dcea18ea3ee1", // Contact List (2)
];
