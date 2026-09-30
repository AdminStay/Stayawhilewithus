import { NextResponse } from "next/server";

import { syncOwnerRezReservationsAutomatic } from "@/domains/reservations/services/ownerrez-reservation-sync.service";
import { checkOwnerRezSyncHealthAndAlert } from "@/domains/reservations/services/ownerrez-sync-status.service";

export const dynamic = "force-dynamic";
// One run = ~77 OwnerRez booking reads + guest lookups + ~845 row checks.
// Same ceiling as /api/locks/refresh-if-stale (Pro, Fluid compute).
export const maxDuration = 300;

/**
 * Automatic OwnerRez reservation sync (2026-09-30). Triggered hourly by
 * Vercel Cron (apps/website/vercel.json; Production deployments only).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` — the only header
 * Vercel Cron can send, so this route uses CRON_SECRET (the user approved
 * sharing it with the n8n VA-schedule job, 2026-09-30).
 *
 * Fails closed: 503 when CRON_SECRET is unset, 401 on any other header.
 * With OWNERREZ_AUTO_SYNC_ENABLED not exactly "true" it returns
 * `{ status: "disabled" }` before any database or OwnerRez call. There is no
 * signed-in user; the bearer check is the entire authorization boundary
 * (same as the August and schedule cron routes). Always answers 200 for a
 * handled outcome (cooldown / already running / failed are recorded in the
 * sync log); Vercel never retries a cron, the next hour is the retry.
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
    const outcome = await syncOwnerRezReservationsAutomatic();
    if (outcome.status === "disabled") {
      return NextResponse.json({ ok: true, status: "disabled" });
    }
    const alert = await checkOwnerRezSyncHealthAndAlert();

    // Counts only — never booking or guest details in the response.
    const summary =
      outcome.status === "completed"
        ? {
            created: outcome.created,
            updated: outcome.updated,
            unchanged: outcome.unchanged,
            unmatchedProperty: outcome.unmatchedProperty.length,
            unrecognizedStatus: outcome.unrecognizedStatus.length,
            guestErrors: outcome.guestErrors.length,
            deferred: outcome.guestDeferred.length,
          }
        : undefined;
    return NextResponse.json({
      ok: true,
      status: outcome.status,
      ...(summary ? { summary } : {}),
      ...(alert ? { alert } : {}),
    });
  } catch (err) {
    console.error("[ownerrez-reservation-sync-cron] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
