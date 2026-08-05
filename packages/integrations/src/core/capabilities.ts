import type {
  BaseIntegrationClient,
  MediaUploadCapable,
  MessagingCapable,
  SyncCapable,
  WebhookReceivable,
} from "./types";

export function hasCapability(
  client: BaseIntegrationClient,
  capability: BaseIntegrationClient["capabilities"][number],
): boolean {
  return client.capabilities.includes(capability);
}

export function isSyncCapable(
  client: BaseIntegrationClient,
): client is BaseIntegrationClient & SyncCapable {
  return hasCapability(client, "sync");
}

export function isWebhookReceivable(
  client: BaseIntegrationClient,
): client is BaseIntegrationClient & WebhookReceivable {
  return hasCapability(client, "webhook");
}

export function isMessagingCapable(
  client: BaseIntegrationClient,
): client is BaseIntegrationClient & MessagingCapable {
  return hasCapability(client, "messaging");
}

export function isMediaUploadCapable(
  client: BaseIntegrationClient,
): client is BaseIntegrationClient & MediaUploadCapable {
  return hasCapability(client, "media-upload");
}
