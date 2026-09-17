import { NextResponse } from "next/server";

import { runScheduleSync } from "@/domains/team/services/schedule.service";

// Every real invocation must execute fresh — Next.js must never statically
// optimize/cache this route's response (reading `request.headers` already
// forces dynamic rendering in practice, but this makes it explicit and
// future-proof rather than relying on that inference).
export const dynamic = "force-dynamic";

/**
 * The automatic-refresh trigger for the VA/team schedule. Scheduled from
 * StayWhile's own dedicated n8n instance (adminstay.app.n8n.cloud — a
 * Schedule Trigger node firing every 15 minutes, calling this route with
 * `Authorization: Bearer $CRON_SECRET`), NOT Vercel Cron — the StayWhile
 * Vercel project is on the Hobby plan, which doesn't support a sub-daily
 * cron interval (confirmed 2026-09-17), so Vercel's own Cron Jobs
 * infrastructure was ruled out for this and this route was never wired
 * into a `vercel.json` crons entry.
 *
 * The auth check itself is trigger-agnostic by design: it validates
 * `Authorization: Bearer $CRON_SECRET` against a plain env var and does
 * not care who the caller is or how the request arrived — the exact same
 * header check Vercel Cron would have sent, which is what makes it safe
 * to point any authenticated scheduler at, n8n included, with zero code
 * change. No StayWhile user ever signs in to trigger this (there is no
 * actor, and none is needed — see schedule-persistence.ts's own doc
 * comment on why these functions are deliberately actor-agnostic); this
 * header check IS the entire authorization boundary, not a UX-only gate
 * backed by a real assertPermission() elsewhere. Fails closed with 503 if
 * `CRON_SECRET` isn't configured at all (mirrors the Notion webhook
 * route's own `not_configured` convention one file over) — this endpoint
 * will do NOTHING in any environment where that env var hasn't been
 * explicitly set, including Production until it's deliberately configured
 * there.
 *
 * Calls the exact same `runScheduleSync()` manual Refresh already uses —
 * no fetch/parse/persistence logic is duplicated here, and this route
 * contains no other schedule-domain import. Read-only against the Google
 * Sheet (see schedule-source.ts); the only thing this endpoint ever writes
 * is this app's own durable sync state via that shared function. This is
 * a Next.js Route Handler — it only ever runs server-side; nothing here
 * ships to any browser bundle regardless of caller.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runScheduleSync();
    return NextResponse.json({ ok: true });
  } catch (err) {
    // runScheduleSync() itself already turns every fetch/parse failure into
    // a durably-logged FAILED sync attempt and returns normally — reaching
    // this catch means something genuinely unexpected happened (e.g. a
    // database connectivity error), not an ordinary Sheet-fetch failure.
    console.error("[schedule-refresh-cron] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
