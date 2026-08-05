import type { SyncDirection } from "@stayw/database/enums";

import { NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type { OwnerrezCredentials } from "./types";

/**
 * OwnerRez integration client. Structural stub for Phase 1 — every method
 * throws NotImplementedError until this integration is built out (see the
 * roadmap in 03 Documentation/roadmap/development-roadmap.md).
 */
export class OwnerrezClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "OWNERREZ" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  constructor(private readonly credentials: OwnerrezCredentials) {}

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    throw new NotImplementedError("OwnerRez", "connect");
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError("OwnerRez", "disconnect");
  }

  async authenticate(): Promise<void> {
    throw new NotImplementedError("OwnerRez", "authenticate");
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    throw new NotImplementedError("OwnerRez", "healthCheck");
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    throw new NotImplementedError("OwnerRez", "validateCredentials");
  }

  async sync(
    _direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    throw new NotImplementedError("OwnerRez", "sync");
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("OwnerRez", "receiveWebhook");
  }
}
