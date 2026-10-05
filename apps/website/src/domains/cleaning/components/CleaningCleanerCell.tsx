"use client";

import { Badge, Button, Select } from "@stayw/ui";
import { useActionState } from "react";

import { CLEAR_CLEANER_VALUE } from "../schemas/cleaning.schema";

import {
  CleanerNotifiedControl,
  type CleanerNotificationView,
} from "./CleanerNotifiedControl";
import { CopyCleanerMessageButton } from "./CopyCleanerMessageButton";
import {
  cleanerOptionGroups,
  INITIAL_CLEANING_FORM_STATE,
  isTeamOnly,
  type CleanerOption,
  type CleaningAction,
  type PropertyCleaners,
} from "./cleaner-options";

import { FormMessage } from "@/domains/cleaners/components/FormMessage";

/**
 * The Cleaner cell of one /cleaning row (Cleaner Phase 4): the job's stored
 * cleaner, or "Needs cleaner"; for a property with a team and no primary,
 * the team is shown as context without naming anyone primary. The picker
 * appears only when `canChange` (admin) and the job isn't completed,
 * cancelled or missed — the server enforces both again. It can assign an
 * ACTIVE cleaner, switch to another one, or clear back to "Needs cleaner".
 */
export function CleaningCleanerCell({
  scheduleId,
  propertyName,
  cleaner,
  propertyCleaners,
  activeCleaners,
  canChange,
  action,
  cleanerMessage = null,
  notification = null,
}: {
  scheduleId: string;
  propertyName: string;
  cleaner: { id: string; name: string; status: string } | null;
  propertyCleaners: PropertyCleaners | undefined;
  activeCleaners: CleanerOption[];
  /** Admin, and the job is still open. */
  canChange: boolean;
  action: CleaningAction;
  /**
   * Phase 5.1: the prepared text for "Copy cleaner message". Built on the
   * server and passed ONLY for an admin, on an open job that has a cleaner;
   * null otherwise, so no one else ever receives it.
   */
  cleanerMessage?: string | null;
  /**
   * Phase 5.2: "Mark cleaner notified". Passed ONLY for an admin, on an
   * open job that has a cleaner (same rule as cleanerMessage); null
   * otherwise. `latest` is the job's latest recorded notification, if any.
   */
  notification?: {
    latest: CleanerNotificationView | null;
    action: CleaningAction;
  } | null;
}) {
  const teamOnly = isTeamOnly(propertyCleaners);

  return (
    <div className="space-y-1.5">
      {cleaner ? (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-ink">{cleaner.name}</span>
          {cleaner.status !== "ACTIVE" && (
            <Badge tone="neutral">Inactive</Badge>
          )}
        </div>
      ) : (
        <Badge tone="warning">Needs cleaner</Badge>
      )}
      {cleaner && cleanerMessage && (
        <CopyCleanerMessageButton message={cleanerMessage} />
      )}
      {cleaner && notification && (
        <CleanerNotifiedControl
          scheduleId={scheduleId}
          cleanerId={cleaner.id}
          latest={notification.latest}
          action={notification.action}
        />
      )}
      {teamOnly && propertyCleaners && (
        <div className="text-xs text-ink-muted">
          Team: {propertyCleaners.teamMembers.map((m) => m.name).join(", ")} ·
          no primary
        </div>
      )}
      {canChange && (
        <CleanerPicker
          scheduleId={scheduleId}
          propertyName={propertyName}
          currentCleanerId={cleaner?.id ?? null}
          propertyCleaners={propertyCleaners}
          activeCleaners={activeCleaners}
          action={action}
        />
      )}
    </div>
  );
}

function CleanerPicker({
  scheduleId,
  propertyName,
  currentCleanerId,
  propertyCleaners,
  activeCleaners,
  action,
}: {
  scheduleId: string;
  propertyName: string;
  currentCleanerId: string | null;
  propertyCleaners: PropertyCleaners | undefined;
  activeCleaners: CleanerOption[];
  action: CleaningAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANING_FORM_STATE,
  );
  const groups = cleanerOptionGroups(propertyCleaners, activeCleaners);
  // Clearing is offered only when there is a cleaner to clear.
  const canClear = currentCleanerId !== null;
  if (groups.length === 0 && !canClear) {
    return <p className="text-xs text-ink-faint">No active cleaners.</p>;
  }
  const currentIsOffered = groups.some((g) =>
    g.options.some((o) => o.id === currentCleanerId),
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <Select
        name="cleanerId"
        defaultValue={
          currentIsOffered && currentCleanerId ? currentCleanerId : ""
        }
        aria-label={`Cleaner for this cleaning at ${propertyName}`}
        className="py-1.5 text-xs"
        required
      >
        <option value="" disabled>
          Choose cleaner…
        </option>
        {canClear && (
          <option value={CLEAR_CLEANER_VALUE}>
            Needs cleaner (clear assignment)
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : currentCleanerId ? "Change" : "Assign"}
      </Button>
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
