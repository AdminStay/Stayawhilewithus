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

  it("excludes an event belonging to a known staff/contact-directory database and never stores it", async () => {
    const body = eventBody({
      data: {
        parent: {
          type: "database_id",
          database_id: "d3d6058d-b989-82df-b0d8-014512d331ec",
        },
      },
    });
    const result = await processNotionWebhookEvent(body, sign(body));
    expect(result).toEqual({ status: "excluded" });
    expect(mockCreate).not.toHaveBeenCalled();
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
