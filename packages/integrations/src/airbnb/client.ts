import type { SyncDirection } from "@stayw/database/enums";

import { NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type { AirbnbCredentials } from "./types";

/**
 * Airbnb integration client. Structural stub for Phase 1 — every method
 * throws NotImplementedError until this integration is built out (see the
 * roadmap in 03 Documentation/roadmap/development-roadmap.md).
 */
export class AirbnbClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "AIRBNB" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  constructor(private readonly credentials: AirbnbCredentials) {}

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    throw new NotImplementedError("Airbnb", "connect");
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError("Airbnb", "disconnect");
  }

  async authenticate(): Promise<void> {
    throw new NotImplementedError("Airbnb", "authenticate");
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    throw new NotImplementedError("Airbnb", "healthCheck");
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    throw new NotImplementedError("Airbnb", "validateCredentials");
  }

  async sync(
    _direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    throw new NotImplementedError("Airbnb", "sync");
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("Airbnb", "receiveWebhook");
  }
}
