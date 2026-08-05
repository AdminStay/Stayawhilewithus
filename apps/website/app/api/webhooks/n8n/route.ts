import { handleN8nCallback } from "@stayw/ai-automation";
import { NextResponse } from "next/server";

import { env } from "../../../../env";

export async function POST(req: Request) {
  const signature = req.headers.get("x-staywhile-signature");
  const rawBody = await req.text();

  const result = await handleN8nCallback(
    rawBody,
    signature,
    env.N8N_INBOUND_WEBHOOK_SHARED_SECRET,
  );

  return NextResponse.json(result.body, { status: result.status });
}
