import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "../../../../env";

import { syncClerkUserFromWebhookEvent } from "@/platform/identity/sync-clerk-user";
import { verifyClerkWebhook } from "@/platform/identity/verify-clerk-webhook";

export async function POST(req: Request) {
  const headerPayload = await headers();
  const rawBody = await req.text();

  let event;
  try {
    event = verifyClerkWebhook(
      rawBody,
      {
        svixId: headerPayload.get("svix-id"),
        svixTimestamp: headerPayload.get("svix-timestamp"),
        svixSignature: headerPayload.get("svix-signature"),
      },
      env.CLERK_WEBHOOK_SIGNING_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  await syncClerkUserFromWebhookEvent(event);

  return NextResponse.json({ received: true });
}
