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
  last_edited_time?: string;
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
  /** Notion's own `last_edited_time` for this row — needed for the in-dashboard detail view's staleness display and, later, the edit-time conflict check. Never a fabricated/derived value. */
  lastEditedTime: string | null;
}

/**
 * The Notion property types the in-dashboard editable-field architecture
 * knows how to render/validate — deliberately a closed set matching exactly
 * what "View of Listings" and similar operational databases actually use
 * (confirmed live), never an open-ended "any Notion type" union. Extending
 * this list is a deliberate, reviewed addition, not automatic.
 */
export type NotionEditableFieldType =
  "text" | "select" | "multi_select" | "checkbox" | "date" | "number" | "url";

/** One raw page of `GET /v1/blocks/{id}/children` — the shared shape used to read both a page's own top-level blocks and any block's nested children (e.g. a toggle's contents, a table's rows). Each raw block is read generically (`Record<string, unknown>`), same discipline as `NotionDataSourceRow` above — a network response is never trusted to match a static type, so `mapRawNotionBlock()` (client.ts) checks each field's real runtime shape itself rather than casting. */
export interface NotionBlockChildrenResponse {
  results: Array<Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * One Notion rich-text run reduced to exactly what SOP/operational content
 * actually needs to render readably: the text itself, a real hyperlink when
 * present, and the three annotations StayWhile's operational content
 * actually uses (bold/italic/code) — deliberately not the full annotations
 * set (strikethrough/underline/color), which isn't needed for this V1 and
 * would just be more surface area to render or ignore.
 */
export interface NotionRichTextRun {
  text: string;
  href: string | null;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

/**
 * The closed set of Notion block types this V1 renders with real structure.
 * Confirmed from real discovery (see HANDOFF.md Increment 122): paragraph/
 * heading_2/callout on the real "SOP for VRBO & Direct Bookings" page, toggle
 * and child_page-adjacent structure on the "SOPs" parent page. heading_1/
 * heading_3/bulleted_list_item/numbered_list_item/table are added ahead of
 * having a confirmed real example of each specifically, because they are
 * ordinary, common Notion content blocks any other operational page in this
 * same workspace (a different SOP, a checklist, a reference table) could
 * already use — extending this set further, for a type genuinely absent from
 * every accessible page, remains a deliberate, reviewed addition, never
 * automatic. Anything outside this set maps to "unsupported" rather than
 * guessed at.
 */
export type NotionSupportedBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "callout"
  | "toggle"
  | "table"
  | "child_page";

interface NotionContentBlockBase {
  id: string;
  /**
   * Notion's own real per-block `last_edited_time` — present on every real
   * block object, same as a page's. Needed for optimistic-concurrency
   * conflict detection on a future block edit (compare against the value a
   * dashboard editor started from, immediately before writing — same
   * pattern already used for page-property edits, see
   * notion-edit.service.ts), and kept on every variant (including
   * "unsupported"/"table") for consistency rather than only the editable
   * ones. Empty string only in the pathological case of a malformed raw
   * block missing the field entirely — never fabricated.
   */
  lastEditedTime: string;
}

/**
 * The subset of NotionSupportedBlockType whose real Notion PATCH shape is
 * identical — `{ [type]: { rich_text: [...] } }`, replacing only the
 * block's plain text content (see NotionClient.updateBlockContent()).
 * Deliberately excludes "table" (a materially different, per-cell shape
 * that would need its own, separately-designed write path) — matching the
 * "support only explicitly implemented block types" safety requirement for
 * block editing.
 */
export type NotionEditableBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "toggle"
  | "callout";

/** paragraph/heading/list-item/toggle all share this exact shape (text + optionally-nested children) — callout is its own type only because it also carries an icon. */
export interface NotionTextContentBlock extends NotionContentBlockBase {
  type:
    | "paragraph"
    | "heading_1"
    | "heading_2"
    | "heading_3"
    | "bulleted_list_item"
    | "numbered_list_item"
    | "toggle";
  text: NotionRichTextRun[];
  /** Nested sub-blocks (e.g. a toggle's contents, an indented sub-paragraph) — always [] when the real block had none, also [] (never guessed) when nesting was cut off by the depth/call-budget safety caps (see NotionPageContent.truncated). */
  children: NotionContentBlock[];
}

export interface NotionCalloutContentBlock extends NotionContentBlockBase {
  type: "callout";
  text: NotionRichTextRun[];
  /** A plain emoji character when the callout's icon is Notion's "emoji" icon type — null for every other icon type (external image, uploaded file) or when absent, never a raw file URL. */
  icon: string | null;
  children: NotionContentBlock[];
}

export interface NotionTableRow {
  id: string;
  cells: NotionRichTextRun[][];
}

export interface NotionTableContentBlock extends NotionContentBlockBase {
  type: "table";
  tableWidth: number;
  hasColumnHeader: boolean;
  hasRowHeader: boolean;
  rows: NotionTableRow[];
}

/**
 * A `child_page` block — the SOP library's real structure includes several
 * of these directly under the "SOPs" root page (see HANDOFF.md's SOP
 * library increment): a link to a genuinely separate Notion page, whose own
 * real body content is NOT included in this block (Notion's API only ever
 * returns the child page's title here) — reading it requires a SEPARATE
 * `getPageContent(id)` call using this block's own `id`, exactly the same
 * as opening any other page-shaped search result. `title` is Notion's own
 * plain string for this block type (never rich text here, confirmed via
 * real discovery) — never fabricated, "(untitled page)" only if genuinely
 * absent.
 */
export interface NotionChildPageContentBlock extends NotionContentBlockBase {
  type: "child_page";
  title: string;
}

/** A block type outside NotionSupportedBlockType (or a table row's own container, which is only ever consumed as part of its parent table) — rendered as a safe, explicit fallback, never silently dropped and never guessed at as some other type. */
export interface NotionUnsupportedContentBlock extends NotionContentBlockBase {
  type: "unsupported";
  /** The real Notion block type this V1 doesn't yet render (e.g. "image", "video", "link_preview") — shown only as a small descriptive label, never raw block content. */
  originalType: string;
}

export type NotionContentBlock =
  | NotionTextContentBlock
  | NotionCalloutContentBlock
  | NotionTableContentBlock
  | NotionChildPageContentBlock
  | NotionUnsupportedContentBlock;

/**
 * The full result of a read-only getPageContent() call. `truncated: true`
 * means the real page had more nested content than the depth/call-budget
 * safety caps allowed reading (see MAX_BLOCK_TREE_DEPTH/MAX_BLOCK_FETCH_CALLS
 * in client.ts) — the caller must show this honestly (e.g. "Open in Notion
 * to see everything") rather than silently presenting a partial page as
 * complete.
 */
export interface NotionPageContent {
  blocks: NotionContentBlock[];
  truncated: boolean;
}
