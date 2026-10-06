import { describe, expect, it, vi } from "vitest";

import type {
  NotionPageMetadata,
  NotionParentRef,
} from "@stayw/integrations/notion";

import { NOTION_LIBRARY_DATABASE_ID } from "../config/notion-visibility";

import {
  buildNotionEventDetails,
  notionActivityAction,
  propertyNamesFor,
  type NotionEnrichmentDeps,
} from "./notion-event-enrichment";
import type { NotionClassifiedEvent } from "./notion-webhook-classify";

// Fake workspace (only the real LIBRARY ids matter for classification).
const PROPERTY_DIRECTORY = "b3bb913f-4b06-44bf-b87c-a692c00f4790";
const PAGES: Record<string, NotionPageMetadata> = {
  [PROPERTY_DIRECTORY]: {
    id: PROPERTY_DIRECTORY,
    title: "Property Directory",
    parent: { type: "database", id: NOTION_LIBRARY_DATABASE_ID },
    inTrash: false,
    propertyNamesById: {},
  },
  "palm-haven": {
    id: "palm-haven",
    title: "Palm Haven",
    parent: { type: "page", id: PROPERTY_DIRECTORY },
    inTrash: false,
    propertyNamesById: {},
  },
  "router-page": {
    id: "router-page",
    title: "Router and Thermostat Location",
    parent: { type: "page", id: "palm-haven" },
    inTrash: false,
    propertyNamesById: {
      "XGe%40": "Router location",
      "bDf%5B": "Last checked",
    },
  },
  "trashed-sop": {
    id: "trashed-sop",
    title: "Old SOP",
    parent: { type: "page", id: "sop-root" },
    inTrash: true,
    propertyNamesById: {},
  },
};

function deps(
  overrides: Partial<NotionEnrichmentDeps> = {},
): NotionEnrichmentDeps {
  return {
    getPageMetadata: vi.fn(async (id: string) => {
      const p = PAGES[id];
      if (!p) throw new Error("404");
      return p;
    }),
    getObjectParent: vi.fn(async (): Promise<NotionParentRef> => ({
      type: "unknown",
      id: null,
    })),
    getDatabaseTitle: vi.fn(async () => null),
    getUserDisplayName: vi.fn(async (id: string) =>
      id === "user-michelle" ? "Michelle" : null,
    ),
    resolveVisibility: vi.fn(async () => "standard" as const),
    sopRootPageId: "sop-root",
    listingsDatabaseIds: [],
    ...overrides,
  };
}

function event(
  overrides: Partial<NotionClassifiedEvent> = {},
): NotionClassifiedEvent {
  return {
    notionEventId: "evt-1",
    entityId: "router-page",
    entityType: "page",
    eventType: "page.properties_updated",
    changedFieldNames: ["XGe%40"],
    occurredAt: new Date("2026-09-30T12:00:00.000Z"),
    authors: [{ id: "user-michelle", type: "person" }],
    parent: { type: "page", id: "palm-haven" },
    attemptNumber: 1,
    ...overrides,
  };
}

describe("notionActivityAction", () => {
  it("maps every supported event type to an operational action", () => {
    expect(notionActivityAction("page.created")).toBe("created");
    expect(notionActivityAction("page.properties_updated")).toBe(
      "updated_properties",
    );
    expect(notionActivityAction("page.content_updated")).toBe(
      "updated_content",
    );
    expect(notionActivityAction("page.moved")).toBe("moved");
    expect(notionActivityAction("page.deleted")).toBe("deleted");
    expect(notionActivityAction("page.undeleted")).toBe("restored");
    expect(notionActivityAction("database.schema_updated")).toBe(
      "schema_updated",
    );
    expect(notionActivityAction("comment.created")).toBe("commented");
    expect(notionActivityAction("page.something_new")).toBeNull();
  });
});

describe("propertyNamesFor", () => {
  it("matches URL-encoded ids (either form); unknown ids are dropped, not guessed", () => {
    const names = { "XGe%40": "Router location", "bDf%5B": "Last checked" };
    expect(propertyNamesFor(["XGe%40"], names)).toEqual(["Router location"]);
    expect(propertyNamesFor(["XGe@"], names)).toEqual(["Router location"]);
    expect(propertyNamesFor(["zzz", "bDf%5B"], names)).toEqual([
      "Last checked",
    ]);
  });
});

describe("buildNotionEventDetails", () => {
  it("who / what / where / which fields — from Notion data only", async () => {
    const d = await buildNotionEventDetails(event(), deps());
    expect(d).toEqual({
      version: 1,
      action: "updated_properties",
      title: "Router and Thermostat Location",
      breadcrumb: ["Library", "Property Directory", "Palm Haven"],
      visibility: "standard",
      libraryEntryId: PROPERTY_DIRECTORY,
      actors: [{ type: "person", name: "Michelle" }],
      changedProperties: ["Router location"],
      changedCount: 1,
      inTrash: false,
    });
  });

  it("never invents a name: no user-info capability → name null; bots/agents are not looked up", async () => {
    const lookup = vi.fn(async () => null);
    const d = await buildNotionEventDetails(
      event({
        authors: [
          { id: "user-x", type: "person" },
          { id: "bot-1", type: "bot" },
          { id: "agent-1", type: "agent" },
        ],
      }),
      deps({ getUserDisplayName: lookup }),
    );
    expect(d.actors).toEqual([
      { type: "person", name: null },
      { type: "bot", name: null },
      { type: "agent", name: null },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("never stores values — only names and counts", async () => {
    const d = await buildNotionEventDetails(
      event({ changedFieldNames: ["XGe%40", "bDf%5B"] }),
      deps(),
    );
    // The complete stored shape: nothing that could hold a value.
    expect(Object.keys(d).sort()).toEqual([
      "action",
      "actors",
      "breadcrumb",
      "changedCount",
      "changedProperties",
      "inTrash",
      "libraryEntryId",
      "title",
      "version",
      "visibility",
    ]);
    expect(d.changedProperties).toEqual(["Router location", "Last checked"]);
  });

  it("content edits carry a block count, no field names", async () => {
    const d = await buildNotionEventDetails(
      event({
        eventType: "page.content_updated",
        changedFieldNames: ["b1", "b2", "b3"],
      }),
      deps(),
    );
    expect(d).toMatchObject({
      action: "updated_content",
      changedProperties: [],
      changedCount: 3,
    });
  });

  it("a page moved to trash under SOPs", async () => {
    const d = await buildNotionEventDetails(
      event({
        entityId: "trashed-sop",
        eventType: "page.deleted",
        changedFieldNames: [],
        parent: { type: "page", id: "sop-root" },
      }),
      deps(),
    );
    expect(d).toMatchObject({
      action: "deleted",
      title: "Old SOP",
      breadcrumb: ["SOPs"],
      inTrash: true,
      libraryEntryId: null,
    });
  });

  it("partial failure: the page can't be read → title null, webhook parent used; visibility errors → sensitive", async () => {
    const d = await buildNotionEventDetails(
      event({
        entityId: "gone-page",
        parent: { type: "page", id: "palm-haven" },
      }),
      deps({
        resolveVisibility: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );
    expect(d.title).toBeNull();
    expect(d.breadcrumb).toEqual([
      "Library",
      "Property Directory",
      "Palm Haven",
    ]);
    expect(d.visibility).toBe("sensitive");
    expect(d.changedProperties).toEqual([]);
  });

  it("a LIBRARY row itself is its own entry", async () => {
    const d = await buildNotionEventDetails(
      event({
        entityId: PROPERTY_DIRECTORY,
        parent: { type: "database", id: NOTION_LIBRARY_DATABASE_ID },
      }),
      deps(),
    );
    expect(d).toMatchObject({
      breadcrumb: ["Library"],
      libraryEntryId: PROPERTY_DIRECTORY,
      title: "Property Directory",
    });
  });
});
