"use client";

import { ConfirmButton, type ButtonVariant } from "@stayw/ui";
import { useActionState } from "react";

import { FormMessage } from "./FormMessage";
import { INITIAL_CLEANER_FORM_STATE, type CleanerAction } from "./types";

/**
 * One confirmed, single-purpose cleaners action (Deactivate, Reactivate,
 * Make primary, Remove) — hidden fields + a confirm() gate + the result
 * message inline next to the button.
 */
export function CleanerActionButton({
  action,
  fields,
  label,
  confirmMessage,
  variant = "secondary",
}: {
  action: CleanerAction;
  fields: Record<string, string>;
  label: string;
  confirmMessage: string;
  variant?: ButtonVariant;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANER_FORM_STATE,
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <ConfirmButton
        type="submit"
        variant={variant}
        size="sm"
        disabled={isPending}
        confirmMessage={confirmMessage}
      >
        {label}
      </ConfirmButton>
      {state.status !== "success" && <FormMessage state={state} />}
    </form>
  );
}
