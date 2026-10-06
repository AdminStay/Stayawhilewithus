import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  toNotionActivityView,
  type NotionActivityView,
} from "./notion-activity-view";

const DEFAULT_LIMIT = 20;

export type { NotionActivityView };

/**
 * Backs "Recent Notion Activity" (updated 2026-09-30). Gated by
 * `notion:read`. Each stored event becomes one readable line for THIS
 * viewer (see notion-activity-view.ts): who (only names Notion supplied),
 * what action, where (breadcrumb + title), which fields changed (names,
 * never values), when. Sensitive events are redacted for viewers without
 * `notion:manage`. Nothing here returns Notion ids — the entity id is not
 * even selected.
 *
 * Reads only stored events; returns an empty list until the webhook
 * subscription is registered, rather than fabricating activity.
 */
export async function listRecentNotionActivity(
  actor: AuthContext,
  limit: number = DEFAULT_LIMIT,
): Promise<NotionActivityView[]> {
  await assertPermission(actor, "notion:read");
  const canReadSensitive = await hasPermission(actor, "notion:manage");

  const rows = await prisma.notionPageEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      entityType: true,
      eventType: true,
      changedFieldNames: true,
      occurredAt: true,
      details: true,
    },
  });

  return rows.map((row) => toNotionActivityView(row, { canReadSensitive }));
}
