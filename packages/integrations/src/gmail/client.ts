import { NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  MessagingCapable,
  WebhookReceivable,
} from "../core";

import type { GmailCredentials } from "./types";

/**
 * Gmail integration client. Structural stub for Phase 1 — every method
 * throws NotImplementedError until this integration is built out (see the
 * roadmap in 03 Documentation/roadmap/development-roadmap.md).
 */
export class GmailClient
  implements BaseIntegrationClient, WebhookReceivable, MessagingCapable
{
  readonly provider = "GMAIL" as const;
  readonly capabilities = [
    "webhook",
    "messaging",
  ] as const satisfies readonly IntegrationCapability[];

  constructor(private readonly credentials: GmailCredentials) {}

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    throw new NotImplementedError("Gmail", "connect");
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError("Gmail", "disconnect");
  }

  async authenticate(): Promise<void> {
    throw new NotImplementedError("Gmail", "authenticate");
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    throw new NotImplementedError("Gmail", "healthCheck");
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    throw new NotImplementedError("Gmail", "validateCredentials");
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("Gmail", "receiveWebhook");
  }

  async sendMessage(
    _to: string,
    _body: string,
  ): Promise<{ externalMessageId: string; sentAt: Date }> {
    throw new NotImplementedError("Gmail", "sendMessage");
  }
}
