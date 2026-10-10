import "server-only";

import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import { NotionClient } from "@stayw/integrations/notion";

import { notionWebhookEventSchema } from "../schemas/notion-webhook-event.schema";

import { enrichStoredNotionEvent } from "./notion-event-enrichment.service";
import {
  classifyNotionWebhookEvent,
  resolveNotionWebhookExclusion,
  type NotionDataSourceParentLookup,
} from "./notion-webhook-classify";
import { verifyNotionWebhookSignature } from "./notion-webhook-signature";

import { isUniqueConstraintViolation } from "@/domains/properties/services/ownerrez-link.service";

export type ProcessNotionWebhookEventResult =
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "invalid_payload"; error: string }
  | { status: "excluded" }
  /** The exclusion check couldn't run (lookup failed) — nothing stored; Notion should redeliver. */
  | { status: "retry_later" }
  | { status: "duplicate" }
  | { status: "processed"; eventId: string };

// Data source → database never changes, so a successful lookup is cached
// for the life of the server instance (definitive nulls are not cached).
const dataSourceDatabaseCache = new Map<string, string>();

/**
 * Read-only `GET /data_sources/{id}` via the existing NotionClient. 403/404
 * (the integration can't see it) → null, which the exclusion rule treats as
 * excluded (fail closed). Any other failure, or no NOTION_API_KEY, throws →
 * "retry_later" for events that need the lookup.
 */
const defaultDataSourceParentLookup: NotionDataSourceParentLookup = async (
  dataSourceId,
) => {
  const cached = dataSourceDatabaseCache.get(dataSourceId);
  if (cached) return cached;
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY is not configured");
  try {
    const databaseId = await new NotionClient({
      token,
    }).getDataSourceParentDatabaseId(dataSourceId);
    if (databaseId) dataSourceDatabaseCache.set(dataSourceId, databaseId);
    return databaseId;
  } catch (err) {
    if (
      err instanceof HttpRequestError &&
      (err.status === 403 || err.status === 404)
    ) {
      return null;
    }
    throw err;
  }
};

/**
 * The full receive-a-real-Notion-event pipeline: verify signature → parse →
 * apply the same staff/contact-directory exclusion "Search Notion" uses
 * (resolveNotionWebhookExclusion — a database row's data source is resolved
 * to its database with one read-only, cached GET) → classify → dedupe by
 * Notion's own event id → store. Nothing is ever written back to Notion.
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
  lookupDataSourceParent: NotionDataSourceParentLookup = defaultDataSourceParentLookup,
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

  const exclusion = await resolveNotionWebhookExclusion(
    event,
    lookupDataSourceParent,
  );
  if (exclusion === "excluded") return { status: "excluded" };
  if (exclusion === "unresolved") {
    // Fail closed: never store an event whose directory status is unknown.
    console.warn(
      "[notion-webhook] exclusion check unavailable; asking Notion to redeliver",
    );
    return { status: "retry_later" };
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
        authors: classified.authors,
        parentType: classified.parent?.type ?? null,
        parentId: classified.parent?.id ?? null,
        attemptNumber: classified.attemptNumber,
      },
    });
    // Best-effort, after the raw event is safely stored — a Notion lookup
    // failure never loses or rejects the event itself. N2 stores and shows
    // activity only; no notification is sent from here.
    await enrichStoredNotionEvent(created.id, classified);
    return { status: "processed", eventId: created.id };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return { status: "duplicate" };
    }
    throw err;
  }
}
