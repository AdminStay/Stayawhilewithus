import { NextResponse } from "next/server";

import { refreshAugustTelemetryAutomatic } from "@/domains/smart-devices/services/lock-refresh.service";

// Same reasoning as the VA-schedule cron route (schedule-refresh/route.ts):
// this must never be statically optimized/cached.
export const dynamic = "force-dynamic";

/**
 * The automatic-refresh trigger for August lock telemetry (battery,
 * connectivity, lock state) — read-only against August, the write-side
 * counterpart of `/locks`' own manual "Refresh all" button. Scheduled from
 * StayWhile's own dedicated n8n instance (a Schedule Trigger node, same
 * infrastructure the VA-schedule cron already uses — NOT Vercel Cron; the
 * StayWhile Vercel project is on the Hobby plan, which doesn't support a
 * sub-daily interval), calling this route with
 * `Authorization: Bearer $AUGUST_REFRESH_CRON_SECRET`.
 *
 * Deliberately a SEPARATE secret from the VA-schedule cron's `CRON_SECRET`
 * (per explicit instruction) — compromising or rotating one trigger's
 * credential never affects the other's, and this route's own blast radius
 * (August telemetry reads) stays independently scoped from the VA
 * schedule's (a public Google Sheet read).
 *
 * The auth check is trigger-agnostic, same as schedule-refresh/route.ts:
 * it validates the bearer token against a plain env var and doesn't care
 * who/what called it — safe to point any authenticated scheduler at, n8n
 * included. Fails closed with 503 if `AUGUST_REFRESH_CRON_SECRET` isn't
 * configured at all, so this endpoint does nothing in any environment
 * where that var hasn't been deliberately set, including Production until
 * it's explicitly configured there (not done as part of this change — see
 * HANDOFF.md for the exact Production configuration steps still needed).
 *
 * No StayWhile user ever signs in to trigger this — there is no actor, and
 * none is needed (see refreshAugustTelemetryAutomatic()'s own doc comment
 * for why no RBAC check happens here). Calls that exact function and
 * nothing else — every real safety property (bounded concurrency,
 * per-device failure isolation, run-level overlap protection via the
 * shared `integration_sync` advisory lock, IntegrationSyncLog tracking,
 * never a lock/unlock/PIN endpoint) lives there, not in this route.
 */
export async function GET(request: Request) {
  const secret = process.env.AUGUST_REFRESH_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshAugustTelemetryAutomatic();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // refreshAugustTelemetryAutomatic() already turns every expected
    // failure (not configured, a provider error, a stale/overlapping run)
    // into a normal, durably-logged return value — reaching this catch
    // means something genuinely unexpected happened (e.g. the initial
    // IntegrationConnection lookup itself failing), not an ordinary
    // August-fetch failure.
    console.error("[august-lock-refresh-cron] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
