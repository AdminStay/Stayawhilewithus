"use server";

import { revalidatePath } from "next/cache";

import {
  escalateAiConversationSchema,
  rejectAiActionSchema,
} from "./schemas/ai.schema";
import {
  approveAiAction,
  escalateAiConversation,
  rejectAiAction,
} from "./services/ai.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function approveAiActionAction(formData: FormData) {
  const actor = await getCurrentUser();
  const actionId = formData.get("actionId") as string;

  await approveAiAction(actor, actionId);
  revalidatePath("/ai");
}

export async function rejectAiActionAction(formData: FormData) {
  const actor = await getCurrentUser();
  const actionId = formData.get("actionId") as string;

  const input = rejectAiActionSchema.parse({
    rejectionReason: formData.get("rejectionReason"),
  });

  await rejectAiAction(actor, actionId, input);
  revalidatePath("/ai");
}

export async function escalateAiConversationAction(formData: FormData) {
  const actor = await getCurrentUser();
  const conversationId = formData.get("conversationId") as string;

  const input = escalateAiConversationSchema.parse({
    details: formData.get("details"),
  });

  await escalateAiConversation(actor, conversationId, input);
  revalidatePath("/ai");
}
