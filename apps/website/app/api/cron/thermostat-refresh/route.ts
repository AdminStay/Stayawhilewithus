import { NextResponse } from "next/server";

import { checkThermostatRefreshHealthAndAlert } from "@/domains/smart-devices/services/thermostat-refresh-alerts.service";
import { refreshThermostatsAutomatic } from "@/domains/smart-devices/services/thermostat-refresh.service";

export const dynamic = "force-dynamic";
// One run = one Nest token refresh + devices.list and, at most hourly, one
// Cielo login + device list — seconds, not minutes.
export const maxDuration = 60;

/**
 * Automatic, read-only thermostat refresh (2026-10-27). Triggered every 30
 * minutes by Vercel Cron (apps/website/vercel.json; Production deployments
 * only) with `Authorization: Bearer $CRON_SECRET` — the only header Vercel
 * Cron can send, the same secret the OwnerRez cron uses.
 *
 * Fails closed: 503 when CRON_SECRET is unset, 401 on any other header.
 * With THERMOSTAT_AUTO_REFRESH_ENABLED not exactly "true" it returns
 * `{ status: "disabled" }` before any database or provider call. There is
 * no signed-in user; the bearer check is the entire authorization boundary
 * (same as the August, OwnerRez and schedule cron routes). Calls
 * refreshThermostatsAutomatic() — never a discovery, mapping or thermostat
 * command. The response carries statuses, counts and fixed failure codes
 * only — never a device id, provider message or credential. Vercel never
 * retries a cron; the next run is the retry.
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
    const outcome = await refreshThermostatsAutomatic();
    if (outcome.status !== "completed") {
      return NextResponse.json({ ok: true, status: outcome.status });
    }
    const alerts = await checkThermostatRefreshHealthAndAlert();
    return NextResponse.json({
      ok: true,
      status: outcome.status,
      nest: outcome.nest,
      cielo: outcome.cielo,
      ...(alerts.length > 0 ? { alerts } : {}),
    });
  } catch (err) {
    console.error(
      "[thermostat-refresh-cron] unexpected error:",
      err instanceof Error ? err.name : "unknown",
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
