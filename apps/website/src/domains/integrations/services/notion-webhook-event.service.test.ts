import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
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
      },
    });
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
