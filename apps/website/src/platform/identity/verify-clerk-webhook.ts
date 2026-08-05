import "server-only";

import type { WebhookEvent } from "@clerk/nextjs/server";
import { Webhook } from "svix";

export interface ClerkWebhookHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

/** Svix-verifies a raw Clerk webhook payload. Throws if headers are missing or the signature is invalid. */
export function verifyClerkWebhook(
  rawBody: string,
  headers: ClerkWebhookHeaders,
  signingSecret: string,
): WebhookEvent {
  if (!headers.svixId || !headers.svixTimestamp || !headers.svixSignature) {
    throw new Error("Missing svix headers");
  }

  const wh = new Webhook(signingSecret);
  return wh.verify(rawBody, {
    "svix-id": headers.svixId,
    "svix-timestamp": headers.svixTimestamp,
    "svix-signature": headers.svixSignature,
  }) as WebhookEvent;
}
