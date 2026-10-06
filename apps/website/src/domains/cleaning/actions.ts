"use server";

import { ForbiddenError } from "@stayw/auth";
import { revalidatePath } from "next/cache";

import { CleaningRuleError } from "./lib/errors";
import {
  assignCleaningScheduleCleanerSchema,
  createCleaningScheduleSchema,
  markCleanerNotifiedSchema,
  rescheduleCleaningScheduleSchema,
} from "./schemas/cleaning.schema";
import { markCleanerNotified } from "./services/cleaner-notifications.service";
import {
  assignCleaningScheduleCleaner,
  cancelCleaningSchedule,
  completeCleaningSchedule,
  createCleaningSchedule,
  markCleaningScheduleMissed,
  rescheduleCleaningSchedule,
} from "./services/cleaning.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Same discriminated-result convention as cleaners/actions.ts, for the two
 * forms that can be refused for a reason the user can fix (create, and the
 * per-job cleaner picker): only CleaningRuleError messages (written by us)
 * and a fixed permission message are shown; any other error is logged
 * server-side and replaced by a generic string.
 */
export type CleaningFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "validation_error"; message: string }
  | { status: "error"; message: string };

const GENERIC_ERROR_MESSAGE =
  "Something went wrong saving this change. Please try again.";
const FORBIDDEN_MESSAGE = "You don't have permission to change cleanings.";

function toErrorState(err: unknown, label: string): CleaningFormState {
  if (err instanceof CleaningRuleError) {
    return { status: "error", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return { status: "error", message: FORBIDDEN_MESSAGE };
  }
  console.error(`${label} failed:`, err);
  return { status: "error", message: GENERIC_ERROR_MESSAGE };
}

export async function createCleaningScheduleAction(
  _prevState: CleaningFormState,
  formData: FormData,
): Promise<CleaningFormState> {
  const parsed = createCleaningScheduleSchema.safeParse({
    propertyId: formData.get("propertyId"),
    reservationId: formData.get("reservationId"),
    cleaningType: formData.get("cleaningType"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledStartTime: formData.get("scheduledStartTime"),
    scheduledEndTime: formData.get("scheduledEndTime"),
    // Absent when the form has no cleaner field (viewer without
    // cleaners:read) → the service applies the property's default.
    cleanerId: formData.get("cleanerId") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const actor = await getCurrentUser();
    await createCleaningSchedule(actor, parsed.data);
  } catch (err) {
    return toErrorState(err, "createCleaningScheduleAction");
  }

  revalidatePath("/cleaning");
  revalidatePath("/");
  return { status: "success", message: "Cleaning scheduled." };
}

export async function assignCleaningScheduleCleanerAction(
  _prevState: CleaningFormState,
  formData: FormData,
): Promise<CleaningFormState> {
  const parsed = assignCleaningScheduleCleanerSchema.safeParse({
    scheduleId: formData.get("scheduleId"),
    cleanerId: formData.get("cleanerId"),
  });
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  let result: { changed: boolean; cleanerName: string | null };
  try {
    const actor = await getCurrentUser();
    result = await assignCleaningScheduleCleaner(actor, parsed.data);
  } catch (err) {
    return toErrorState(err, "assignCleaningScheduleCleanerAction");
  }

  revalidatePath("/cleaning");
  revalidatePath("/");
  const { changed, cleanerName } = result;
  return {
    status: "success",
    message:
      cleanerName === null
        ? changed
          ? "Cleaner cleared — this cleaning needs a cleaner."
          : "This cleaning already needs a cleaner."
        : changed
          ? `Cleaner set to ${cleanerName}.`
          : `${cleanerName} is already this cleaning's cleaner.`,
  };
}

/**
 * Complete / cancel / missed / reschedule are plain forms that only appear
 * on rows where they're allowed. The service still enforces the lifecycle
 * rules (2026-10-07), so a refusal here means the page was stale — e.g.
 * someone else closed the job meanwhile. Nothing was written; refresh the
 * page so it shows the job's real status, instead of an error screen. Any
 * other error (permission, database) still throws as before.
 */
async function runLifecycleAction(
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (!(err instanceof CleaningRuleError)) throw err;
    console.warn(`${label} refused:`, err.message);
  }
  revalidatePath("/cleaning");
  revalidatePath("/");
}

export async function completeCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await runLifecycleAction("completeCleaningScheduleAction", () =>
    completeCleaningSchedule(actor, scheduleId),
  );
}

export async function cancelCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await runLifecycleAction("cancelCleaningScheduleAction", () =>
    cancelCleaningSchedule(actor, scheduleId),
  );
}

export async function markCleaningScheduleMissedAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await runLifecycleAction("markCleaningScheduleMissedAction", () =>
    markCleaningScheduleMissed(actor, scheduleId),
  );
}

export async function rescheduleCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  const input = rescheduleCleaningScheduleSchema.parse({
    scheduledDate: formData.get("scheduledDate"),
  });

  await runLifecycleAction("rescheduleCleaningScheduleAction", () =>
    rescheduleCleaningSchedule(actor, scheduleId, input),
  );
}

/**
 * Cleaner Phase 5.2 — records that the admin notified the job's cleaner
 * (by hand). Writes one audit entry; sends nothing and changes no job.
 */
export async function markCleanerNotifiedAction(
  _prevState: CleaningFormState,
  formData: FormData,
): Promise<CleaningFormState> {
  const parsed = markCleanerNotifiedSchema.safeParse({
    scheduleId: formData.get("scheduleId"),
    cleanerId: formData.get("cleanerId"),
  });
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  let result: { cleanerName: string };
  try {
    const actor = await getCurrentUser();
    result = await markCleanerNotified(actor, parsed.data);
  } catch (err) {
    return toErrorState(err, "markCleanerNotifiedAction");
  }

  revalidatePath("/cleaning");
  return {
    status: "success",
    message: `Recorded: ${result.cleanerName} was notified.`,
  };
}
