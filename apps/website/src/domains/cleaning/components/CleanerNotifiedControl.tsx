"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import {
  INITIAL_CLEANING_FORM_STATE,
  type CleaningAction,
} from "./cleaner-options";

import { FormMessage } from "@/domains/cleaners/components/FormMessage";

/** The latest recorded notification, already formatted on the server. */
export interface CleanerNotificationView {
  cleanerId: string;
  cleanerName: string;
  notifiedAtLabel: string;
  notifiedByName: string | null;
}

/**
 * "Mark cleaner notified" (Cleaner Phase 5.2). Shown only for an admin, on
 * an open job with a cleaner. Shows whether THIS cleaner has been notified
 * (a notice sent before a reassignment doesn't count) and records a new
 * notification. Recording sends nothing — the admin has already told the
 * cleaner themselves.
 */
export function CleanerNotifiedControl({
  scheduleId,
  cleanerId,
  latest,
  action,
}: {
  scheduleId: string;
  cleanerId: string;
  latest: CleanerNotificationView | null;
  action: CleaningAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANING_FORM_STATE,
  );
  const notifiedCurrent = latest !== null && latest.cleanerId === cleanerId;

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <input type="hidden" name="cleanerId" value={cleanerId} />
      <p className="text-xs text-ink-muted">
        {notifiedCurrent ? (
          <>
            Notified ✓ {latest.notifiedAtLabel}
            {latest.notifiedByName && ` · by ${latest.notifiedByName}`}
          </>
        ) : latest ? (
          <>
            Not notified yet — the last notice went to {latest.cleanerName}{" "}
            before the cleaner changed.
          </>
        ) : (
          "Not notified yet"
        )}
      </p>
      <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
        {isPending
          ? "Saving…"
          : notifiedCurrent
            ? "Mark notified again"
            : "Mark cleaner notified"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
