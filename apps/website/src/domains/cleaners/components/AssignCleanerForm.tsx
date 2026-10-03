"use client";

import { Button, Select } from "@stayw/ui";
import { useActionState } from "react";

import { FormMessage } from "./FormMessage";
import { INITIAL_CLEANER_FORM_STATE, type CleanerAction } from "./types";

/**
 * Assign an ACTIVE cleaner to one property as Primary or Team member.
 * Choosing "Primary" when the property already has one REPLACES it (the
 * old row is ended and kept as history) — the confirm text says so.
 */
export function AssignCleanerForm({
  propertyId,
  propertyName,
  hasPrimary,
  cleaners,
  action,
}: {
  propertyId: string;
  propertyName: string;
  hasPrimary: boolean;
  /** ACTIVE cleaners not currently assigned to this property. */
  cleaners: Array<{ id: string; name: string }>;
  action: CleanerAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANER_FORM_STATE,
  );

  if (cleaners.length === 0) {
    return (
      <p className="text-xs text-ink-faint">No other active cleaners to add.</p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center justify-end gap-1.5"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const role = (form.elements.namedItem("role") as HTMLSelectElement)
          .value;
        if (
          role === "PRIMARY" &&
          hasPrimary &&
          !window.confirm(
            `Replace the current primary cleaner for ${propertyName}? The current assignment is ended and kept in history.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      <Select
        name="cleanerId"
        defaultValue=""
        aria-label={`Cleaner for ${propertyName}`}
        className="py-1.5 text-xs"
        required
      >
        <option value="" disabled>
          Choose cleaner…
        </option>
        {cleaners.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        name="role"
        defaultValue={hasPrimary ? "TEAM_MEMBER" : "PRIMARY"}
        aria-label={`Role at ${propertyName}`}
        className="py-1.5 text-xs"
      >
        <option value="PRIMARY">as Primary</option>
        <option value="TEAM_MEMBER">as Team member</option>
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Assign"}
      </Button>
      <div className="basis-full text-right">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
