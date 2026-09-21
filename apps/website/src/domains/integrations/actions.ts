"use server";

import type { NotionPageContent } from "@stayw/integrations/notion";
import { revalidatePath } from "next/cache";

import {
  disconnectIntegrationSchema,
  searchNotionSchema,
} from "./schemas/integrations.schema";
import {
  beginDeviceSync,
  disconnectIntegration,
  finishDeviceSync,
  getNotionPageContent,
  searchNotionContent,
  type NotionSearchState,
} from "./services/integrations.service";
import {
  updateNotionField,
  type NotionEditResult,
} from "./services/notion-edit.service";

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
  | {
      status: "success";
      synced: number;
      skipped: number;
      alreadyMapped: number;
    }
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
      alreadyMapped: result.alreadyMappedExternalIds?.length ?? 0,
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

/**
 * Discriminated result for the "read a search result's real content inline"
 * fetch (see NotionPageContentViewer.tsx) — bound directly (not via
 * useActionState) since this is a one-shot fetch triggered by opening a
 * result, not a form submission. Same "never throw, always return a typed
 * outcome" convention as every other action here.
 *
 * `error` is NEVER a raw provider/network error message — see
 * fetchNotionPageContentAction()'s own doc comment for why this action is
 * itself an independent sanitization boundary, not just a pass-through of
 * getNotionPageContent()'s already-sanitized result.
 */
export type NotionPageContentActionState =
  | { status: "idle" }
  | { status: "success"; content: NotionPageContent }
  | { status: "not_configured" }
  | { status: "error"; error: string };

/** The only text an unexpected (non-getNotionPageContent) failure in this action is ever allowed to surface — see this action's own doc comment. */
const FETCH_NOTION_PAGE_CONTENT_GENERIC_ERROR =
  "Something went wrong loading this page's content. Please try again.";

/**
 * `getNotionPageContent()` already sanitizes any real Notion/provider/network
 * failure to a fixed generic message before returning it (see that
 * function's own doc comment) — `result.error` below is safe to pass through
 * unchanged. This function's own catch block is a SEPARATE sanitization
 * boundary for everything else that could throw here (`getCurrentUser()`,
 * an RBAC denial from `assertPermission` inside the service call): those
 * error messages are internal app detail, not raw provider text, but this
 * action still never lets one reach the browser verbatim — logged
 * server-side only, with a fixed generic message returned instead. The net
 * effect: no path through this action, today or after a future edit to
 * either this file or the service it calls, can hand a raw internal or
 * provider error string to the client.
 */
export async function fetchNotionPageContentAction(
  pageId: string,
): Promise<NotionPageContentActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await getNotionPageContent(actor, pageId);
    if (!result.configured) return { status: "not_configured" };
    if (!result.ok) return { status: "error", error: result.error };
    return { status: "success", content: result.content };
  } catch (err) {
    console.error("fetchNotionPageContentAction failed:", err);
    return {
      status: "error",
      error: FETCH_NOTION_PAGE_CONTENT_GENERIC_ERROR,
    };
  }
}

export type UpdateNotionFieldActionState =
  { status: "idle" } | NotionEditResult | { status: "failure"; error: string };

export interface UpdateNotionFieldActionInput {
  pageId: string;
  dataSourceId: string;
  field: string;
  expectedLastEditedTime: string;
  value: unknown;
}

/**
 * The single entry point for the (currently unreachable, allowlist-empty)
 * dashboard-edit foundation — see notion-edit.service.ts's own doc comment
 * for why every real call today resolves to "not_editable" before any
 * Notion API call happens. Same "never throw to the caller for an expected
 * per-request outcome" convention as every other action in this app; only
 * a genuinely unexpected top-level error (RBAC denial, malformed request)
 * is caught and reported the same way.
 *
 * Takes a plain typed object, not FormData — useActionState's dispatcher
 * accepts any payload shape, and a native `<form>` submission was never
 * required here (nothing wires this to one). A real HTML form would
 * stringify every value, which breaks number/checkbox/multi_select fields
 * (fieldValueSchemaFor's z.number()/z.boolean()/z.array() reject a string
 * outright, by design — no silent coercion of a value about to be written
 * to a shared operational record). NotionFieldEditor.tsx calls this
 * directly with the field's real JS-typed value instead.
 */
export async function updateNotionFieldAction(
  _prevState: UpdateNotionFieldActionState,
  input: UpdateNotionFieldActionInput,
): Promise<UpdateNotionFieldActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await updateNotionField(actor, input);
    if (result.status === "success") {
      revalidatePath("/notion");
    }
    return result;
  } catch (err) {
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
