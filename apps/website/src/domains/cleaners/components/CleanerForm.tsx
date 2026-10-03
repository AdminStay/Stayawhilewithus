"use client";

import { Button, FormField, Input, Textarea } from "@stayw/ui";
import { useActionState } from "react";

import type { CleanerView } from "../services/cleaners.service";

import { FormMessage } from "./FormMessage";
import { INITIAL_CLEANER_FORM_STATE, type CleanerAction } from "./types";

/**
 * Add (no `cleaner`) or edit (with `cleaner`) a cleaner. Only ever rendered
 * for a `cleaners:manage` holder, which is also the only case where
 * `cleaner.phone` carries the full number to prefill.
 */
export function CleanerForm({
  cleaner,
  action,
}: {
  cleaner?: Pick<CleanerView, "id" | "name" | "phone" | "notes">;
  action: CleanerAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANER_FORM_STATE,
  );
  const prefix = cleaner ? `edit-cleaner-${cleaner.id}` : "new-cleaner";

  return (
    <form action={formAction} className="space-y-4">
      {cleaner && <input type="hidden" name="id" value={cleaner.id} />}
      <FormField label="Name" htmlFor={`${prefix}-name`}>
        <Input
          id={`${prefix}-name`}
          name="name"
          defaultValue={cleaner?.name ?? ""}
          required
        />
      </FormField>
      <FormField
        label="Phone"
        htmlFor={`${prefix}-phone`}
        description="10 digits for US numbers, or include the + country code."
      >
        <Input
          id={`${prefix}-phone`}
          name="phone"
          type="tel"
          defaultValue={cleaner?.phone ?? ""}
          required
        />
      </FormField>
      <FormField
        label="Notes"
        htmlFor={`${prefix}-notes`}
        description="Optional"
      >
        <Textarea
          id={`${prefix}-notes`}
          name="notes"
          defaultValue={cleaner?.notes ?? ""}
        />
      </FormField>

      <FormMessage state={state} />

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : cleaner ? "Save changes" : "Add cleaner"}
      </Button>
    </form>
  );
}
