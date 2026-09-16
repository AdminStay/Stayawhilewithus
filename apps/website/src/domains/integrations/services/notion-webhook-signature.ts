import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Notion's `X-Notion-Signature` header: `"sha256=" + HMAC-SHA256`
 * of the raw request body, keyed with the subscription's own
 * verification_token (the same secret returned during the one-time
 * handshake — see notion-webhook-verification.service.ts). Confirmed live
 * against developers.notion.com/reference/webhooks (2026-09-16).
 *
 * Takes the raw body as a string, not a parsed object — HMAC must be
 * computed over the exact bytes Notion signed, before any JSON.parse.
 * Constant-time compare against timing attacks.
 */
export function verifyNotionWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  verificationToken: string,
): boolean {
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    createHmac("sha256", verificationToken).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);

  // timingSafeEqual throws on length mismatch rather than returning false —
  // checked explicitly first so a wrong-length header never short-circuits
  // to a thrown error instead of a clean `false`.
  if (expectedBuf.length !== receivedBuf.length) return false;

  return timingSafeEqual(expectedBuf, receivedBuf);
}
