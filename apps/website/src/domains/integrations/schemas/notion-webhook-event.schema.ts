import { z } from "zod";

/**
 * The one-time handshake Notion sends when a webhook subscription is first
 * created: a bare `{ verification_token }` body, no signature header (there
 * is nothing to sign against yet). The token must be read back and pasted
 * into Notion's subscription UI within 5 minutes — see
 * `notion-webhook-verification.service.ts`.
 */
export const notionWebhookVerificationRequestSchema = z.object({
  verification_token: z.string().min(1),
});

const notionWebhookEntitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(["page", "block", "database", "data_source", "comment"]),
});

const notionWebhookAuthorSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["person", "bot", "agent"]),
});

/**
 * Confirmed live against developers.notion.com/reference/webhooks-events-
 * delivery (2026-09-16) — the full set of event types Notion's webhook
 * platform currently delivers. Deliberately not extended with a `.catchall`
 * — an event type Notion adds later shows up as a schema-validation
 * failure (safe: dropped, logged, never silently misclassified) rather than
 * being guessed at.
 */
export const NOTION_WEBHOOK_EVENT_TYPES = [
  "page.created",
  "page.content_updated",
  "page.deleted",
  "page.locked",
  "page.moved",
  "page.properties_updated",
  "page.undeleted",
  "page.unlocked",
  "database.created",
  "database.content_updated",
  "database.deleted",
  "database.moved",
  "database.schema_updated",
  "database.undeleted",
  "data_source.created",
  "data_source.content_updated",
  "data_source.deleted",
  "data_source.moved",
  "data_source.schema_updated",
  "data_source.undeleted",
  "comment.created",
  "comment.deleted",
  "comment.updated",
] as const;

/**
 * The real event-notification payload shape (distinct from the
 * verification handshake above). `data` is deliberately typed loosely
 * (`z.record`) — its shape varies per event type and this schema only
 * needs the fields every event shares to route/store/classify the event;
 * see `classifyNotionWebhookEvent` for the event-specific extraction, which
 * treats every field it reads from `data` as optional/best-effort.
 */
export const notionWebhookEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  workspace_id: z.string().min(1),
  workspace_name: z.string().optional(),
  subscription_id: z.string().min(1),
  integration_id: z.string().min(1),
  type: z.enum(NOTION_WEBHOOK_EVENT_TYPES),
  authors: z.array(notionWebhookAuthorSchema).optional(),
  accessible_by: z.array(z.unknown()).optional(),
  attempt_number: z.number().optional(),
  entity: notionWebhookEntitySchema,
  data: z.record(z.string(), z.unknown()).optional(),
});

export type NotionWebhookEvent = z.infer<typeof notionWebhookEventSchema>;
export type NotionWebhookEventType = NotionWebhookEvent["type"];
