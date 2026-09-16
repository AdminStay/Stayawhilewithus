import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyNotionWebhookSignature } from "./notion-webhook-signature";

const TOKEN = "secret_verification_token";
const BODY = JSON.stringify({ id: "evt-1", type: "page.created" });

function sign(body: string, token: string): string {
  return "sha256=" + createHmac("sha256", token).update(body).digest("hex");
}

describe("verifyNotionWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyNotionWebhookSignature(BODY, sign(BODY, TOKEN), TOKEN)).toBe(
      true,
    );
  });

  it("rejects a signature computed with the wrong token", () => {
    expect(
      verifyNotionWebhookSignature(BODY, sign(BODY, "wrong-token"), TOKEN),
    ).toBe(false);
  });

  it("rejects a signature for a different body (tampered payload)", () => {
    const signature = sign(BODY, TOKEN);
    const tamperedBody = JSON.stringify({ id: "evt-1", type: "page.deleted" });
    expect(verifyNotionWebhookSignature(tamperedBody, signature, TOKEN)).toBe(
      false,
    );
  });

  it("rejects a missing signature header", () => {
    expect(verifyNotionWebhookSignature(BODY, null, TOKEN)).toBe(false);
  });

  it("rejects a malformed/short signature header without throwing", () => {
    expect(() =>
      verifyNotionWebhookSignature(BODY, "not-a-real-signature", TOKEN),
    ).not.toThrow();
    expect(
      verifyNotionWebhookSignature(BODY, "not-a-real-signature", TOKEN),
    ).toBe(false);
  });

  it("rejects a signature missing the sha256= prefix, even with the right hash", () => {
    const withoutPrefix = sign(BODY, TOKEN).replace("sha256=", "");
    expect(verifyNotionWebhookSignature(BODY, withoutPrefix, TOKEN)).toBe(
      false,
    );
  });
});
