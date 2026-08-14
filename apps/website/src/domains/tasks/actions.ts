"use server";

import { revalidatePath } from "next/cache";

import { createTaskSchema } from "./schemas/tasks.schema";
import { assignTask, completeTask, createTask } from "./services/tasks.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createTaskAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createTaskSchema.parse({
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type"),
    priority: formData.get("priority"),
    propertyId: formData.get("propertyId"),
    dueAt: formData.get("dueAt") || undefined,
  });

  await createTask(actor, input);
  revalidatePath("/tasks");
}

export async function completeTaskAction(formData: FormData) {
  const actor = await getCurrentUser();
  const taskId = formData.get("taskId") as string;

  await completeTask(actor, taskId);
  revalidatePath("/tasks");
}

export async function assignTaskAction(formData: FormData) {
  const actor = await getCurrentUser();
  const taskId = formData.get("taskId") as string;
  const assignedToUserId = (formData.get("assignedToUserId") as string) || null;

  await assignTask(actor, taskId, assignedToUserId);
  revalidatePath("/tasks");
}
