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
} from "./types";

export type { OwnerrezBooking, OwnerrezProperty } from "./types";

const BASE_URL = "https://api.ownerreservations.com/v2";

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

  async listProperties(): Promise<OwnerrezProperty[]> {
    const page =
      await this.http.request<OwnerrezPage<OwnerrezProperty>>("/properties");
    return page.items;
  }

  async listBookings(params?: {
    sinceUtc?: string;
  }): Promise<OwnerrezBooking[]> {
    const sinceUtc = params?.sinceUtc ?? defaultSinceUtc();
    const page = await this.http.request<OwnerrezPage<OwnerrezBooking>>(
      `/bookings?since_utc=${encodeURIComponent(sinceUtc)}`,
    );
    return page.items;
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
