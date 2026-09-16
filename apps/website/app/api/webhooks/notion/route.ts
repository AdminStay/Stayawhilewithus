import { NextResponse } from "next/server";

import { processNotionWebhookEvent } from "@/domains/integrations/services/notion-webhook-event.service";
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
 *    The token must be read from server logs and pasted into Notion's
 *    subscription UI within 5 minutes; it is deliberately never echoed
 *    back in the HTTP response (Notion's server is the caller here, not a
 *    human — a human can only ever see it via server logs).
 * 2. A real, signed event notification — verified and processed by
 *    processNotionWebhookEvent(), which fails closed on every unexpected
 *    or unconfigured condition.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  const verificationToken = parseNotionWebhookVerificationRequest(rawBody);
  if (verificationToken) {
    console.warn(
      "[notion-webhook] Received verification handshake token — paste into Notion's subscription UI within 5 minutes:",
      verificationToken,
    );
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
