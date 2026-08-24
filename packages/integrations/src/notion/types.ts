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
