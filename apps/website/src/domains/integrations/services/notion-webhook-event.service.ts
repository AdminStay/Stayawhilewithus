import "server-only";

import { prisma } from "@stayw/database";

import { notionWebhookEventSchema } from "../schemas/notion-webhook-event.schema";

import {
  isNotionWebhookEventExcluded,
  classifyNotionWebhookEvent,
} from "./notion-webhook-classify";
import { verifyNotionWebhookSignature } from "./notion-webhook-signature";

import { isUniqueConstraintViolation } from "@/domains/properties/services/ownerrez-link.service";

export type ProcessNotionWebhookEventResult =
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "invalid_payload"; error: string }
  | { status: "excluded" }
  | { status: "duplicate" }
  | { status: "processed"; eventId: string };

/**
 * The full receive-a-real-Notion-event pipeline: verify signature → parse →
 * classify → apply the same staff/contact-directory exclusion "Search
 * Notion" uses → dedupe by Notion's own event id → store. Nothing here ever
 * calls out to Notion or writes anything back — strictly an inbound sink.
 *
 * **This function is never reachable in Production today.** No real Notion
 * webhook subscription has been created (that requires a public HTTPS URL
 * and completing Notion's one-time verification handshake — a genuine
 * external-system action requiring separate approval, see HANDOFF.md's
 * Notion section). It exists, and is fully tested, so that step is a
 * config/registration action away rather than a coding project, once
 * approved.
 *
 * Fails closed on missing configuration: `NOTION_WEBHOOK_VERIFICATION_TOKEN`
 * unset means signature verification is impossible, so nothing is ever
 * trusted or stored, matching the same "no configured secret → no
 * processing" rule every other optional integration in this codebase
 * follows (see `process.env.NOTION_API_KEY` gating in
 * integrations.service.ts).
 */
export async function processNotionWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): Promise<ProcessNotionWebhookEventResult> {
  const verificationToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
  if (!verificationToken) return { status: "not_configured" };

  if (
    !verifyNotionWebhookSignature(rawBody, signatureHeader, verificationToken)
  ) {
    return { status: "invalid_signature" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return { status: "invalid_payload", error: "Body is not valid JSON" };
  }

  const result = notionWebhookEventSchema.safeParse(parsedJson);
  if (!result.success) {
    return { status: "invalid_payload", error: result.error.message };
  }

  const event = result.data;

  if (isNotionWebhookEventExcluded(event)) {
    return { status: "excluded" };
  }

  const classified = classifyNotionWebhookEvent(event);

  const existing = await prisma.notionPageEvent.findUnique({
    where: { notionEventId: classified.notionEventId },
    select: { id: true },
  });
  if (existing) return { status: "duplicate" };

  // findUnique-then-create is not atomic: two concurrent deliveries of the
  // same Notion event (a real possibility — Notion retries on anything but
  // a fast 2xx) can both pass the check above before either commits. The
  // unique constraint on notionEventId (schema.prisma) still guarantees at
  // most one row ever exists — this only catches the resulting P2002 on the
  // loser and reports it the same way the sequential check above does,
  // rather than surfacing it as an unhandled 500.
  try {
    const created = await prisma.notionPageEvent.create({
      data: {
        notionEventId: classified.notionEventId,
        entityId: classified.entityId,
        entityType: classified.entityType,
        eventType: classified.eventType,
        changedFieldNames: classified.changedFieldNames,
        occurredAt: classified.occurredAt,
      },
    });
    return { status: "processed", eventId: created.id };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return { status: "duplicate" };
    }
    throw err;
  }
}
