import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Generic HMAC-SHA256 webhook signature verification, reused by every
 * provider that signs webhooks this way (most do). Providers with a
 * different scheme (e.g. Slack's v0=timestamp:body signing) implement
 * their own verifier in that provider's folder instead.
 */
export function verifyHmacSignature(
  payload: string,
  signatureHex: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signatureHex, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
