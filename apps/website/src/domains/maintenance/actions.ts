"use server";

import { revalidatePath } from "next/cache";

import {
  assignMaintenanceRequestSchema,
  createMaintenanceRequestSchema,
  resolveMaintenanceRequestSchema,
} from "./schemas/maintenance.schema";
import {
  assignMaintenanceRequest,
  createMaintenanceRequest,
  resolveMaintenanceRequest,
} from "./services/maintenance.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createMaintenanceRequestAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createMaintenanceRequestSchema.parse({
    propertyId: formData.get("propertyId"),
    category: formData.get("category"),
    severity: formData.get("severity"),
    description: formData.get("description"),
  });

  await createMaintenanceRequest(actor, input);
  revalidatePath("/maintenance");
}

export async function resolveMaintenanceRequestAction(formData: FormData) {
  const actor = await getCurrentUser();
  const requestId = formData.get("requestId") as string;

  const input = resolveMaintenanceRequestSchema.parse({
    resolutionNotes: formData.get("resolutionNotes"),
  });

  await resolveMaintenanceRequest(actor, requestId, input);
  revalidatePath("/maintenance");
}

export async function assignMaintenanceRequestAction(formData: FormData) {
  const actor = await getCurrentUser();
  const requestId = formData.get("requestId") as string;

  const input = assignMaintenanceRequestSchema.parse({
    assignedToUserId: formData.get("assignedToUserId"),
  });

  await assignMaintenanceRequest(actor, requestId, input);
  revalidatePath("/maintenance");
}
