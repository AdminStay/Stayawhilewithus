import type { IntegrationProvider, SyncDirection } from "@stayw/database/enums";

export type IntegrationCapability =
  "sync" | "webhook" | "messaging" | "media-upload";

/**
 * Every provider client implements this. Only connect/disconnect/authenticate/
 * healthCheck/validateCredentials are universal — anything provider-specific
 * (sync, receiving webhooks, sending messages, uploading media) is declared
 * via `capabilities` and implemented through the capability interfaces below,
 * narrowed at call sites with the type guards in ./capabilities.
 */
export interface BaseIntegrationClient {
  readonly provider: IntegrationProvider;
  readonly capabilities: readonly IntegrationCapability[];
  connect(): Promise<{ connected: boolean; connectedAt: Date }>;
  disconnect(): Promise<void>;
  authenticate(): Promise<void>;
  healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }>;
  validateCredentials(): Promise<{ valid: boolean; reason?: string }>;
}

/** Provider can pull/push records in bulk (e.g. reservation sync, device state reconciliation). */
export interface SyncCapable {
  sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }>;
}

/** Provider can push events into our system via an inbound webhook. */
export interface WebhookReceivable {
  receiveWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }>;
}

/** Provider can send an outbound message (SMS, chat, email). */
export interface MessagingCapable {
  sendMessage(
    to: string,
    body: string,
  ): Promise<{ externalMessageId: string; sentAt: Date }>;
}

/** Provider can accept a media upload (e.g. an attachment). */
export interface MediaUploadCapable {
  uploadMedia(
    fileRef: string,
    contentType: string,
  ): Promise<{ externalMediaId: string; url?: string }>;
}
