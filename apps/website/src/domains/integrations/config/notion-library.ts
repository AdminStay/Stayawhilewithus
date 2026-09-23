/**
 * The real Notion "LIBRARY" database id (2026-09-24) — confirmed live via
 * read-only discovery: a top-level, workspace-parented database whose own
 * rows are real Notion pages (Property Directory, Owner Info, Service
 * Providers List, Property Lockboxes Code, OwnerRez Support Links, ...).
 * Deliberately SEPARATE from both `NOTION_SOPS_ROOT_PAGE_ID`
 * (notion-sop-library.ts — a single page, not a database, and not a parent
 * or child of this one) and `NOTION_LISTINGS_DATA_SOURCE_ID` (the "View of
 * Listings" structured-property database) — these are three independent
 * Notion structures, kept separate exactly as required: View of Listings
 * remains the structured listing/property source, LIBRARY is the
 * operational-reference source (lockbox codes, owner info, service
 * providers, and whatever else lives there), and neither replaces the
 * other.
 */
export const NOTION_LIBRARY_DATA_SOURCE_ID =
  "e54961ca-c27c-4bbd-b4b3-a766d9b0dd64";
