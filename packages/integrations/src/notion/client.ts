import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
} from "../core";

import type {
  NotionCredentials,
  NotionDataSourceQueryResult,
  NotionHighlight,
  NotionSearchResponse,
  NotionSearchResult,
  NotionUser,
} from "./types";

export type { NotionHighlight, NotionDataSourceQueryResult } from "./types";

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

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

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
}
