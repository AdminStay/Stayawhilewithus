"use server";

import { revalidatePath } from "next/cache";

import { forceRefreshSchedule } from "./services/schedule.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

const TEAM_PAGE_PATH = "/team";
const DASHBOARD_PAGE_PATH = "/";

export type RefreshTeamScheduleActionState =
  | { status: "idle" }
  | { status: "success"; refreshedAt: string }
  | { status: "failure"; error: string };

/**
 * The single "Refresh" control for the schedule widget/page. Re-fetches
 * Michelle's Google Sheet (read-only — see schedule-source.ts) and
 * re-derives availability; never writes to the sheet, never mutates
 * Production data beyond this server's own in-memory schedule cache.
 * forceRefreshSchedule() itself enforces team:update — this action
 * introduces no separate/broader permission check.
 */
export async function refreshTeamScheduleAction(
  _prevState: RefreshTeamScheduleActionState,
): Promise<RefreshTeamScheduleActionState> {
  try {
    const actor = await getCurrentUser();
    await forceRefreshSchedule(actor);
    // Both surfaces read fresh on every render (Server Components), so
    // revalidating is sufficient to show the newly refreshed state without
    // a manual reload — same convention as refreshThermostatsAction.
    revalidatePath(TEAM_PAGE_PATH);
    revalidatePath(DASHBOARD_PAGE_PATH);
    return { status: "success", refreshedAt: new Date().toISOString() };
  } catch (err) {
    return {
      status: "failure",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
