"use client";

import { Button, FormField, Input, Textarea } from "@stayw/ui";
import { useActionState } from "react";

import type { CleanerContactView } from "../services/cleaners.service";

import { FormMessage } from "./FormMessage";
import { INITIAL_CLEANER_FORM_STATE, type CleanerAction } from "./types";

/**
 * Add (with `cleanerId`) or edit (with `contact`) one backup contact.
 * Only ever rendered for a `cleaners:manage` holder, the only case where
 * `contact.phone` carries the full number to prefill.
 */
export function CleanerContactForm({
  cleanerId,
  contact,
  action,
}: {
  cleanerId?: string;
  contact?: CleanerContactView;
  action: CleanerAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANER_FORM_STATE,
  );
  const prefix = contact
    ? `edit-contact-${contact.id}`
    : `new-contact-${cleanerId}`;

  return (
    <form action={formAction} className="space-y-4">
      {contact ? (
        <input type="hidden" name="id" value={contact.id} />
      ) : (
        <input type="hidden" name="cleanerId" value={cleanerId} />
      )}
      <FormField
        label="Backup phone"
        htmlFor={`${prefix}-phone`}
        description="10 digits for US numbers, or include the + country code."
      >
        <Input
          id={`${prefix}-phone`}
          name="phone"
          type="tel"
          defaultValue={contact?.phone ?? ""}
          required
        />
      </FormField>
      <FormField
        label="Contact name"
        htmlFor={`${prefix}-name`}
        description="Optional — leave empty if this is another number for the cleaner themself."
      >
        <Input
          id={`${prefix}-name`}
          name="name"
          defaultValue={contact?.name ?? ""}
        />
      </FormField>
      <FormField
        label="Relationship"
        htmlFor={`${prefix}-relationship`}
        description="Optional — e.g. Sister, Partner, Team member."
      >
        <Input
          id={`${prefix}-relationship`}
          name="relationship"
          defaultValue={contact?.relationship ?? ""}
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
          defaultValue={contact?.notes ?? ""}
        />
      </FormField>

      <FormMessage state={state} />

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending
          ? "Saving…"
          : contact
            ? "Save contact"
            : "Add backup contact"}
      </Button>
    </form>
  );
}
