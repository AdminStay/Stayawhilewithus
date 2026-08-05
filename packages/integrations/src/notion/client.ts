import type { SyncDirection } from "@stayw/database/enums";

import { NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
} from "../core";

import type { NotionCredentials } from "./types";

/**
 * Notion integration client. Structural stub for Phase 1 — every method
 * throws NotImplementedError until this integration is built out (see the
 * roadmap in 03 Documentation/roadmap/development-roadmap.md).
 */
export class NotionClient implements BaseIntegrationClient, SyncCapable {
  readonly provider = "NOTION" as const;
  readonly capabilities = [
    "sync",
  ] as const satisfies readonly IntegrationCapability[];

  constructor(private readonly credentials: NotionCredentials) {}

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    throw new NotImplementedError("Notion", "connect");
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError("Notion", "disconnect");
  }

  async authenticate(): Promise<void> {
    throw new NotImplementedError("Notion", "authenticate");
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    throw new NotImplementedError("Notion", "healthCheck");
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    throw new NotImplementedError("Notion", "validateCredentials");
  }

  async sync(
    _direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    throw new NotImplementedError("Notion", "sync");
  }
}
