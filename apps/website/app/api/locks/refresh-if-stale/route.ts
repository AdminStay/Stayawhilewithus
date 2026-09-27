import { ForbiddenError } from "@stayw/auth";
import { NextResponse } from "next/server";

import {
  getAugustRefreshFreshness,
  refreshAugustTelemetryIfStale,
} from "@/domains/smart-devices/services/lock-refresh.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export const dynamic = "force-dynamic";
// A fleet refresh can take several minutes in the worst case (~277 s
// recorded), longer than the /locks page's own 60 s limit — which is why
// the refresh runs here, called by the open page, and never in its render.
export const maxDuration = 300;

/**
 * Refresh-on-view (2026-09-27). Called by /locks (LockAutoRefresh) while it
 * is open and visible. Signed-in viewers only (Clerk middleware + the
 * service's smart_devices:read check). The server alone decides whether a
 * read-only fleet refresh starts: at most one per 10 minutes globally, never
 * while one is RUNNING, never during a 429 cooldown. No request body is
 * read, so a caller can't choose locks, force a run or reach any command.
 */
export async function POST() {
  try {
    const actor = await getCurrentUser();
    const outcome = await refreshAugustTelemetryIfStale(actor);
    const freshness = await getAugustRefreshFreshness(actor);
    return NextResponse.json({ status: outcome.status, ...freshness });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[lock-refresh-on-view] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
