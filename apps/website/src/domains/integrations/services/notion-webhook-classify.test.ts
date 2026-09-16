import { describe, expect, it } from "vitest";

import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";
import type { NotionWebhookEvent } from "../schemas/notion-webhook-event.schema";

import {
  classifyNotionWebhookEvent,
  isNotionWebhookEventExcluded,
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

describe("isNotionWebhookEventExcluded", () => {
  const excludedDbId = NOTION_SEARCH_EXCLUDED_DATABASE_IDS[0]!;

  it("excludes a database event when the entity IS an excluded database", () => {
    expect(
      isNotionWebhookEventExcluded(
        event({
          type: "database.schema_updated",
          entity: { id: excludedDbId, type: "database" },
        }),
      ),
    ).toBe(true);
  });

  it("excludes a page event when its parent database is excluded", () => {
    expect(
      isNotionWebhookEventExcluded(
        event({
          data: { parent: { type: "database_id", database_id: excludedDbId } },
        }),
      ),
    ).toBe(true);
  });

  it("does not exclude a page event with no parent info at all", () => {
    expect(isNotionWebhookEventExcluded(event({ data: {} }))).toBe(false);
  });

  it("does not exclude a page belonging to a non-excluded database", () => {
    expect(
      isNotionWebhookEventExcluded(
        event({
          data: {
            parent: { type: "database_id", database_id: "some-other-db" },
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not exclude a comment or data_source event — the rule only ever applies to page/database entities", () => {
    expect(
      isNotionWebhookEventExcluded(
        event({
          type: "comment.created",
          entity: { id: "c-1", type: "comment" },
        }),
      ),
    ).toBe(false);
  });

  it("never throws on a malformed parent shape", () => {
    expect(() =>
      isNotionWebhookEventExcluded(
        event({ data: { parent: "not-an-object" } }),
      ),
    ).not.toThrow();
  });
});
