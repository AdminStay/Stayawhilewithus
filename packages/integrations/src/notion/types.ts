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

export interface NotionSearchResult {
  id: string;
  /** "page" | "database" — Notion's two searchable object types. */
  object: string;
  url?: string;
  last_edited_time?: string;
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
