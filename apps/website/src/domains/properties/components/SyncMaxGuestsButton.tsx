"use client";

import { ConfirmButton } from "@stayw/ui";
import { RefreshCw } from "lucide-react";
import { useActionState } from "react";

import type { SyncMaxGuestsActionState } from "../actions";
import type { MaxGuestsSyncFailureReason } from "../services/ownerrez-max-guests-sync.service";

const INITIAL_STATE: SyncMaxGuestsActionState = { status: "idle" };

const FAILURE_REASON_LABEL: Record<MaxGuestsSyncFailureReason, string> = {
  invalid_link_id: "invalid OwnerRez link",
  rate_limited: "OwnerRez request limit reached",
  request_failed: "couldn't read OwnerRez",
  update_failed: "couldn't save",
};

/**
 * "Sync max guests from OwnerRez" (2026-10-21) — copies OwnerRez's
 * max_guests into StayWhile's maximum guests for every linked property
 * (see syncMaxGuestsFromOwnerRez()). Confirmation first; `isPending`
 * disables the button so a double click can't start a second run. The
 * result names every property that changed (old → new), was skipped for a
 * blank OwnerRez value, or failed, so nothing changes silently.
 */
export function SyncMaxGuestsButton({
  action,
}: {
  action: (
    prevState: SyncMaxGuestsActionState,
  ) => Promise<SyncMaxGuestsActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <ConfirmButton
        type="submit"
        variant="secondary"
        size="sm"
        disabled={isPending}
        confirmMessage="Copy OwnerRez's maximum guests into StayWhile for every property linked to OwnerRez? Only maximum guests changes; a blank OwnerRez value is skipped."
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`}
        />
        {isPending ? "Syncing…" : "Sync max guests from OwnerRez"}
      </ConfirmButton>

      {!isPending && state.status === "not_configured" && (
        <p className="text-xs text-error-500">
          OwnerRez isn&apos;t configured. Nothing was changed.
        </p>
      )}
      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Sync failed: {state.error}</p>
      )}
      {!isPending && state.status === "success" && (
        <SyncSummary state={state} />
      )}
    </form>
  );
}

function SyncSummary({
  state,
}: {
  state: Extract<SyncMaxGuestsActionState, { status: "success" }>;
}) {
  const updated = state.results.filter((r) => r.outcome === "updated");
  const unchanged = state.results.filter((r) => r.outcome === "unchanged");
  const skipped = state.results.filter((r) => r.outcome === "skipped_blank");
  const failed = state.results.filter((r) => r.outcome === "failed");

  return (
    <div role="status" className="max-w-md text-right text-xs">
      <p
        className={failed.length > 0 ? "text-warning-600" : "text-success-600"}
      >
        Max guests: {updated.length} updated, {unchanged.length} unchanged,{" "}
        {skipped.length} skipped (blank in OwnerRez), {failed.length} failed.
      </p>
      {state.rateLimited && (
        <p className="text-warning-600">
          OwnerRez&apos;s request limit was reached; the remaining properties
          weren&apos;t checked. Try again later.
        </p>
      )}
      {updated.map((r) => (
        <p key={r.propertyId} className="text-ink-muted">
          {r.propertyName}: {r.before} → {r.after}
        </p>
      ))}
      {skipped.map((r) => (
        <p key={r.propertyId} className="text-ink-muted">
          {r.propertyName}: kept {r.before} (OwnerRez has no value)
        </p>
      ))}
      {failed.map((r) => (
        <p key={r.propertyId} className="text-error-500">
          {r.propertyName}: not changed —{" "}
          {r.reason ? FAILURE_REASON_LABEL[r.reason] : "failed"}
        </p>
      ))}
    </div>
  );
}
