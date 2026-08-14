import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;

/**
 * Slack signs webhooks as v0=HMAC-SHA256(signingSecret, "v0:{timestamp}:{rawBody}")
 * — a different scheme from the generic HMAC-of-payload verifier in
 * ../core/webhook-signature.ts, so it gets its own implementation here (see
 * that file's own comment anticipating this). Rejects stale timestamps to
 * guard against replay, per Slack's documented recommendation.
 */
export function verifySlackSignature(
  rawBody: string,
  headers: { timestamp: string; signature: string },
  signingSecret: string,
): boolean {
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > MAX_TIMESTAMP_AGE_SECONDS) return false;

  const baseString = `v0:${headers.timestamp}:${rawBody}`;
  const expected =
    "v0=" +
    createHmac("sha256", signingSecret).update(baseString).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headers.signature);
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
