import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, HttpRequestError, NotImplementedError } from "../core";
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
// a substitute for it. OwnerRez pages at 20 items/page (confirmed live
// 2026-08-26).
/**
 * Runaway-loop guard per paginated query. /bookings pages are server-sized
 * at 20 items (observed; not configurable per OwnerRez's docs), so the old
 * cap of 50 pages silently limited one booking query to 1,000 bookings —
 * already close to the 941 a real 90-day Production preview returned
 * (2026-09-27). 200 pages (4,000 bookings per query) keeps the guard while
 * leaving real headroom; the repeated-URL check is unchanged.
 */
const MAX_PAGINATION_PAGES = 200;

/**
 * Response-shape diagnostic (2026-09-28). The first Production preview
 * failed with "a.items is not iterable": OwnerRez answered 2xx with JSON
 * that has no `items` array, which its docs never describe. Every paginated
 * call now carries a safe operation label and every page is validated
 * before `items` is read. A page that isn't `{ items: [...] }` throws
 * OwnerrezUnexpectedResponseError — never treated as an empty list — whose
 * message and `diagnostic` contain ONLY: operation label, page (and batch)
 * number, JSON type, and top-level key NAMES (for an array: its length and
 * the first element's key names). Never values, URLs, query values, ids,
 * dates, guest data or headers. Key names that don't look like ordinary
 * field names (e.g. numeric ids used as keys) are counted as redacted, not
 * shown.
 */
export type OwnerrezPagedOperation =
  | "bookings:recent-changes"
  | "bookings:stay-window"
  | "properties:active"
  | "properties:inactive";

export interface OwnerrezResponseShape {
  type:
    | "object"
    | "array"
    | "null"
    | "string"
    | "number"
    | "boolean"
    | "undefined"
    | "other";
  keys?: string[];
  redactedKeyCount?: number;
  /** When `items` is present but not an array: its JSON type only. */
  itemsType?: string;
  length?: number;
  firstElementKeys?: string[];
  firstElementRedactedKeyCount?: number;
}

export interface OwnerrezResponseDiagnostic extends OwnerrezResponseShape {
  operation: OwnerrezPagedOperation;
  page: number;
  batch?: number;
}

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_KEYS_SHOWN = 30;

function jsonType(value: unknown): OwnerrezResponseShape["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  return t === "object" ||
    t === "string" ||
    t === "number" ||
    t === "boolean" ||
    t === "undefined"
    ? t
    : "other";
}

function safeKeys(value: object): { keys: string[]; redacted: number } {
  const all = Object.keys(value);
  const shown = all.filter((k) => SAFE_KEY.test(k)).sort();
  return {
    keys: shown.slice(0, MAX_KEYS_SHOWN),
    redacted: all.length - Math.min(shown.length, MAX_KEYS_SHOWN),
  };
}

export function describeOwnerrezResponseShape(
  value: unknown,
): OwnerrezResponseShape {
  const type = jsonType(value);
  if (type === "object") {
    const { keys, redacted } = safeKeys(value as object);
    const items = (value as Record<string, unknown>).items;
    return {
      type,
      keys,
      ...(redacted > 0 && { redactedKeyCount: redacted }),
      ...(items !== undefined &&
        !Array.isArray(items) && { itemsType: jsonType(items) }),
    };
  }
  if (type === "array") {
    const array = value as unknown[];
    const first = array[0];
    if (jsonType(first) === "object") {
      const { keys, redacted } = safeKeys(first as object);
      return {
        type,
        length: array.length,
        firstElementKeys: keys,
        ...(redacted > 0 && { firstElementRedactedKeyCount: redacted }),
      };
    }
    return { type, length: array.length };
  }
  return { type };
}

function formatShape(shape: OwnerrezResponseShape): string {
  if (shape.type === "object") {
    const redacted = shape.redactedKeyCount
      ? ` (+${shape.redactedKeyCount} redacted)`
      : "";
    const items = shape.itemsType
      ? `; "items" is ${shape.itemsType}, not an array`
      : "";
    return `object with keys [${(shape.keys ?? []).join(", ")}]${redacted}${items}`;
  }
  if (shape.type === "array") {
    const first = shape.firstElementKeys
      ? `, first element keys [${shape.firstElementKeys.join(", ")}]${shape.firstElementRedactedKeyCount ? ` (+${shape.firstElementRedactedKeyCount} redacted)` : ""}`
      : "";
    return `array of length ${shape.length}${first}`;
  }
  return shape.type;
}

export class OwnerrezUnexpectedResponseError extends Error {
  constructor(readonly diagnostic: OwnerrezResponseDiagnostic) {
    const where = `${diagnostic.operation} (page ${diagnostic.page}${diagnostic.batch ? `, batch ${diagnostic.batch}` : ""})`;
    super(
      `OwnerRez returned an unexpected response for ${where}: ${formatShape(diagnostic)}.`,
    );
    this.name = "OwnerrezUnexpectedResponseError";
  }
}

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
    throw new Error("OwnerRez returned a malformed pagination URL.");
  }

  if (url.origin !== API_ORIGIN) {
    throw new Error(
      "Refusing to follow OwnerRez pagination URL with unexpected host.",
    );
  }

  if (!url.pathname.startsWith(expectedPathPrefix)) {
    throw new Error(
      "Refusing to follow OwnerRez pagination URL with unexpected path.",
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

/**
 * Operational booking retrieval (2026-09-27, OwnerRez step 1). OwnerRez's
 * own docs (GET /v2/bookings):
 *   - `since_utc`: "Filter for bookings created or changed since a specific
 *     date (UTC)." — so the 90-day default misses any booking created and
 *     last changed more than 90 days ago, even if the guest arrives
 *     tomorrow or is in the house today.
 *   - `from`: "Filter for bookings that depart on or after a specific date
 *     (in property timezone)."
 *   - "Either property_ids or since_utc is required." — so a stay-window
 *     query must be scoped by `property_ids`.
 * listOperationalBookings() therefore unions two documented queries:
 *   A. recent changes: `since_utc` = now − 90 days (unchanged — new
 *      bookings, cancellations, recent departures);
 *   B. stay window: `property_ids` = every OwnerRez property (active and
 *      inactive) + `from` = yesterday, i.e. every booking departing
 *      yesterday or later, however long ago it was booked (in-house now,
 *      arrivals, all future stays). Past stays older than that are not
 *      re-downloaded.
 * Merged by booking id; for a booking returned by both, the copy with the
 * later `updated_utc` wins.
 */
export const OPERATIONAL_STAY_WINDOW_BUFFER_DAYS = 1;
const PROPERTY_IDS_PER_BOOKINGS_QUERY = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OperationalBookingsResult {
  bookings: OwnerrezBooking[];
  stats: {
    recentChanges: number;
    stayWindow: number;
    merged: number;
    propertiesQueried: number;
    stayWindowFrom: string;
  };
}

function laterUpdated(a: OwnerrezBooking, b: OwnerrezBooking): OwnerrezBooking {
  const ta = Date.parse(a.updated_utc);
  const tb = Date.parse(b.updated_utc);
  return !Number.isNaN(tb) && (Number.isNaN(ta) || tb > ta) ? b : a;
}

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
/**
 * OwnerRez's documented API limit is 300 requests per 5 minutes (see
 * HANDOFF.md's researched per-provider limits). A client created with a
 * `requestBudget` (2026-09-28, the reservation sync) refuses to send more
 * than that many requests in its lifetime, and after an HTTP 429 refuses
 * every further request — no sleeps, no retries. Callers treat this error
 * as "defer the rest to a later run", never as data.
 */
export class OwnerrezRequestBudgetError extends Error {
  constructor(readonly reason: "BUDGET_EXHAUSTED" | "RATE_LIMITED") {
    super(
      reason === "RATE_LIMITED"
        ? "OwnerRez rate limit reached (HTTP 429) — no further OwnerRez requests this run."
        : "OwnerRez request budget for this run reached — no further OwnerRez requests this run.",
    );
    this.name = "OwnerrezRequestBudgetError";
  }
}

export class OwnerrezClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "OWNERREZ" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;
  private readonly requestBudget: number | undefined;
  private requestsMade = 0;
  private rateLimited = false;

  constructor(
    private readonly credentials: OwnerrezCredentials,
    options?: { requestBudget?: number },
  ) {
    this.requestBudget = options?.requestBudget;
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

  /** Requests sent by this client instance so far, and whether OwnerRez answered 429. */
  get usage(): {
    requestsMade: number;
    requestBudget: number | null;
    rateLimited: boolean;
  } {
    return {
      requestsMade: this.requestsMade,
      requestBudget: this.requestBudget ?? null,
      rateLimited: this.rateLimited,
    };
  }

  /**
   * The only way this client talks to OwnerRez: a plain GET. Enforces the
   * optional per-instance request budget before sending (the counter is
   * incremented synchronously, so concurrent callers can't overshoot it)
   * and stops all further requests after a 429. The shared HttpClient
   * already never retries a 4xx.
   */
  private async get<T>(path: string): Promise<T> {
    if (this.rateLimited) {
      throw new OwnerrezRequestBudgetError("RATE_LIMITED");
    }
    if (
      this.requestBudget !== undefined &&
      this.requestsMade >= this.requestBudget
    ) {
      throw new OwnerrezRequestBudgetError("BUDGET_EXHAUSTED");
    }
    this.requestsMade++;
    try {
      return await this.http.request<T>(path);
    } catch (err) {
      if (err instanceof HttpRequestError && err.status === 429) {
        this.rateLimited = true;
        throw new OwnerrezRequestBudgetError("RATE_LIMITED");
      }
      throw err;
    }
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.get<OwnerrezPage<OwnerrezProperty>>("/properties?page_size=1");
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
      await this.get<OwnerrezPage<OwnerrezProperty>>("/properties?page_size=1");
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
      await this.get<OwnerrezPage<OwnerrezProperty>>("/properties?page_size=1");
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
    context: { operation: OwnerrezPagedOperation; batch?: number },
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

      let page: unknown;
      try {
        page = await this.get<unknown>(path);
      } catch (err) {
        // Re-label a paged HTTP failure with the safe operation label: the
        // original message contains the request path and query values.
        if (err instanceof HttpRequestError) {
          throw new HttpRequestError(
            `OwnerRez ${context.operation} (page ${pageCount}${context.batch ? `, batch ${context.batch}` : ""})`,
            err.status,
          );
        }
        throw err;
      }
      if (
        page === null ||
        typeof page !== "object" ||
        Array.isArray(page) ||
        !Array.isArray((page as OwnerrezPage<T>).items)
      ) {
        throw new OwnerrezUnexpectedResponseError({
          operation: context.operation,
          page: pageCount,
          ...(context.batch !== undefined && { batch: context.batch }),
          ...describeOwnerrezResponseShape(page),
        });
      }
      const validPage = page as OwnerrezPage<T>;
      items.push(...validPage.items);

      path = validPage.next_page_url
        ? resolvePaginationPath(validPage.next_page_url, expectedPathPrefix)
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
      { operation: "properties:active" },
    );
    const inactive = await this.fetchAllPages<OwnerrezProperty>(
      "/properties?active=false",
      PROPERTIES_PATH_PREFIX,
      { operation: "properties:inactive" },
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
    return this.get<OwnerrezPropertyDetail>(`/properties/${id}`);
  }

  async listBookings(params?: {
    sinceUtc?: string;
  }): Promise<OwnerrezBooking[]> {
    const sinceUtc = params?.sinceUtc ?? defaultSinceUtc();
    return this.fetchAllPages<OwnerrezBooking>(
      `/bookings?since_utc=${encodeURIComponent(sinceUtc)}`,
      BOOKINGS_PATH_PREFIX,
      { operation: "bookings:recent-changes" },
    );
  }

  /**
   * Every booking the operational views need — see the "Operational
   * booking retrieval" notes near the top of this file.
   * Read-only (GETs only). Stay-window property ids are sent in chunks so a
   * large portfolio never produces an oversized URL; each query is fully
   * paginated with the same URL validation and guards as every other list.
   */
  async listOperationalBookings(options?: {
    now?: Date;
  }): Promise<OperationalBookingsResult> {
    const now = options?.now ?? new Date();
    const recent = await this.listBookings({
      sinceUtc: new Date(
        now.getTime() - DEFAULT_BOOKINGS_LOOKBACK_DAYS * DAY_MS,
      ).toISOString(),
    });
    const stay = await this.listStayWindowBookings({ now });

    const byId = new Map<number, OwnerrezBooking>();
    for (const booking of [...recent, ...stay.bookings]) {
      const existing = byId.get(booking.id);
      byId.set(
        booking.id,
        existing ? laterUpdated(existing, booking) : booking,
      );
    }

    return {
      bookings: [...byId.values()],
      stats: {
        recentChanges: recent.length,
        stayWindow: stay.bookings.length,
        merged: byId.size,
        propertiesQueried: stay.propertiesQueried,
        stayWindowFrom: stay.from,
      },
    };
  }

  /**
   * Stay window only (2026-09-28): every booking departing yesterday or
   * later — in-house now, arrivals, all future stays — however long ago it
   * was booked, via the documented `property_ids` + `from` filters (every
   * OwnerRez property, active and inactive, 50 ids per request). Used on
   * its own where only current/upcoming stays matter (dashboard "upcoming
   * bookings"), where recent-change history isn't needed and would cost
   * extra requests.
   */
  async listStayWindowBookings(options?: { now?: Date }): Promise<{
    bookings: OwnerrezBooking[];
    propertiesQueried: number;
    from: string;
  }> {
    const now = options?.now ?? new Date();
    const from = new Date(
      now.getTime() - OPERATIONAL_STAY_WINDOW_BUFFER_DAYS * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const propertyIds = (await this.listProperties()).map((p) => p.id);
    const bookings: OwnerrezBooking[] = [];
    for (
      let i = 0;
      i < propertyIds.length;
      i += PROPERTY_IDS_PER_BOOKINGS_QUERY
    ) {
      const ids = propertyIds.slice(i, i + PROPERTY_IDS_PER_BOOKINGS_QUERY);
      bookings.push(
        ...(await this.fetchAllPages<OwnerrezBooking>(
          `/bookings?property_ids=${ids.join(",")}&from=${from}`,
          BOOKINGS_PATH_PREFIX,
          {
            operation: "bookings:stay-window",
            batch: i / PROPERTY_IDS_PER_BOOKINGS_QUERY + 1,
          },
        )),
      );
    }
    return { bookings, propertiesQueried: propertyIds.length, from };
  }

  async getGuest(guestId: number): Promise<OwnerrezGuest> {
    return this.get<OwnerrezGuest>(`/guests/${guestId}`);
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
