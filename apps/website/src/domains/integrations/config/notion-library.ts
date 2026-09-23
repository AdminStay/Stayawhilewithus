/**
 * The real Notion "LIBRARY" data source id (2026-09-24, fixed 2026-09-24) —
 * a top-level, workspace-parented database whose own rows are real Notion
 * pages (Property Directory, Owner Info, Service Providers List, Property
 * Lockboxes Code, OwnerRez Support Links, ...). Deliberately SEPARATE from
 * both `NOTION_SOPS_ROOT_PAGE_ID` (notion-sop-library.ts — a single page,
 * not a database, and not a parent or child of this one) and
 * `NOTION_LISTINGS_DATA_SOURCE_ID` (the "View of Listings" structured-
 * property database) — these are three independent Notion structures, kept
 * separate exactly as required: View of Listings remains the structured
 * listing/property source, LIBRARY is the operational-reference source
 * (lockbox codes, owner info, service providers, and whatever else lives
 * there), and neither replaces the other.
 *
 * Production incident (2026-09-24): this constant originally held
 * `e54961ca-c27c-4bbd-b4b3-a766d9b0dd64`, which is the LIBRARY *database's*
 * own id (GET /v1/databases/{id} → 200, object: "database"). Notion's
 * `POST /data_sources/{id}/query` endpoint requires a *data source* id, not
 * a database id — as of the multi-source-database API split, a database's
 * data source id is a distinct id, only obtainable via
 * `GET /v1/databases/{id}` under API version 2025-09-03+ (its
 * `data_sources[]` array). Querying with the database id returned
 * `404 object_not_found` every time, which is exactly why the Library
 * section failed to load in Production while SOPs and View of Listings
 * (already using correct data source ids) kept working. Verified live: the
 * value below returns `200` from `POST /data_sources/{id}/query`; the old
 * database id does not.
 */
export const NOTION_LIBRARY_DATA_SOURCE_ID =
  "14b8dd70-3873-447e-a082-c150f69fa6d9";
