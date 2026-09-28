"use client";

import { Button } from "@stayw/ui";
import { Eye } from "lucide-react";
import { useActionState } from "react";

import type { PreviewOwnerRezSyncActionState } from "../actions";

const INITIAL_STATE: PreviewOwnerRezSyncActionState = { status: "idle" };

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/**
 * "Preview OwnerRez Sync" (2026-09-28): read-only. Reads OwnerRez and the
 * StayWhile database and shows what a sync WOULD do — it changes nothing in
 * StayWhile (see previewOwnerRezSyncAction). The real write lives behind
 * SyncOwnerRezReservationsButton's confirmation dialog.
 */
export function PreviewOwnerRezSyncButton({
  action,
}: {
  action: (
    prevState: PreviewOwnerRezSyncActionState,
    formData: FormData,
  ) => Promise<PreviewOwnerRezSyncActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-1">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={isPending}
        >
          <Eye className="h-3.5 w-3.5" />
          {isPending ? "Previewing…" : "Preview OwnerRez Sync"}
        </Button>
        <p className="text-xs text-ink-muted">
          Read-only: reads OwnerRez and shows what a sync would do. Makes no
          changes in StayWhile.
        </p>
      </form>

      {!isPending && state.status === "not_configured" && (
        <p className="text-xs text-error-500">
          OwnerRez isn&apos;t configured on the server.
        </p>
      )}
      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Preview failed: {state.error}</p>
      )}

      {!isPending && state.status === "preview" && (
        <section
          aria-label="OwnerRez sync preview"
          className="rounded-md border border-border bg-surface-muted p-3"
        >
          <p className="mb-2 text-xs font-semibold text-ink">
            Preview only — nothing was written to StayWhile.
          </p>
          <dl className="space-y-1">
            <Row
              label="OwnerRez records evaluated"
              value={state.summary.bookingsEvaluated}
            />
            <Row
              label="Guest bookings eligible for import"
              value={state.summary.eligibleGuestBookings}
            />
            <Row label="Would create" value={state.summary.toCreate} />
            <Row
              label="Would update (already in StayWhile)"
              value={state.summary.toUpdate}
            />
            <Row
              label="Of those: active / cancelled / other"
              value={`${state.summary.writable.active} / ${state.summary.writable.cancelled} / ${state.summary.writable.other}`}
            />
            <Row
              label="Of those: in-house or upcoming"
              value={state.summary.currentOrUpcoming}
            />
            <Row
              label="Skipped: property not linked in StayWhile"
              value={state.summary.unmatchedPropertyBookings}
            />
            <Row
              label="Skipped: unrecognized status"
              value={state.summary.unrecognizedStatusBookings}
            />
            <Row
              label="Skipped: not guest reservations"
              value={state.summary.nonGuestTotal}
            />
          </dl>

          <div className="mt-3">
            <p className="text-xs font-semibold text-ink">
              Not guest reservations — never imported
            </p>
            <dl className="mt-1 space-y-1">
              <Row
                label="Blocked-off time"
                value={state.summary.nonGuest.block}
              />
              <Row
                label="Quote holds"
                value={state.summary.nonGuest.quote_hold}
              />
              <Row
                label="Linked availability"
                value={state.summary.nonGuest.linked_availability}
              />
              <Row label="Owner stays" value={state.summary.nonGuest.owner} />
              <Row
                label="Unknown or missing type"
                value={state.summary.nonGuest.unknown}
              />
            </dl>
          </div>

          {state.summary.unmatchedProperties.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink">
                OwnerRez properties not linked to a StayWhile property
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {state.summary.unmatchedProperties.map((p) => (
                  <li key={p.ownerRezPropertyId}>
                    OwnerRez property #{p.ownerRezPropertyId}: {p.bookings}{" "}
                    booking{p.bookings === 1 ? "" : "s"}
                    {p.nextArrival ? ` (next arrival ${p.nextArrival})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.summary.unrecognizedStatuses.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink">
                Unrecognized OwnerRez statuses
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {state.summary.unrecognizedStatuses.map((s) => (
                  <li key={s.status}>
                    &ldquo;{s.status}&rdquo;: {s.bookings}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-muted">
            OwnerRez allows 300 requests per 5 minutes. Wait at least 5 minutes
            after a preview before running a sync.
          </p>
        </section>
      )}
    </div>
  );
}
