import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

const DEFAULT_LIMIT = 20;

/**
 * The dashboard-facing shape of a stored NotionPageEvent — deliberately
 * exposes only a changed-field COUNT, never the field ids/names themselves
 * (Notion property ids aren't human-readable labels anyway, and per the
 * client's explicit requirement, no changed value — sensitive or
 * otherwise — is ever surfaced here).
 */
export interface NotionActivityItem {
  id: string;
  entityId: string;
  entityType: string;
  eventType: string;
  changedFieldCount: number;
  occurredAt: Date;
}

/**
 * Backs the "Recent Notion Activity" dashboard section. Gated by
 * `notion:read` (granted to ops_manager today, matching the visibility
 * design in notion-field-visibility.ts) rather than the broader
 * `integrations:read` the older listing/search reads still use — this is
 * new functionality, not a change to those already-Production-verified
 * paths.
 *
 * Reads only from NotionPageEvent, which today is never populated by a
 * real Notion subscription (see notion-webhook-event.service.ts) — so this
 * correctly returns an empty list until that's wired up, rather than
 * fabricating activity.
 */
export async function listRecentNotionActivity(
  actor: AuthContext,
  limit: number = DEFAULT_LIMIT,
): Promise<NotionActivityItem[]> {
  await assertPermission(actor, "notion:read");

  const rows = await prisma.notionPageEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    entityId: row.entityId,
    entityType: row.entityType,
    eventType: row.eventType,
    changedFieldCount: Array.isArray(row.changedFieldNames)
      ? row.changedFieldNames.length
      : 0,
    occurredAt: row.occurredAt,
  }));
}
