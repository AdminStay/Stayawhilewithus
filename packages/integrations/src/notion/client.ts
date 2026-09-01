import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
} from "../core";

import type {
  NotionCredentials,
  NotionDataSourceQueryPage,
  NotionDataSourceQueryResult,
  NotionDataSourceRow,
  NotionHighlight,
  NotionListingRecord,
  NotionSearchResponse,
  NotionSearchResult,
  NotionSearchResultItem,
  NotionSearchSourceType,
  NotionUser,
} from "./types";

export type {
  NotionHighlight,
  NotionDataSourceQueryResult,
  NotionListingRecord,
  NotionSearchResultItem,
  NotionSearchSourceType,
} from "./types";

/**
 * A page's title lives in whichever of its `properties` has type "title"
 * (which property that is varies per database schema — Notion doesn't put
 * it in a fixed field name). A database's title is simpler: a top-level
 * `title` array. Falls back to a generic label rather than guessing/
 * inventing text when neither is present (e.g. an empty/untitled page).
 */
function extractTitle(result: NotionSearchResult): string {
  if (result.object === "database" && result.title?.length) {
    return result.title.map((t) => t.plain_text).join("");
  }
  if (result.properties) {
    for (const prop of Object.values(result.properties)) {
      if (prop.type === "title" && prop.title?.length) {
        return prop.title.map((t) => t.plain_text).join("");
      }
    }
  }
  return result.object === "database"
    ? "(untitled database)"
    : "(untitled page)";
}

/**
 * Labels a general search() result using only fields Notion's /search
 * response already includes on every result (never a second lookup):
 * "database" for a database object itself, "database_row" for a page whose
 * parent is a database (e.g. a "View of Listings" row, or a row in some
 * other database this integration can see), "page" for anything else
 * (a standalone workspace page or a sub-page of another page).
 */
function deriveSourceType(result: NotionSearchResult): NotionSearchSourceType {
  if (result.object === "database") return "database";
  if (result.parent?.type === "database_id") return "database_row";
  return "page";
}

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Hard cap independent of cycle detection below — belt-and-suspenders, not a
// substitute for it. A real user-facing search call site passes a much
// smaller maxPages (see integrations.service.ts); this default only bounds
// the rare unscoped/no-query enumeration case (used by the one-time
// accessible-scope discovery script), matching the discipline already
// applied to MAX_DATA_SOURCE_PAGES below.
const MAX_SEARCH_PAGES = 50;
const SEARCH_PAGE_SIZE = 50;

/**
 * Notion's data-source query endpoint (POST /data_sources/{id}/query) did
 * not exist before multi-source databases shipped, and requires this newer
 * version specifically — confirmed live against Notion's current API
 * reference (2026-08-25). Used only as a per-request header override in
 * queryDataSource() below; NOTION_VERSION above stays the client's global
 * default for every other method (/users/me, /search-based sync() and
 * listRecentlyEdited()), which are unaffected.
 */
const NOTION_DATA_SOURCE_QUERY_VERSION = "2026-03-11";

// Hard cap independent of cycle detection below — belt-and-suspenders, not a
// substitute for it. StayWhile's real portfolio is on the order of dozens of
// listings; 50 pages at page_size 100 is generously above any realistic size.
const MAX_DATA_SOURCE_PAGES = 50;

// "View of Listings"'s real property names, confirmed live 2026-08-26 via
// GET /v1/data_sources/{id} (see HANDOFF.md). Hardcoded rather than
// re-discovered per request — this schema is stable metadata, not runtime
// data, and re-fetching it on every listing read would be a wasted call.
const LISTING_PROPERTY = {
  name: "Name",
  address: "Address",
  guests: "Number of Guests",
  bathrooms: "Bathrooms",
  bedrooms: "Bedrooms",
  directBooking: "Direct booking",
  airbnbLink: "Airbnb Link",
  vrboLink: "VRBO Link",
  googleDrivePhotosUrl: "Google Drive Photos",
  guidebookUrl: "Guidebook",
} as const;

/**
 * A network response is never actually guaranteed to match the
 * `NotionPropertyValue` type we declare for it — Notion could add a new
 * property type, change a data source's schema, or return a genuinely
 * malformed entry. Every extractor below treats a raw property value as
 * `unknown` and checks its real runtime shape rather than trusting the
 * static type, so one unexpected or malformed column can never crash row
 * parsing (and, in turn, the whole listing page) — it just resolves that
 * one field to null, the same as if the property were absent entirely.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractRichTextRuns(value: unknown): unknown[] | null {
  if (!isPlainObject(value)) return null;
  if (value.type === "title" && Array.isArray(value.title)) return value.title;
  if (value.type === "rich_text" && Array.isArray(value.rich_text)) {
    return value.rich_text;
  }
  return null;
}

function extractRichTextValue(value: unknown): string | null {
  const runs = extractRichTextRuns(value);
  if (!runs) return null;
  const text = runs
    .map((run) =>
      isPlainObject(run) && typeof run.plain_text === "string"
        ? run.plain_text
        : "",
    )
    .join("");
  return text.length > 0 ? text : null;
}

function extractNumberValue(value: unknown): number | null {
  if (!isPlainObject(value) || value.type !== "number") return null;
  return typeof value.number === "number" ? value.number : null;
}

function extractUrlValue(value: unknown): string | null {
  if (!isPlainObject(value) || value.type !== "url") return null;
  return typeof value.url === "string" ? value.url : null;
}

/**
 * Maps one raw "View of Listings" row to the narrow, UI-facing
 * NotionListingRecord shape — never exposes the raw Notion properties map
 * beyond this function. Only the 10 known field names in LISTING_PROPERTY
 * are ever read; any other (unmodeled) property present on the row — a
 * future new column, for instance — is never looked up and so can never
 * affect parsing or reach the UI. A missing, malformed, or unexpectedly
 * typed value for any of the 10 known fields resolves to null rather than
 * throwing — a row is never dropped, and one bad column never takes down
 * the whole listing page, just that one field.
 */
function mapListingRecord(row: NotionDataSourceRow): NotionListingRecord {
  const props: Record<string, unknown> = isPlainObject(row.properties)
    ? row.properties
    : {};
  return {
    id: row.id,
    url: row.url ?? null,
    name:
      extractRichTextValue(props[LISTING_PROPERTY.name]) ??
      "(untitled listing)",
    address: extractRichTextValue(props[LISTING_PROPERTY.address]),
    bedrooms: extractNumberValue(props[LISTING_PROPERTY.bedrooms]),
    bathrooms: extractNumberValue(props[LISTING_PROPERTY.bathrooms]),
    guests: extractNumberValue(props[LISTING_PROPERTY.guests]),
    directBooking: extractRichTextValue(props[LISTING_PROPERTY.directBooking]),
    airbnbLink: extractRichTextValue(props[LISTING_PROPERTY.airbnbLink]),
    vrboLink: extractRichTextValue(props[LISTING_PROPERTY.vrboLink]),
    googleDrivePhotosUrl: extractUrlValue(
      props[LISTING_PROPERTY.googleDrivePhotosUrl],
    ),
    guidebookUrl: extractUrlValue(props[LISTING_PROPERTY.guidebookUrl]),
  };
}

/**
 * Notion API client — real HTTP calls via HttpClient (Bearer integration
 * token). `Property.notionPageId` already exists in the schema for this
 * integration to eventually target; nothing writes to it yet.
 */
export class NotionClient implements BaseIntegrationClient, SyncCapable {
  readonly provider = "NOTION" as const;
  readonly capabilities = [
    "sync",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: NotionCredentials) {
    this.http = new HttpClient({
      baseUrl: BASE_URL,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.http.request<NotionUser>("/users/me");
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Integration tokens aren't sessions — nothing to tear down server-side.
  }

  async authenticate(): Promise<void> {
    await this.connect();
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    try {
      await this.http.request<NotionUser>("/users/me");
      return { healthy: true, checkedAt: new Date() };
    } catch (err) {
      return {
        healthy: false,
        checkedAt: new Date(),
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    try {
      await this.http.request<NotionUser>("/users/me");
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Notion has no single "list everything relevant" endpoint the way
   * OwnerRez has /bookings — what a StayWhile "sync" should mean (which
   * pages/databases, what gets written where) isn't decided yet. This calls
   * Notion's /search (every page/database this integration can see) purely
   * as a real, generically meaningful connectivity + count check; it does
   * not write anything into StayWhile's database. OUTBOUND isn't meaningful
   * without that design decision either, so only INBOUND is accepted.
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "Notion sync only supports INBOUND until a write target (which pages/databases) is designed.",
      );
    }

    const response = await this.http.request<NotionSearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({}),
    });

    return { recordsProcessed: response.results.length, direction };
  }

  /**
   * The dashboard-facing read: the most recently edited pages/databases
   * this integration token can see, real titles extracted per
   * extractTitle()'s documented rule (no fabricated text). Read-only, same
   * as sync() — nothing is written back into Notion or into StayWhile's
   * database.
   */
  async listRecentlyEdited(limit = 5): Promise<NotionHighlight[]> {
    const response = await this.http.request<NotionSearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({
        page_size: limit,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    });

    return response.results.map((result) => ({
      id: result.id,
      object: result.object,
      title: extractTitle(result),
      url: result.url ?? null,
      lastEditedTime: result.last_edited_time ?? null,
    }));
  }

  /**
   * General, read-only search across every page/database this integration
   * token can see — real Notion /search, optionally with a `query` string
   * (Notion's own relevance ranking, not client-side filtering), fully
   * paginated up to `maxPages`. Returns only the narrow NotionSearchResultItem
   * shape (title/url/lastEditedTime/sourceType) — never a raw Notion object,
   * never page/block content (this endpoint only ever returns titles and
   * metadata, not page bodies). Same cycle-detection + hard-cap discipline
   * as listDataSourceRecords()/queryDataSource() below. A caller doing a
   * live, user-typed search should pass a small `maxPages` (see
   * integrations.service.ts) — this method's own default (MAX_SEARCH_PAGES)
   * only bounds the unscoped/no-query enumeration case used by the
   * accessible-scope discovery script, never a full unbounded workspace
   * crawl on every keystroke.
   */
  async search(
    options: { query?: string; maxPages?: number } = {},
  ): Promise<NotionSearchResultItem[]> {
    const { query, maxPages = MAX_SEARCH_PAGES } = options;
    const items: NotionSearchResultItem[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;

    for (;;) {
      if (pageCount >= maxPages) {
        throw new Error(
          `Notion search exceeded the maximum of ${maxPages} pages — refusing to continue.`,
        );
      }
      pageCount++;

      const body: Record<string, unknown> = { page_size: SEARCH_PAGE_SIZE };
      if (query) body.query = query;
      if (cursor) body.start_cursor = cursor;

      const response = await this.http.request<NotionSearchResponse>(
        "/search",
        { method: "POST", body: JSON.stringify(body) },
      );

      for (const result of response.results) {
        const sourceType = deriveSourceType(result);
        items.push({
          id: result.id,
          title: extractTitle(result),
          url: result.url ?? null,
          lastEditedTime: result.last_edited_time ?? null,
          sourceType,
          parentDatabaseId:
            sourceType === "database_row"
              ? (result.parent?.database_id ?? null)
              : null,
        });
      }

      if (!response.has_more) break;
      if (!response.next_cursor) {
        throw new Error(
          "Notion reported more results (has_more: true) but returned no next_cursor — refusing to silently truncate.",
        );
      }
      if (seenCursors.has(response.next_cursor)) {
        throw new Error(
          "Notion returned a repeated pagination cursor — refusing to loop.",
        );
      }
      seenCursors.add(response.next_cursor);
      cursor = response.next_cursor;
    }

    return items;
  }

  /**
   * One-off, additive proof that a specific data source (e.g. a property
   * database like "View of Listings") is shared with this integration and
   * readable. Read-only: Notion's data-source query endpoint reads rows,
   * never writes. Requests at most `pageSize` rows and returns only a count
   * and the first row's title — never full row/page content. Uses a
   * per-request Notion-Version override (see NOTION_DATA_SOURCE_QUERY_VERSION
   * above) so the client's default NOTION_VERSION, and every other method,
   * is unaffected.
   */
  async queryDataSource(
    dataSourceId: string,
    pageSize = 1,
  ): Promise<NotionDataSourceQueryResult> {
    const response = await this.http.request<NotionSearchResponse>(
      `/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: { "Notion-Version": NOTION_DATA_SOURCE_QUERY_VERSION },
        body: JSON.stringify({ page_size: pageSize }),
      },
    );

    const first = response.results[0];
    return {
      resultCount: response.results.length,
      firstTitle: first ? extractTitle(first) : null,
    };
  }

  /**
   * Full, read-only retrieval of every row in a data source (e.g. "View of
   * Listings"), fully paginated — never just the first page. Two
   * independent safeguards against a runaway loop, mirroring the discipline
   * applied to OwnerRez's pagination fix: a hard page cap, and rejection of
   * a `next_cursor` value already seen in this same call. Also refuses to
   * silently truncate if Notion ever reports `has_more: true` without a
   * usable `next_cursor` — that would otherwise look like a normal
   * completion. Returns the narrow NotionListingRecord shape only; the raw
   * Notion properties map never leaves this function.
   */
  async listDataSourceRecords(
    dataSourceId: string,
  ): Promise<NotionListingRecord[]> {
    const rows: NotionDataSourceRow[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;

    for (;;) {
      if (pageCount >= MAX_DATA_SOURCE_PAGES) {
        throw new Error(
          `Notion data source query exceeded the maximum of ${MAX_DATA_SOURCE_PAGES} pages — refusing to continue.`,
        );
      }
      pageCount++;

      const page: NotionDataSourceQueryPage =
        await this.http.request<NotionDataSourceQueryPage>(
          `/data_sources/${dataSourceId}/query`,
          {
            method: "POST",
            headers: { "Notion-Version": NOTION_DATA_SOURCE_QUERY_VERSION },
            body: JSON.stringify(
              cursor
                ? { page_size: 100, start_cursor: cursor }
                : { page_size: 100 },
            ),
          },
        );

      rows.push(...page.results);

      if (!page.has_more) break;

      if (!page.next_cursor) {
        throw new Error(
          "Notion reported more results (has_more: true) but returned no next_cursor — refusing to silently truncate.",
        );
      }
      if (seenCursors.has(page.next_cursor)) {
        throw new Error(
          "Notion returned a repeated pagination cursor — refusing to loop.",
        );
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }

    return rows.map(mapListingRecord);
  }
}
