"use server";

import { ForbiddenError } from "@stayw/auth";
import { revalidatePath } from "next/cache";

import { CleaningRuleError } from "./lib/errors";
import {
  assignCleaningScheduleCleanerSchema,
  createCleaningScheduleSchema,
  rescheduleCleaningScheduleSchema,
} from "./schemas/cleaning.schema";
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

export async function completeCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await completeCleaningSchedule(actor, scheduleId);
  revalidatePath("/cleaning");
}

export async function cancelCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await cancelCleaningSchedule(actor, scheduleId);
  revalidatePath("/cleaning");
}

export async function markCleaningScheduleMissedAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  await markCleaningScheduleMissed(actor, scheduleId);
  revalidatePath("/cleaning");
}

export async function rescheduleCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const scheduleId = formData.get("scheduleId") as string;

  const input = rescheduleCleaningScheduleSchema.parse({
    scheduledDate: formData.get("scheduledDate"),
  });

  await rescheduleCleaningSchedule(actor, scheduleId, input);
  revalidatePath("/cleaning");
  revalidatePath("/");
}
