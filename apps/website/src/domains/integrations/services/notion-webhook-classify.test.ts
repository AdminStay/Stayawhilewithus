import { describe, expect, it, vi } from "vitest";

import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";
import type { NotionWebhookEvent } from "../schemas/notion-webhook-event.schema";

import {
  classifyNotionWebhookEvent,
  resolveNotionWebhookExclusion,
} from "./notion-webhook-classify";

function event(
  overrides: Partial<NotionWebhookEvent> = {},
): NotionWebhookEvent {
  return {
    id: "evt-1",
    timestamp: "2026-09-16T12:00:00.000Z",
    workspace_id: "ws-1",
    subscription_id: "sub-1",
    integration_id: "int-1",
    type: "page.properties_updated",
    entity: { id: "page-1", type: "page" },
    data: {},
    ...overrides,
  };
}

describe("classifyNotionWebhookEvent", () => {
  it("normalizes the shared fields regardless of event type", () => {
    const result = classifyNotionWebhookEvent(event());
    expect(result.notionEventId).toBe("evt-1");
    expect(result.entityId).toBe("page-1");
    expect(result.entityType).toBe("page");
    expect(result.eventType).toBe("page.properties_updated");
    expect(result.occurredAt).toEqual(new Date("2026-09-16T12:00:00.000Z"));
  });

  it("extracts changed property ids for page.properties_updated, never values", () => {
    const result = classifyNotionWebhookEvent(
      event({
        data: { updated_properties: ["prop-abc", "prop-def"], parent: {} },
      }),
    );
    expect(result.changedFieldNames).toEqual(["prop-abc", "prop-def"]);
  });

  it("extracts changed block ids for page.content_updated", () => {
    const result = classifyNotionWebhookEvent(
      event({
        type: "page.content_updated",
        data: {
          updated_blocks: [{ id: "block-1" }, { id: "block-2" }],
          parent: {},
        },
      }),
    );
    expect(result.changedFieldNames).toEqual(["block-1", "block-2"]);
  });

  it("returns an empty changed-field list for page.deleted", () => {
    const result = classifyNotionWebhookEvent(
      event({ type: "page.deleted", data: { parent: {} } }),
    );
    expect(result.changedFieldNames).toEqual([]);
  });

  it("returns an empty list defensively when data is missing entirely", () => {
    const result = classifyNotionWebhookEvent(event({ data: undefined }));
    expect(result.changedFieldNames).toEqual([]);
  });

  it("returns an empty list defensively when updated_properties isn't an array of strings", () => {
    const result = classifyNotionWebhookEvent(
      event({ data: { updated_properties: "not-an-array" } }),
    );
    expect(result.changedFieldNames).toEqual([]);
  });
});

// Staff/contact-directory exclusion (2026-10-11 fix). Payloads below use the
// real webhook shape for API 2026-03-11 (developers.notion.com/reference/
// webhooks-events-delivery): `data.parent: { id, type }`, a database row's
// parent is its DATA SOURCE, and `data_source.*` events carry the data source
// as the entity. The lookup stands in for GET /data_sources/{id}.
describe("resolveNotionWebhookExclusion", () => {
  const PEOPLE_DB = NOTION_SEARCH_EXCLUDED_DATABASE_IDS[0]!; // People
  const CONTACT_DB = NOTION_SEARCH_EXCLUDED_DATABASE_IDS[2]!; // Contact List
  const PEOPLE_DS = "11111111-aaaa-4bbb-8ccc-000000000001";
  const CONTACT_DS = "11111111-aaaa-4bbb-8ccc-000000000002";
  const LIBRARY_DB = "e54961ca-c27c-4bbd-b4b3-a766d9b0dd64"; // LIBRARY (operational)
  const LIBRARY_DS = "11111111-aaaa-4bbb-8ccc-000000000003";

  const parentsByDataSource: Record<string, string> = {
    [PEOPLE_DS]: PEOPLE_DB,
    [CONTACT_DS]: CONTACT_DB,
    [LIBRARY_DS]: LIBRARY_DB,
  };
  const lookup = vi.fn(async (id: string) => parentsByDataSource[id] ?? null);
  const neverCalled = vi.fn(async () => {
    throw new Error("lookup should not be needed");
  });

  describe("staff/contact-directory events are EXCLUDED", () => {
    it.each([
      ["page.properties_updated", PEOPLE_DS],
      ["page.content_updated", CONTACT_DS],
      ["page.created", PEOPLE_DS],
      ["page.deleted", CONTACT_DS],
      ["page.moved", PEOPLE_DS],
    ] as const)(
      "%s on a row whose parent is a directory DATA SOURCE (2026-03-11 shape)",
      async (type, dataSourceId) => {
        expect(
          await resolveNotionWebhookExclusion(
            event({
              type,
              entity: { id: "row-page", type: "page" },
              data: { parent: { id: dataSourceId, type: "data_source" } },
            }),
            lookup,
          ),
        ).toBe("excluded");
        expect(lookup).toHaveBeenCalledWith(dataSourceId);
      },
    );

    it.each([
      "data_source.schema_updated",
      "data_source.content_updated",
      "data_source.created",
      "data_source.deleted",
    ] as const)("%s whose entity IS a directory data source", async (type) => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            type,
            entity: { id: PEOPLE_DS, type: "data_source" },
            data: { parent: { id: PEOPLE_DB, type: "database" } },
          }),
          lookup,
        ),
      ).toBe("excluded");
    });

    it("a database.* event whose entity IS a directory database (no lookup)", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            type: "database.moved",
            entity: { id: PEOPLE_DB, type: "database" },
          }),
          neverCalled,
        ),
      ).toBe("excluded");
    });

    it("a page whose parent is given directly as a directory DATABASE ({ id, type: 'database' })", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({ data: { parent: { id: CONTACT_DB, type: "database" } } }),
          neverCalled,
        ),
      ).toBe("excluded");
    });

    it("the older API-object shape is still recognized ({ type: 'database_id', database_id })", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            data: { parent: { type: "database_id", database_id: PEOPLE_DB } },
          }),
          neverCalled,
        ),
      ).toBe("excluded");
    });

    it("matches ids with or without dashes, any case", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            data: {
              parent: {
                id: PEOPLE_DB.replace(/-/g, "").toUpperCase(),
                type: "database",
              },
            },
          }),
          neverCalled,
        ),
      ).toBe("excluded");
    });
  });

  describe("ordinary operational events stay VISIBLE (allowed)", () => {
    it("a row in a non-directory data source (e.g. LIBRARY)", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            entity: { id: "sop-row", type: "page" },
            data: { parent: { id: LIBRARY_DS, type: "data_source" } },
          }),
          lookup,
        ),
      ).toBe("allowed");
    });

    it("a data_source.schema_updated on a non-directory data source", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            type: "data_source.schema_updated",
            entity: { id: LIBRARY_DS, type: "data_source" },
          }),
          lookup,
        ),
      ).toBe("allowed");
    });

    it.each([
      ["a sub-page (parent is a page)", { id: "parent-page", type: "page" }],
      [
        "a top-level page (parent is the workspace/space)",
        { id: "ws", type: "space" },
      ],
      ["a page nested in a block", { id: "blk", type: "block" }],
    ])("%s — no database, no lookup", async (_label, parent) => {
      expect(
        await resolveNotionWebhookExclusion(
          event({ data: { parent } }),
          neverCalled,
        ),
      ).toBe("allowed");
    });

    it("a page event with no parent info at all", async () => {
      expect(
        await resolveNotionWebhookExclusion(event({ data: {} }), neverCalled),
      ).toBe("allowed");
    });

    it("never throws on a malformed parent shape", async () => {
      await expect(
        resolveNotionWebhookExclusion(
          event({ data: { parent: "not-an-object" } }),
          neverCalled,
        ),
      ).resolves.toBe("allowed");
    });
  });

  describe("fail-closed when the data source can't be resolved", () => {
    it("Notion definitively won't say (lookup → null: no access / not found) → EXCLUDED", async () => {
      expect(
        await resolveNotionWebhookExclusion(
          event({
            data: { parent: { id: "unknown-ds", type: "data_source" } },
          }),
          lookup,
        ),
      ).toBe("excluded");
    });

    it("the lookup fails for another reason (network / 5xx) → UNRESOLVED (store nothing, retry)", async () => {
      const failing = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      expect(
        await resolveNotionWebhookExclusion(
          event({ data: { parent: { id: PEOPLE_DS, type: "data_source" } } }),
          failing,
        ),
      ).toBe("unresolved");
    });
  });
});
