import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type {
  OwnerrezBooking,
  OwnerrezCredentials,
  OwnerrezGuest,
  OwnerrezPage,
  OwnerrezProperty,
  OwnerrezPropertyDetail,
} from "./types";

export type {
  OwnerrezBooking,
  OwnerrezProperty,
  OwnerrezPropertyDetail,
  OwnerrezPropertyAddress,
} from "./types";

const API_ORIGIN = "https://api.ownerreservations.com";
const API_BASE_PATH = "/v2";
const BASE_URL = `${API_ORIGIN}${API_BASE_PATH}`;
const PROPERTIES_PATH_PREFIX = `${API_BASE_PATH}/properties`;
const BOOKINGS_PATH_PREFIX = `${API_BASE_PATH}/bookings`;

// Hard cap independent of cycle detection below — belt-and-suspenders, not
// a substitute for it. OwnerRez's real portfolio pages at 20 items/page
// (confirmed live 2026-08-26); 50 pages is generously above any realistic
// property or 90-day-booking volume.
const MAX_PAGINATION_PAGES = 50;

/**
 * Validates and normalizes a `next_page_url` OwnerRez returned in a page
 * response into a path safe to pass to this client's own `HttpClient`
 * (which always prepends `BASE_URL` itself) — never fetches an arbitrary
 * URL a response happens to contain. `next_page_url` is resolved against
 * `API_ORIGIN` so it works whether OwnerRez sends a full absolute URL or a
 * root-relative path; either way, the result must land back on OwnerRez's
 * own host and on the same endpoint family it was paginating (properties
 * pagination must stay under /v2/properties, bookings under /v2/bookings).
 * Anything else — a different host, a path outside the expected endpoint,
 * or an unparseable string — is rejected outright.
 */
function resolvePaginationPath(
  nextPageUrl: string,
  expectedPathPrefix: string,
): string {
  let url: URL;
  try {
    url = new URL(nextPageUrl, API_ORIGIN);
  } catch {
    throw new Error(
      `OwnerRez returned a malformed pagination URL: "${nextPageUrl}"`,
    );
  }

  if (url.origin !== API_ORIGIN) {
    throw new Error(
      `Refusing to follow OwnerRez pagination URL with unexpected host: "${url.origin}"`,
    );
  }

  if (!url.pathname.startsWith(expectedPathPrefix)) {
    throw new Error(
      `Refusing to follow OwnerRez pagination URL with unexpected path: "${url.pathname}"`,
    );
  }

  return `${url.pathname.slice(API_BASE_PATH.length)}${url.search}`;
}

/**
 * OwnerRez's own API requires `since_utc` or `property_ids` on GET
 * /bookings — confirmed against https://api.ownerreservations.com/help/v2/
 * bookings/get-bookings, 2026-08-25: "Either property_ids or since_utc is
 * required." A bare, unfiltered call 400s (this is what caused the real
 * Production `/bookings` failure — see HANDOFF.md). Every real caller in
 * this codebase calls listBookings() with no params, so this default is
 * what actually makes those calls valid; property_ids isn't used since
 * nothing here scopes bookings by property yet.
 */
const DEFAULT_BOOKINGS_LOOKBACK_DAYS = 90;

function defaultSinceUtc(): string {
  const cutoff = new Date(
    Date.now() - DEFAULT_BOOKINGS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  return cutoff.toISOString();
}

/**
 * OwnerRez integration client — real HTTP calls against the v2 API (Basic
 * Auth over HttpClient, StayWhile's shared retry/timeout fetch wrapper).
 * receiveWebhook() remains a stub: OwnerRez's webhook payload shape is an
 * open design question (see INTEGRATION_INVENTORY.md), not a credential gap,
 * so there's nothing correct to implement yet — that's the actual boundary
 * this client can't cross without more information.
 */
export class OwnerrezClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "OWNERREZ" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: OwnerrezCredentials) {
    const basicAuth = Buffer.from(
      `${credentials.username}:${credentials.token}`,
    ).toString("base64");

    this.http = new HttpClient({
      baseUrl: BASE_URL,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
    });
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.http.request<OwnerrezPage<OwnerrezProperty>>(
      "/properties?page_size=1",
    );
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Stateless REST API over static Basic Auth credentials — nothing to
    // tear down server-side; nothing persisted client-side either.
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
      await this.http.request<OwnerrezPage<OwnerrezProperty>>(
        "/properties?page_size=1",
      );
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
      await this.http.request<OwnerrezPage<OwnerrezProperty>>(
        "/properties?page_size=1",
      );
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Follows every page of a paginated OwnerRez list endpoint, validating
   * each `next_page_url` via resolvePaginationPath() before following it,
   * and accumulating `items` across all pages. Two independent safeguards
   * against a runaway loop: a hard page-count cap, and rejection of any
   * pagination URL already seen in this same call (a well-behaved API
   * should never repeat one).
   */
  private async fetchAllPages<T>(
    initialPath: string,
    expectedPathPrefix: string,
  ): Promise<T[]> {
    const items: T[] = [];
    const seenPaths = new Set<string>();
    let path: string | null = initialPath;
    let pageCount = 0;

    while (path !== null) {
      if (pageCount >= MAX_PAGINATION_PAGES) {
        throw new Error(
          `OwnerRez pagination for "${expectedPathPrefix}" exceeded the maximum of ${MAX_PAGINATION_PAGES} pages — refusing to continue.`,
        );
      }
      if (seenPaths.has(path)) {
        throw new Error(
          `OwnerRez returned a repeated pagination URL for "${expectedPathPrefix}" — refusing to loop.`,
        );
      }
      seenPaths.add(path);
      pageCount++;

      const page: OwnerrezPage<T> =
        await this.http.request<OwnerrezPage<T>>(path);
      items.push(...page.items);

      path = page.next_page_url
        ? resolvePaginationPath(page.next_page_url, expectedPathPrefix)
        : null;
    }

    return items;
  }

  /**
   * OwnerRez's `active` filter on GET /properties defaults to `true` when
   * omitted (confirmed via OwnerRez's live OpenAPI spec) — a bare call
   * silently excludes every inactive/disabled property. Fetches both
   * states explicitly and merges by `id` (deduped defensively, though the
   * two sets should never overlap) so the full portfolio — active and
   * inactive — is returned, each state fully paginated.
   */
  async listProperties(): Promise<OwnerrezProperty[]> {
    const active = await this.fetchAllPages<OwnerrezProperty>(
      "/properties?active=true",
      PROPERTIES_PATH_PREFIX,
    );
    const inactive = await this.fetchAllPages<OwnerrezProperty>(
      "/properties?active=false",
      PROPERTIES_PATH_PREFIX,
    );

    const byId = new Map<number, OwnerrezProperty>();
    for (const property of [...active, ...inactive]) {
      byId.set(property.id, property);
    }
    return [...byId.values()];
  }

  /**
   * The single-property detail endpoint — richer than listProperties()'s
   * per-item shape (adds address/bedrooms/bathrooms/max_guests/time_zone/
   * property_type/lat-long), needed only when actually creating a
   * StayWhile Property from a specific OwnerRez record. Deliberately not
   * called for every property in a listing — see
   * ownerrez-onboarding.service.ts's bounded-concurrency use of this for
   * why calling it in bulk needs care.
   */
  async getProperty(id: number): Promise<OwnerrezPropertyDetail> {
    return this.http.request<OwnerrezPropertyDetail>(`/properties/${id}`);
  }

  async listBookings(params?: {
    sinceUtc?: string;
  }): Promise<OwnerrezBooking[]> {
    const sinceUtc = params?.sinceUtc ?? defaultSinceUtc();
    return this.fetchAllPages<OwnerrezBooking>(
      `/bookings?since_utc=${encodeURIComponent(sinceUtc)}`,
      BOOKINGS_PATH_PREFIX,
    );
  }

  async getGuest(guestId: number): Promise<OwnerrezGuest> {
    return this.http.request<OwnerrezGuest>(`/guests/${guestId}`);
  }

  /**
   * Read-only: fetches real booking data from OwnerRez but does not write it
   * into StayWhile's database. OwnerRez is confirmed production data (see
   * HANDOFF.md) — mapping bookings into Reservation/Guest rows needs its own
   * identity-matching and dedupe design plus explicit write authorization,
   * not just a token, so that stays a deliberately separate follow-up. Only
   * INBOUND is meaningful here — OwnerRez is the system of record for its
   * own bookings, StayWhile never pushes booking changes back to it.
   * listBookings() below defaults to a rolling lookback window when called
   * bare (as this does), so recordsProcessed reflects that window, not every
   * booking OwnerRez has ever recorded.
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "OwnerRez sync only supports INBOUND — it's the system of record for its own bookings.",
      );
    }

    const bookings = await this.listBookings();
    return { recordsProcessed: bookings.length, direction };
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("OwnerRez", "receiveWebhook");
  }
}
