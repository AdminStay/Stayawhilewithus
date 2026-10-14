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
 * `notion:manage`. The entity id is selected (Phase 0, 2026-10-15) only so
 * the view can build an "Open in Notion" link for rows this viewer may see;
 * it is never returned as a field of its own.
 *
 * Reads only stored events (the Notion webhook subscription has been live
 * in Production since 2026-10-11); an empty list means nothing has been
 * recorded, never fabricated activity.
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
      entityId: true,
      entityType: true,
      eventType: true,
      changedFieldNames: true,
      occurredAt: true,
      receivedAt: true,
      details: true,
    },
  });

  return rows.map((row) => toNotionActivityView(row, { canReadSensitive }));
}
