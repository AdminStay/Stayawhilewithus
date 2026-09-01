"use server";

import { revalidatePath } from "next/cache";

import {
  disconnectIntegrationSchema,
  searchNotionSchema,
} from "./schemas/integrations.schema";
import {
  beginDeviceSync,
  disconnectIntegration,
  finishDeviceSync,
  searchNotionContent,
  type NotionSearchState,
} from "./services/integrations.service";

import {
  syncAugustDevices,
  syncCieloDevices,
  type DeviceSyncResult,
} from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function disconnectIntegrationAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = disconnectIntegrationSchema.parse({
    provider: formData.get("provider"),
  });

  await disconnectIntegration(actor, input);
  revalidatePath("/integrations");
}

/**
 * Discriminated result instead of a thrown error — a manual sync failing
 * (bad credentials, network, empty property map, etc.) must render inline
 * next to the button (see SyncNowButton.tsx), not crash the whole page to
 * app/(dashboard)/error.tsx's generic "Access denied" boundary, which is
 * what a plain thrown error from a <form action> would have done.
 */
export type SyncActionState =
  | { status: "idle" }
  | { status: "already_running" }
  | { status: "success"; synced: number; skipped: number }
  | { status: "failure"; error: string };

/**
 * Shared body for the two provider-specific actions below. `connectionId`
 * comes from the specific card the button was rendered on (see
 * SyncNowButton.tsx / IntegrationConnectionList.tsx) — never derived from
 * `provider` alone, so this doesn't bake in a one-connection-per-provider
 * assumption. Starts with beginDeviceSync(), which writes a RUNNING log row
 * and refuses (returns alreadyRunning) if one already exists for THIS
 * connection — that's the duplicate-concurrent-sync guard. The real sync
 * only ever runs after that check passes, and finishDeviceSync() always
 * updates the SAME log row (never creates a second one) to its terminal
 * status.
 *
 * Every exit path after a RUNNING row is created ends in exactly one
 * outcome, never a thrown exception: SUCCEEDED, FAILED, or (if even the
 * FAILED write itself throws — a second, independent failure) a logged
 * warning plus a returned failure state anyway. This is deliberate — a
 * useActionState-bound action that throws still propagates to the
 * page-level error boundary (React doesn't swallow it the way it swallows
 * a normal render error), so nothing in this function is allowed to throw,
 * regardless of which step fails. The one state a thrown finishDeviceSync
 * can leave behind — a RUNNING row nobody ever closed out — self-heals via
 * beginDeviceSync's own stale-row check on the next attempt.
 */
async function runDeviceSync(
  connectionId: string,
  provider: "AUGUST" | "CIELO",
  sync: (
    actor: Awaited<ReturnType<typeof getCurrentUser>>,
  ) => Promise<DeviceSyncResult>,
): Promise<SyncActionState> {
  const actor = await getCurrentUser();

  let begin: Awaited<ReturnType<typeof beginDeviceSync>>;
  try {
    begin = await beginDeviceSync(actor, connectionId, provider);
  } catch (err) {
    // beginDeviceSync's own work is a single Prisma transaction — if it
    // threw, that transaction rolled back, so nothing was left half-written
    // (no orphaned RUNNING row, no stuck lock). Safe to just report failure.
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if ("wrongConnection" in begin) {
    return {
      status: "failure",
      error: "This connection no longer matches the expected provider.",
    };
  }
  if (begin.alreadyRunning) {
    return { status: "already_running" };
  }

  try {
    const result = await sync(actor);
    await finishDeviceSync(actor, begin.logId, {
      status: "SUCCEEDED",
      recordsProcessed: result.synced,
    });
    return {
      status: "success",
      synced: result.synced,
      skipped: result.skippedExternalIds.length,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await finishDeviceSync(actor, begin.logId, {
        status: "FAILED",
        errorMessage,
      });
    } catch (finishErr) {
      // The sync itself failed AND the bookkeeping write to log that
      // failure also failed. Don't let the second failure hide the first,
      // or throw out of this action — the RUNNING row left behind gets
      // cleaned up by the stale-row check on the next sync attempt.
      console.error(
        "finishDeviceSync failed while recording a FAILED sync:",
        finishErr,
      );
    }
    return { status: "failure", error: errorMessage };
  } finally {
    revalidatePath("/integrations");
    revalidatePath("/");
  }
}

export async function syncAugustDevicesAction(
  connectionId: string,
  _prevState: SyncActionState,
): Promise<SyncActionState> {
  return runDeviceSync(connectionId, "AUGUST", syncAugustDevices);
}

export async function syncCieloDevicesAction(
  connectionId: string,
  _prevState: SyncActionState,
): Promise<SyncActionState> {
  return runDeviceSync(connectionId, "CIELO", syncCieloDevices);
}

/**
 * Bound to the "Search Notion" box's <form action> via useActionState (see
 * NotionSearch.tsx) — a submit-triggered live search, not a per-keystroke
 * call. An empty/whitespace-only query (e.g. the box was cleared and
 * re-submitted) resolves to the idle state rather than a thrown validation
 * error, since that's a normal "nothing to search" case, not a real input
 * error.
 */
export async function searchNotionAction(
  _prevState: NotionSearchState | { status: "idle" },
  formData: FormData,
): Promise<NotionSearchState | { status: "idle" }> {
  const actor = await getCurrentUser();

  const parsed = searchNotionSchema.safeParse({
    query: formData.get("query"),
  });
  if (!parsed.success) return { status: "idle" };

  return searchNotionContent(actor, parsed.data.query);
}
