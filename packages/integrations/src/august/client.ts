import type { SyncDirection } from "@stayw/database/enums";

import { NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type { AugustCredentials } from "./types";

/**
 * August integration client. Structural stub for Phase 1 — every method
 * throws NotImplementedError until this integration is built out (see the
 * roadmap in 03 Documentation/roadmap/development-roadmap.md).
 */
export class AugustClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "AUGUST" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  constructor(private readonly credentials: AugustCredentials) {}

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    throw new NotImplementedError("August", "connect");
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError("August", "disconnect");
  }

  async authenticate(): Promise<void> {
    throw new NotImplementedError("August", "authenticate");
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    throw new NotImplementedError("August", "healthCheck");
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    throw new NotImplementedError("August", "validateCredentials");
  }

  async sync(
    _direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    throw new NotImplementedError("August", "sync");
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("August", "receiveWebhook");
  }
}
