// Notion API credentials — an internal integration token (Bearer auth).
export interface NotionCredentials {
  token: string;
}

export interface NotionUser {
  id: string;
  name?: string;
  type?: string;
}

/** A Notion rich-text run — only the field every result actually needs (the raw text). */
export interface NotionRichText {
  plain_text: string;
}

/** The one property (out of a page's `properties` map) whose type is "title". */
export interface NotionTitleProperty {
  type: "title";
  title: NotionRichText[];
}

/**
 * Where a "page" object lives — a database row (`database_id`), a sub-page
 * of another page (`page_id`), or a top-level workspace page
 * (`workspace`). Always present on every real Notion page/database object;
 * used only to label a search result's content type, never to fetch
 * anything further.
 */
export interface NotionParent {
  type: string;
  database_id?: string;
  page_id?: string;
}

export interface NotionSearchResult {
  id: string;
  /** "page" | "database" — Notion's two searchable object types. */
  object: string;
  url?: string;
  last_edited_time?: string;
  parent?: NotionParent;
  /** Present on "database" objects — their title lives here, not in `properties`. */
  title?: NotionRichText[];
  /** Present on "page" objects — the title lives in whichever property has type "title", which varies per database schema. */
  properties?: Record<string, { type: string; title?: NotionRichText[] }>;
}

export interface NotionSearchResponse {
  results: NotionSearchResult[];
  has_more: boolean;
  next_cursor: string | null;
}

/** A search result reduced to what's actually useful to show on a dashboard. */
export interface NotionHighlight {
  id: string;
  object: string;
  title: string;
  url: string | null;
  lastEditedTime: string | null;
}

/**
 * What kind of Notion object a general search() result is — derived only
 * from fields Notion's /search already returns on every result (`object`,
 * `parent.type`), never from an extra lookup. "database_row" means a page
 * that lives inside some database (e.g. a "View of Listings" row, or a row
 * in an unrelated database) — distinguished from a standalone "page" so the
 * UI can label results honestly instead of calling everything just "page."
 */
export type NotionSearchSourceType = "database" | "database_row" | "page";

/**
 * One general-search result reduced to exactly what a result card needs —
 * never the raw Notion object, never page/block content (search() only
 * calls Notion's /search, which returns titles/metadata, not body text).
 */
export interface NotionSearchResultItem {
  id: string;
  title: string;
  url: string | null;
  lastEditedTime: string | null;
  sourceType: NotionSearchSourceType;
  /**
   * The id of the database this result lives in, when `sourceType` is
   * "database_row" — Notion's /search already returns this on every row
   * result (`parent.database_id`), so identifying which database a row
   * belongs to (e.g. for excluding a known staff/contact-directory database
   * from a search feature) needs no extra API call. Always null for
   * "database" and "page" results.
   */
  parentDatabaseId: string | null;
}

/** Result of a one-row proof read against a specific data source — never the row's full content. */
export interface NotionDataSourceQueryResult {
  resultCount: number;
  firstTitle: string | null;
}

/**
 * One property value as returned by a data-source query row. Only the
 * property types actually present in "View of Listings" are modeled
 * (confirmed live 2026-08-26 via GET /v1/data_sources/{id}): title,
 * rich_text, number, url. `NotionSearchResult` above only models `title`
 * and isn't sufficient for reading a real data source's rows.
 */
export type NotionPropertyValue =
  | { type: "title"; title: NotionRichText[] }
  | { type: "rich_text"; rich_text: NotionRichText[] }
  | { type: "number"; number: number | null }
  | { type: "url"; url: string | null };

/** One row from a data-source query response (POST /data_sources/{id}/query). */
export interface NotionDataSourceRow {
  id: string;
  url?: string | null;
  properties: Record<string, NotionPropertyValue>;
}

export interface NotionDataSourceQueryPage {
  results: NotionDataSourceRow[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * A single "View of Listings" row reduced to exactly what the dashboard UI
 * needs — never the raw Notion property object. Region is deliberately not
 * part of this type: it's resolved app-side (see
 * apps/website's notion-region-matching.ts), not a Notion field.
 */
export interface NotionListingRecord {
  id: string;
  url: string | null;
  name: string;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  guests: number | null;
  directBooking: string | null;
  airbnbLink: string | null;
  vrboLink: string | null;
  googleDrivePhotosUrl: string | null;
  guidebookUrl: string | null;
}
