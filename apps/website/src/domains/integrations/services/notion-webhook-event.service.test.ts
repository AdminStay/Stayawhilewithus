import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockCreate, mockEnrich, mockCreateNotification } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockEnrich: vi.fn(),
    mockCreateNotification: vi.fn(),
  }));

// Enrichment is a separate, best-effort step after storage (its own tests
// cover it); here only the wiring. N2 sends no notifications — the platform
// notification writer is mocked only to prove it is never called.
vi.mock("./notion-event-enrichment.service", () => ({
  enrichStoredNotionEvent: mockEnrich,
}));
vi.mock("@/platform/notifications/create-notification", () => ({
  createNotification: mockCreateNotification,
  createNotificationsForGlobalRole: mockCreateNotification,
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    notionPageEvent: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));

import { processNotionWebhookEvent } from "./notion-webhook-event.service";

const TOKEN = "test-verification-token";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", TOKEN).update(body).digest("hex");
}

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt-1",
    timestamp: "2026-09-16T12:00:00.000Z",
    workspace_id: "ws-1",
    subscription_id: "sub-1",
    integration_id: "int-1",
    type: "page.properties_updated",
    entity: { id: "page-1", type: "page" },
    data: { updated_properties: ["prop-1"] },
    ...overrides,
  });
}

describe("processNotionWebhookEvent", () => {
  const originalToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;

  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = TOKEN;
    mockEnrich.mockReset().mockResolvedValue(null);
    mockCreateNotification.mockReset();
    mockFindUnique.mockReset().mockResolvedValue(null);
    mockCreate.mockReset().mockResolvedValue({ id: "row-1" });
  });

  afterEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = originalToken;
  });

  it("fails closed with not_configured when no verification token is set", async () => {
    delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
    const body = eventBody();
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result).toEqual({ status: "not_configured" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid signature and never stores anything", async () => {
    const body = eventBody();
    const result = await processNotionWebhookEvent(body, "sha256=wrong");
    expect(result).toEqual({ status: "invalid_signature" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't valid JSON", async () => {
    const body = "not json";
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result.status).toBe("invalid_payload");
  });

  it("rejects a body that doesn't match the event schema", async () => {
    const body = JSON.stringify({ nope: true });
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result.status).toBe("invalid_payload");
  });

  it("processes and stores a valid, correctly signed, non-excluded event", async () => {
    const body = eventBody();
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result).toEqual({ status: "processed", eventId: "row-1" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        notionEventId: "evt-1",
        entityId: "page-1",
        entityType: "page",
        eventType: "page.properties_updated",
        changedFieldNames: ["prop-1"],
        occurredAt: new Date("2026-09-16T12:00:00.000Z"),
        authors: [],
        parentType: null,
        parentId: null,
        attemptNumber: null,
      },
    });
  });

  it("stores who (author ids/types) and where (parent) from the payload — never values (2026-09-30)", async () => {
    const body = eventBody({
      authors: [{ id: "user-9", type: "person" }],
      attempt_number: 2,
      data: {
        updated_properties: ["prop-1"],
        parent: { id: "parent-page", type: "page" },
      },
    });
    await processNotionWebhookEvent(body, sign(body));
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authors: [{ id: "user-9", type: "person" }],
        parentType: "page",
        parentId: "parent-page",
        attemptNumber: 2,
      }),
    });
  });

  it("enriches after storing, and still processes the event when enrichment produced nothing", async () => {
    const body = eventBody();
    mockEnrich.mockResolvedValueOnce({ version: 1 });
    await expect(processNotionWebhookEvent(body, sign(body))).resolves.toEqual({
      status: "processed",
      eventId: "row-1",
    });
    expect(mockEnrich).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ notionEventId: "evt-1" }),
    );
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnrich.mock.invocationCallOrder[0]!,
    );

    mockEnrich.mockResolvedValueOnce(null);
    const body2 = eventBody({ id: "evt-2" });
    await expect(
      processNotionWebhookEvent(body2, sign(body2)),
    ).resolves.toMatchObject({ status: "processed" });
  });

  it("sends no notification for any event (notifications are not part of N2)", async () => {
    for (const [id, type] of [
      ["evt-n1", "page.properties_updated"],
      ["evt-n2", "page.deleted"],
      ["evt-n3", "page.moved"],
    ] as const) {
      mockEnrich.mockResolvedValueOnce({ version: 1, action: "deleted" });
      const body = eventBody({ id, type });
      await processNotionWebhookEvent(body, sign(body));
    }
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("never stores a value alongside changedFieldNames — only the property ids Notion itself sent", async () => {
    const body = eventBody({
      data: { updated_properties: ["prop-1"], leaked_value: "sensitive" },
    });
    await processNotionWebhookEvent(body, sign(body));
    const call = mockCreate.mock.calls[0]?.[0];
    expect(JSON.stringify(call)).not.toContain("sensitive");
  });

  // Staff/contact-directory exclusion against the REAL 2026-03-11 payload
  // shape (2026-10-11 fix): a database row's parent is its data source.
  describe("staff/contact-directory exclusion (real payload shape)", () => {
    const PEOPLE_DB = "d3d6058d-b989-82df-b0d8-014512d331ec"; // People (excluded)
    const PEOPLE_DS = "11111111-aaaa-4bbb-8ccc-000000000001";
    const LIBRARY_DS = "11111111-aaaa-4bbb-8ccc-000000000003";
    const lookup = vi.fn(async (id: string) =>
      id === PEOPLE_DS
        ? PEOPLE_DB
        : id === LIBRARY_DS
          ? "e54961ca-c27c-4bbd-b4b3-a766d9b0dd64"
          : null,
    );

    it("a People row edit (parent = directory data source) is excluded and never stored", async () => {
      const body = eventBody({
        entity: { id: "staff-row", type: "page" },
        data: {
          parent: { id: PEOPLE_DS, type: "data_source" },
          updated_properties: ["phone"],
        },
      });
      const result = await processNotionWebhookEvent(body, sign(body), lookup);
      expect(result).toEqual({ status: "excluded" });
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEnrich).not.toHaveBeenCalled();
    });

    it("a data_source.schema_updated on the People data source is excluded", async () => {
      const body = eventBody({
        type: "data_source.schema_updated",
        entity: { id: PEOPLE_DS, type: "data_source" },
        data: { parent: { id: PEOPLE_DB, type: "database" } },
      });
      const result = await processNotionWebhookEvent(body, sign(body), lookup);
      expect(result).toEqual({ status: "excluded" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("an ordinary LIBRARY row edit is stored as before (stays visible, sensitive rules unchanged)", async () => {
      const body = eventBody({
        entity: { id: "sop-row", type: "page" },
        data: {
          parent: { id: LIBRARY_DS, type: "data_source" },
          updated_properties: ["prop-1"],
        },
      });
      const result = await processNotionWebhookEvent(body, sign(body), lookup);
      expect(result).toEqual({ status: "processed", eventId: "row-1" });
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: "sop-row",
          parentType: "data_source",
          parentId: LIBRARY_DS,
        }),
      });
    });

    it("a lookup failure stores NOTHING and asks Notion to retry (fail closed)", async () => {
      const failing = vi.fn(async () => {
        throw new Error("ECONNRESET");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = eventBody({
        data: { parent: { id: PEOPLE_DS, type: "data_source" } },
      });
      const result = await processNotionWebhookEvent(body, sign(body), failing);
      expect(result).toEqual({ status: "retry_later" });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(PEOPLE_DS);
      warn.mockRestore();
    });

    it("an unknown data source Notion won't describe (lookup → null) is excluded, not stored", async () => {
      const body = eventBody({
        data: { parent: { id: "unknown-ds", type: "data_source" } },
      });
      const result = await processNotionWebhookEvent(body, sign(body), lookup);
      expect(result).toEqual({ status: "excluded" });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("the exclusion check runs only after the signature is verified (no lookup for a bad signature)", async () => {
      const body = eventBody({
        data: { parent: { id: PEOPLE_DS, type: "data_source" } },
      });
      lookup.mockClear();
      const result = await processNotionWebhookEvent(
        body,
        "sha256=wrong",
        lookup,
      );
      expect(result).toEqual({ status: "invalid_signature" });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  it("treats a repeat delivery of the same Notion event id as a duplicate and never double-stores it", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "already-there" });
    const body = eventBody();
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result).toEqual({ status: "duplicate" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats a concurrent-delivery unique-constraint race (P2002 on create, findUnique having missed it) as a duplicate, not an unhandled error", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const body = eventBody();
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result).toEqual({ status: "duplicate" });
  });

  it("re-throws a real, non-unique-constraint database error rather than misreporting it as a duplicate", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(new Error("connection reset"));
    const body = eventBody();
    await expect(processNotionWebhookEvent(body, sign(body))).rejects.toThrow(
      "connection reset",
    );
  });
});
