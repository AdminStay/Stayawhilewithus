import { describe, expect, it } from "vitest";

import { parseNotionWebhookVerificationRequest } from "./notion-webhook-verification.service";

describe("parseNotionWebhookVerificationRequest", () => {
  it("extracts the token from a verification handshake body", () => {
    const body = JSON.stringify({ verification_token: "secret_abc123" });
    expect(parseNotionWebhookVerificationRequest(body)).toBe("secret_abc123");
  });

  it("returns null for a real event payload (no verification_token field)", () => {
    const body = JSON.stringify({
      id: "evt-1",
      type: "page.created",
      entity: { id: "page-1", type: "page" },
    });
    expect(parseNotionWebhookVerificationRequest(body)).toBeNull();
  });

  it("returns null for invalid JSON, never throws", () => {
    expect(() =>
      parseNotionWebhookVerificationRequest("not json"),
    ).not.toThrow();
    expect(parseNotionWebhookVerificationRequest("not json")).toBeNull();
  });

  it("returns null for an empty verification_token", () => {
    const body = JSON.stringify({ verification_token: "" });
    expect(parseNotionWebhookVerificationRequest(body)).toBeNull();
  });
});
