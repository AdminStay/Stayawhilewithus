"use server";

import { revalidatePath } from "next/cache";

import { markNotificationRead } from "./services/notifications.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function markNotificationReadAction(formData: FormData) {
  const actor = await getCurrentUser();
  const notificationId = formData.get("notificationId") as string;

  await markNotificationRead(actor, notificationId);
  revalidatePath("/notifications");
}
