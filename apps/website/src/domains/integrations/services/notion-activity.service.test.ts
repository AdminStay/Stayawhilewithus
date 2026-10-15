import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertPermission, mockHasPermission, mockFindMany } = vi.hoisted(
  () => ({
    mockAssertPermission: vi.fn(),
    mockHasPermission: vi.fn(),
    mockFindMany: vi.fn(),
  }),
);

vi.mock("@stayw/auth", () => ({
  assertPermission: mockAssertPermission,
  hasPermission: mockHasPermission,
}));
vi.mock("@stayw/database", () => ({
  prisma: { notionPageEvent: { findMany: mockFindMany } },
}));

import { listRecentNotionActivity } from "./notion-activity.service";

const ACTOR = { userId: "user-1" };
const details = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  action: "updated_properties",
  title: "Router and Thermostat Location",
  breadcrumb: ["Library", "Property Directory", "Palm Haven"],
  visibility: "standard",
  libraryEntryId: "b3bb913f-4b06-44bf-b87c-a692c00f4790",
  actors: [{ type: "person", name: "Michelle" }],
  changedProperties: ["Router location"],
  changedCount: 1,
  inTrash: false,
  ...overrides,
});
const PAGE_ID = "3e26058d-b989-803d-a1d7-f06f8adc27a6";
const PAGE_URL = "https://notion.so/3e26058db989803da1d7f06f8adc27a6";
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
  entityId: PAGE_ID,
  entityType: "page",
  eventType: "page.properties_updated",
  changedFieldNames: ["abc"],
  occurredAt: new Date("2026-09-30T12:00:00.000Z"),
  details: details(),
  ...overrides,
});

describe("listRecentNotionActivity (2026-09-30)", () => {
  beforeEach(() => {
    mockAssertPermission.mockReset().mockResolvedValue(undefined);
    mockHasPermission.mockReset().mockResolvedValue(false);
    mockFindMany.mockReset().mockResolvedValue([]);
  });

  it("enforces notion:read before querying anything", async () => {
    await listRecentNotionActivity(ACTOR);
    expect(mockAssertPermission).toHaveBeenCalledWith(ACTOR, "notion:read");
  });

  it("propagates a permission denial and never queries", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("ForbiddenError"));
    await expect(listRecentNotionActivity(ACTOR)).rejects.toThrow(
      "ForbiddenError",
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("selects the entity id only to build the link — never returns it as a field", async () => {
    mockFindMany.mockResolvedValueOnce([row()]);
    const [item] = await listRecentNotionActivity(ACTOR);
    const select = mockFindMany.mock.calls[0]![0].select;
    expect(select).toHaveProperty("entityId", true);
    expect(select).toHaveProperty("details", true);
    expect(item).not.toHaveProperty("entityId");
    expect(item!.notionUrl).toBe(PAGE_URL);
  });

  it("selects the stored received_at (2026-10-11) and still orders by occurredAt, newest first", async () => {
    await listRecentNotionActivity(ACTOR);
    const args = mockFindMany.mock.calls[0]![0];
    expect(args.select).toHaveProperty("receivedAt", true);
    expect(args.orderBy).toEqual({ occurredAt: "desc" });
  });

  it("passes received_at through to the view unchanged, for enriched and unenriched rows", async () => {
    const receivedAt = new Date("2026-09-30T12:00:04.000Z");
    mockFindMany.mockResolvedValueOnce([
      row({ id: "enriched", receivedAt }),
      row({ id: "plain", details: null, receivedAt }),
    ]);
    const [enriched, plain] = await listRecentNotionActivity(ACTOR);
    expect(enriched!.receivedAt).toEqual(receivedAt);
    expect(plain!.receivedAt).toEqual(receivedAt);
  });

  it("a row without received_at yields null (no fabricated time)", async () => {
    mockFindMany.mockResolvedValueOnce([row()]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item!.receivedAt).toBeNull();
  });

  it("builds who / did what / where / what changed", async () => {
    mockFindMany.mockResolvedValueOnce([row()]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item).toMatchObject({
      who: "Michelle",
      verb: "updated",
      actionLabel: "Updated",
      where:
        "Library › Property Directory › Palm Haven › Router and Thermostat Location",
      change: "Changed: Router location",
      restricted: false,
    });
    expect(JSON.stringify(item)).not.toContain("b3bb913f");
  });

  it("redacts sensitive events for viewers without notion:manage; shows them to admins", async () => {
    const sensitive = row({
      details: details({
        visibility: "sensitive",
        title: "Palm Haven codes",
        breadcrumb: ["Library", "Property Lockboxes Code"],
      }),
    });
    mockFindMany.mockResolvedValueOnce([sensitive]);
    const [redacted] = await listRecentNotionActivity(ACTOR);
    expect(redacted).toMatchObject({
      where: "a restricted Notion page",
      change: null,
      restricted: true,
    });
    expect(JSON.stringify(redacted)).not.toMatch(/Palm Haven codes|Lockboxes/);
    // No link and no id anywhere for a viewer who can't see the page.
    expect(redacted!.notionUrl).toBeNull();
    expect(redacted!.earlierValueUnknown).toBe(false);
    expect(JSON.stringify(redacted)).not.toMatch(/3e26058d|3e26058db989/);

    mockHasPermission.mockResolvedValueOnce(true);
    mockFindMany.mockResolvedValueOnce([sensitive]);
    const [full] = await listRecentNotionActivity(ACTOR);
    expect(full).toMatchObject({
      restricted: false,
      where: "Library › Property Lockboxes Code › Palm Haven codes",
      notionUrl: PAGE_URL,
    });
  });

  it("an un-enriched row is shown generically, never with an invented actor or place", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({
        details: null,
        changedFieldNames: null,
        eventType: "page.deleted",
      }),
    ]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item).toMatchObject({
      who: "Unknown editor",
      verb: "moved to trash",
      where: "a Notion page",
      change: null,
      notionUrl: null,
      earlierValueUnknown: false,
    });
  });

  it("an un-enriched edit never links (visibility unknown) but still says the earlier value is unknown", async () => {
    mockFindMany.mockResolvedValueOnce([row({ details: null })]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item).toMatchObject({
      who: "Unknown editor",
      notionUrl: null,
      earlierValueUnknown: true,
    });
  });

  it("standard property and content edits link to Notion and flag the earlier value as unknown", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({ id: "props" }),
      row({
        id: "content",
        eventType: "page.content_updated",
        details: details({ action: "updated_content", changedProperties: [] }),
      }),
    ]);
    const items = await listRecentNotionActivity(ACTOR);
    for (const item of items) {
      expect(item).toMatchObject({
        notionUrl: PAGE_URL,
        earlierValueUnknown: true,
      });
    }
  });

  it("non-edit actions link but don't claim a missing earlier value", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({
        eventType: "page.created",
        details: details({ action: "created", changedProperties: [] }),
      }),
      row({
        eventType: "page.moved",
        details: details({ action: "moved", changedProperties: [] }),
      }),
    ]);
    const items = await listRecentNotionActivity(ACTOR);
    for (const item of items) {
      expect(item.notionUrl).toBe(PAGE_URL);
      expect(item.earlierValueUnknown).toBe(false);
    }
  });

  it("never links trashed pages, data sources, blocks, comments or malformed ids", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({
        eventType: "page.deleted",
        details: details({ action: "deleted", inTrash: true }),
      }),
      row({ details: details({ inTrash: true }) }),
      row({
        entityType: "data_source",
        eventType: "data_source.content_updated",
      }),
      row({ entityType: "block" }),
      row({ entityType: "comment", eventType: "comment.created" }),
      row({ entityId: "not-a-notion-id" }),
      row({ entityId: null }),
    ]);
    const items = await listRecentNotionActivity(ACTOR);
    expect(items).toHaveLength(7);
    for (const item of items) expect(item.notionUrl).toBeNull();
  });

  it("links a database entity", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({
        entityType: "database",
        eventType: "database.schema_updated",
        details: details({ action: "schema_updated", changedProperties: [] }),
      }),
    ]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item!.notionUrl).toBe(PAGE_URL);
  });

  it("names every author Notion reported, including integrations and the overflow count (2026-10-16)", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({
        details: details({
          actors: [
            { type: "person", name: "Kenny" },
            { type: "bot", name: "Zapier" },
            { type: "agent", name: null },
          ],
          additionalActors: 2,
        }),
      }),
    ]);
    const [item] = await listRecentNotionActivity(ACTOR);
    expect(item!.who).toBe(
      "Kenny, Zapier (integration), a Notion agent and 2 others",
    );
  });

  it("shows Unknown editor when Notion supplied no editor name, never an invented one", async () => {
    mockFindMany.mockResolvedValueOnce([
      row({ details: details({ actors: [] }) }),
      row({ details: details({ actors: [{ type: "person", name: null }] }) }),
    ]);
    const items = await listRecentNotionActivity(ACTOR);
    expect(items.map((i) => i.who)).toEqual([
      "Unknown editor",
      "Unknown editor",
    ]);
  });
});
