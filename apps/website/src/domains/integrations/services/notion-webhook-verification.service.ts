import "server-only";

import { notionWebhookVerificationRequestSchema } from "../schemas/notion-webhook-event.schema";

/**
 * The one-time handshake body Notion sends immediately after a webhook
 * subscription is created: `{ verification_token }`, unsigned (there is no
 * signature to check yet — the token itself is what becomes the signing
 * secret for every later event). Returns the token, or null if the body
 * doesn't match that shape (e.g. it's a real, already-signed event
 * instead).
 */
export function parseNotionWebhookVerificationRequest(
  rawBody: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const result = notionWebhookVerificationRequestSchema.safeParse(parsed);
  return result.success ? result.data.verification_token : null;
}
