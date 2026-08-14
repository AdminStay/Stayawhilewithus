"use server";

import { revalidatePath } from "next/cache";

import {
  createCleaningScheduleSchema,
  rescheduleCleaningScheduleSchema,
} from "./schemas/cleaning.schema";
import {
  cancelCleaningSchedule,
  completeCleaningSchedule,
  createCleaningSchedule,
  markCleaningScheduleMissed,
  rescheduleCleaningSchedule,
} from "./services/cleaning.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createCleaningScheduleAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createCleaningScheduleSchema.parse({
    propertyId: formData.get("propertyId"),
    reservationId: formData.get("reservationId"),
    cleaningType: formData.get("cleaningType"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledStartTime: formData.get("scheduledStartTime"),
    scheduledEndTime: formData.get("scheduledEndTime"),
  });

  await createCleaningSchedule(actor, input);
  revalidatePath("/cleaning");
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
