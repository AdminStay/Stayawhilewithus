"use client";

import { ConfirmButton } from "@stayw/ui";
import { useActionState } from "react";

import { createPropertyFromOwnerRezAction } from "../actions";

import type { CreatePropertyFromOwnerRezActionState } from "../actions";

const INITIAL_STATE: CreatePropertyFromOwnerRezActionState = { status: "idle" };

/**
 * Client component so a thrown create error renders inline on this row
 * instead of crashing the whole page to Next.js's generic error boundary —
 * the same useActionState pending/success/failure pattern already proven by
 * DiscoverDevicesButton (smart-devices domain). `isPending` both disables
 * the button and swaps its label, which is what prevents a double
 * submission while a create is in flight — the same mechanism, same reason.
 *
 * Confirmation (window.confirm via ConfirmButton), the hidden
 * ownerRezPropertyId field, and every server-side validation rule inside
 * createPropertyFromOwnerRez() are completely unchanged by this component —
 * it only changes how the action's result reaches the screen. A failure
 * here never blocks a later attempt: the button returns to its normal,
 * re-clickable state, and nothing about this row's own markup or the rest
 * of the page is affected.
 */
export function CreatePropertyFromOwnerRezButton({
  ownerRezPropertyId,
  ownerRezPropertyName,
}: {
  ownerRezPropertyId: number;
  ownerRezPropertyName: string;
}) {
  const [state, formAction, isPending] = useActionState(
    createPropertyFromOwnerRezAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="ownerRezPropertyId"
        value={String(ownerRezPropertyId)}
      />
      <ConfirmButton
        type="submit"
        variant="primary"
        size="sm"
        disabled={isPending}
        confirmMessage={`Create a StayWhile property from OwnerRez property "${ownerRezPropertyName}" (ID ${ownerRezPropertyId})? It will be created at Onboarding status. This cannot be undone from this page.`}
      >
        {isPending ? "Creating…" : "Create StayWhile Property"}
      </ConfirmButton>

      {state.status === "success" && (
        <p className="mt-1 text-xs text-success-600">
          Created &quot;{state.propertyName}&quot; at Onboarding status.
        </p>
      )}
      {state.status === "failure" && (
        <p className="mt-1 text-xs text-error-500">{state.error}</p>
      )}
    </form>
  );
}
