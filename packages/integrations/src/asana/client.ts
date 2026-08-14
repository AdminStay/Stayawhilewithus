import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type {
  AsanaCredentials,
  AsanaListResponse,
  AsanaUser,
  AsanaWorkspace,
} from "./types";

const BASE_URL = "https://app.asana.com/api/1.0";

/**
 * Asana API client — real HTTP calls via HttpClient (Bearer personal access
 * token). `Task.asanaTaskId` already exists in the schema for this
 * integration to eventually target; nothing writes to it yet.
 */
export class AsanaClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "ASANA" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: AsanaCredentials) {
    this.http = new HttpClient({
      baseUrl: BASE_URL,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.http.request<AsanaListResponse<AsanaUser>>("/users/me");
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Personal access tokens aren't sessions — nothing to tear down server-side.
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
      await this.http.request<AsanaListResponse<AsanaUser>>("/users/me");
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
      await this.http.request<AsanaListResponse<AsanaUser>>("/users/me");
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Same reasoning as Notion: Asana has no single "list everything
   * relevant" endpoint, and which workspace/project StayWhile tasks should
   * sync against isn't decided yet. This lists the workspaces the token can
   * see as a real, generically meaningful connectivity + count check; it
   * does not write anything into StayWhile's database.
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "Asana sync only supports INBOUND until a write target (which workspace/project) is designed.",
      );
    }

    const response =
      await this.http.request<AsanaListResponse<AsanaWorkspace>>("/workspaces");
    return { recordsProcessed: response.data.length, direction };
  }

  /**
   * Asana webhook secrets are per-webhook (returned when the webhook is
   * created, via X-Hook-Secret on the handshake request) rather than a
   * single static account secret — there's nowhere to store/retrieve that
   * yet, so signature verification genuinely can't be implemented until a
   * webhook-registration flow exists, not just a credential.
   */
  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("Asana", "receiveWebhook");
  }
}
