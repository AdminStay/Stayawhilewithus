import "server-only";

import { prisma, type Prisma } from "@stayw/database";
import { NotionClient } from "@stayw/integrations/notion";

import { NOTION_SOPS_ROOT_PAGE_ID } from "../config/notion-sop-library";

import { createNotionVisibilityResolver } from "./notion-access.service";
import {
  buildNotionEventDetails,
  type NotionEventDetails,
} from "./notion-event-enrichment";
import type { NotionClassifiedEvent } from "./notion-webhook-classify";

// Names rarely change; cache them for the life of the server instance.
const userNameCache = new Map<string, { name: string | null; at: number }>();
const USER_NAME_TTL_MS = 60 * 60 * 1000;

/**
 * Best-effort enrichment of one stored event (2026-09-30). Called after the
 * raw event row is committed; any failure is logged by error class only and
 * leaves the raw row intact. Makes only read-only Notion calls.
 */
export async function enrichStoredNotionEvent(
  eventRowId: string,
  classified: NotionClassifiedEvent,
): Promise<NotionEventDetails | null> {
  const token = process.env.NOTION_API_KEY;
  if (!token) return null;
  try {
    const client = new NotionClient({ token });
    const resolve = await createNotionVisibilityResolver(client, 12);
    const listingsIds = process.env.NOTION_LISTINGS_DATA_SOURCE_ID
      ? await client
          .getDataSourceParentDatabaseId(
            process.env.NOTION_LISTINGS_DATA_SOURCE_ID,
          )
          .then((id) => (id ? [id] : []))
          .catch(() => [])
      : [];
    const details = await buildNotionEventDetails(classified, {
      getPageMetadata: (id) => client.getPageMetadata(id),
      getObjectParent: (kind, id) => client.getObjectParent(kind, id),
      getDatabaseTitle: (id) => client.getDatabaseTitle(id),
      getUserDisplayName: async (id) => {
        const hit = userNameCache.get(id);
        if (hit && Date.now() - hit.at < USER_NAME_TTL_MS) return hit.name;
        const name = await client.getUserDisplayName(id);
        userNameCache.set(id, { name, at: Date.now() });
        return name;
      },
      resolveVisibility: (kind, id) => resolve(kind, id),
      sopRootPageId: NOTION_SOPS_ROOT_PAGE_ID,
      listingsDatabaseIds: listingsIds,
    });
    await prisma.notionPageEvent.update({
      where: { id: eventRowId },
      data: {
        details: details as unknown as Prisma.InputJsonValue,
        enrichedAt: new Date(),
      },
    });
    return details;
  } catch (err) {
    console.error(
      "[notion-webhook] enrichment failed:",
      err instanceof Error ? err.name : "unknown",
    );
    return null;
  }
}
