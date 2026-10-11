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
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
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

  it("never selects the Notion entity id", async () => {
    await listRecentNotionActivity(ACTOR);
    const select = mockFindMany.mock.calls[0]![0].select;
    expect(select).not.toHaveProperty("entityId");
    expect(select).toHaveProperty("details", true);
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

    mockHasPermission.mockResolvedValueOnce(true);
    mockFindMany.mockResolvedValueOnce([sensitive]);
    const [full] = await listRecentNotionActivity(ACTOR);
    expect(full).toMatchObject({
      restricted: false,
      where: "Library › Property Lockboxes Code › Palm Haven codes",
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
      who: "Someone",
      verb: "moved to trash",
      where: "a Notion page",
      change: null,
    });
  });
});
