"use server";

import { revalidatePath } from "next/cache";

import {
  createMessageThreadSchema,
  sendMessageSchema,
} from "./schemas/communications.schema";
import {
  archiveMessageThread,
  closeMessageThread,
  createMessageThread,
  sendMessage,
} from "./services/communications.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createMessageThreadAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createMessageThreadSchema.parse({
    propertyId: formData.get("propertyId"),
    reservationId: formData.get("reservationId"),
    guestId: formData.get("guestId"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });

  await createMessageThread(actor, input);
  revalidatePath("/communications");
}

export async function sendMessageAction(formData: FormData) {
  const actor = await getCurrentUser();
  const threadId = formData.get("threadId") as string;

  const input = sendMessageSchema.parse({
    body: formData.get("body"),
  });

  await sendMessage(actor, threadId, input);
  revalidatePath("/communications");
}

export async function closeMessageThreadAction(formData: FormData) {
  const actor = await getCurrentUser();
  const threadId = formData.get("threadId") as string;

  await closeMessageThread(actor, threadId);
  revalidatePath("/communications");
}

export async function archiveMessageThreadAction(formData: FormData) {
  const actor = await getCurrentUser();
  const threadId = formData.get("threadId") as string;

  await archiveMessageThread(actor, threadId);
  revalidatePath("/communications");
}
