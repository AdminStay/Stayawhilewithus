import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifySlackSignature } from "./verify-signature";

const SIGNING_SECRET = "test-signing-secret";

function sign(rawBody: string, timestamp: string): string {
  return (
    "v0=" +
    createHmac("sha256", SIGNING_SECRET)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")
  );
}

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, fresh payload", () => {
    const rawBody = JSON.stringify({ type: "event_callback" });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const result = verifySlackSignature(
      rawBody,
      { timestamp, signature: sign(rawBody, timestamp) },
      SIGNING_SECRET,
    );

    expect(result).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = JSON.stringify({ type: "event_callback" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSignature =
      "v0=" +
      createHmac("sha256", "wrong-secret")
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex");

    const result = verifySlackSignature(
      rawBody,
      { timestamp, signature: wrongSignature },
      SIGNING_SECRET,
    );

    expect(result).toBe(false);
  });

  it("rejects a stale timestamp even with a valid signature", () => {
    const rawBody = JSON.stringify({ type: "event_callback" });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60);

    const result = verifySlackSignature(
      rawBody,
      { timestamp: staleTimestamp, signature: sign(rawBody, staleTimestamp) },
      SIGNING_SECRET,
    );

    expect(result).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const rawBody = "{}";

    const result = verifySlackSignature(
      rawBody,
      { timestamp: "not-a-number", signature: "v0=deadbeef" },
      SIGNING_SECRET,
    );

    expect(result).toBe(false);
  });
});
