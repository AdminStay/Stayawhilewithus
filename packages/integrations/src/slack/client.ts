import { HttpClient } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  MessagingCapable,
  WebhookReceivable,
} from "../core";

import type {
  SlackApiResponse,
  SlackCredentials,
  SlackPostMessageResponse,
} from "./types";
import { verifySlackSignature } from "./verify-signature";

const BASE_URL = "https://slack.com/api";

/**
 * Slack Web API client — real HTTP calls via HttpClient (Bearer bot token).
 * Every Slack API response is HTTP 200 even on failure, with `ok: false` +
 * an `error` string in the body, so success is checked on the body, not the
 * status code.
 */
export class SlackClient
  implements BaseIntegrationClient, WebhookReceivable, MessagingCapable
{
  readonly provider = "SLACK" as const;
  readonly capabilities = [
    "webhook",
    "messaging",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: SlackCredentials) {
    this.http = new HttpClient({
      baseUrl: BASE_URL,
      headers: {
        Authorization: `Bearer ${credentials.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    const result = await this.validateCredentials();
    if (!result.valid) {
      throw new Error(result.reason ?? "Slack credentials are invalid.");
    }
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Bot tokens aren't sessions — nothing to tear down server-side.
  }

  async authenticate(): Promise<void> {
    await this.connect();
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    const result = await this.validateCredentials();
    return {
      healthy: result.valid,
      checkedAt: new Date(),
      details: result.reason,
    };
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    try {
      const response = await this.http.request<
        SlackApiResponse & { user_id?: string; team?: string }
      >("/auth.test", { method: "POST" });
      if (!response.ok) {
        return {
          valid: false,
          reason: response.error ?? "unknown Slack API error",
        };
      }
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async sendMessage(
    to: string,
    body: string,
  ): Promise<{ externalMessageId: string; sentAt: Date }> {
    const response = await this.http.request<SlackPostMessageResponse>(
      "/chat.postMessage",
      {
        method: "POST",
        body: JSON.stringify({ channel: to, text: body }),
      },
    );

    if (!response.ok) {
      throw new Error(`Slack chat.postMessage failed: ${response.error}`);
    }

    return { externalMessageId: response.ts, sentAt: new Date() };
  }

  /**
   * Verifies Slack's v0 signature scheme before treating the payload as
   * accepted. Actual event routing (message vs. interactivity vs. slash
   * command) is left to the caller — this only answers "is this genuinely
   * from Slack."
   */
  async receiveWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];
    if (!timestamp || !signature) {
      return { accepted: false };
    }

    const valid = verifySlackSignature(
      rawBody,
      { timestamp, signature },
      this.credentials.signingSecret,
    );
    if (!valid) {
      return { accepted: false };
    }

    return { accepted: true, entityType: "slack.event" };
  }
}
