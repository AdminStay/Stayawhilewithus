import { NextResponse } from "next/server";

import { processNotionWebhookEvent } from "@/domains/integrations/services/notion-webhook-event.service";
import { captureNotionWebhookVerificationToken } from "@/domains/integrations/services/notion-webhook-setup.service";
import { parseNotionWebhookVerificationRequest } from "@/domains/integrations/services/notion-webhook-verification.service";

/**
 * ⚠️ NOT REGISTERED WITH NOTION. This endpoint exists and is fully tested
 * (see notion-webhook-event.service.test.ts) but no real Notion webhook
 * subscription has ever been created against it — that requires a public
 * HTTPS URL and completing Notion's one-time verification handshake, a
 * genuine external-system action explicitly held for separate approval.
 * See HANDOFF.md's Notion section for the current status.
 *
 * Handles two distinct request shapes Notion can send here:
 * 1. The one-time verification handshake (`{ verification_token }`,
 *    unsigned) — sent once, immediately after a subscription is created.
 *    Since 2026-09-30 the token is NEVER logged (it is the signing secret):
 *    captureNotionWebhookVerificationToken() seals it for a one-time,
 *    admin-only reveal in the dashboard and logs only a fingerprint. It is
 *    never echoed back in the HTTP response either.
 * 2. A real, signed event notification — verified and processed by
 *    processNotionWebhookEvent(), which fails closed on every unexpected
 *    or unconfigured condition.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  const verificationToken = parseNotionWebhookVerificationRequest(rawBody);
  if (verificationToken) {
    try {
      await captureNotionWebhookVerificationToken(verificationToken);
    } catch (err) {
      // Never include the token; the error class is enough to investigate.
      console.error(
        "[notion-webhook] handshake capture failed:",
        err instanceof Error ? err.name : "unknown",
      );
    }
    return NextResponse.json({ received: true });
  }

  const signature = req.headers.get("x-notion-signature");
  const result = await processNotionWebhookEvent(rawBody, signature);

  switch (result.status) {
    case "processed":
      return NextResponse.json({ received: true });
    case "excluded":
    case "duplicate":
      // Acknowledged, not an error — Notion should not retry these.
      return NextResponse.json({ received: true });
    case "not_configured":
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    case "invalid_signature":
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    case "invalid_payload":
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
