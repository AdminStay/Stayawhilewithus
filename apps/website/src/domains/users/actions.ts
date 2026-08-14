"use server";

import { revalidatePath } from "next/cache";

import { assignUserRoleSchema } from "./schemas/users.schema";
import { assignUserRole, revokeUserRole } from "./services/users.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function assignUserRoleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const userId = formData.get("userId") as string;
  const propertyId = formData.get("propertyId");

  const input = assignUserRoleSchema.parse({
    roleId: formData.get("roleId"),
    propertyId: propertyId && propertyId !== "" ? propertyId : undefined,
  });

  await assignUserRole(actor, userId, input);
  revalidatePath("/users");
}

export async function revokeUserRoleAction(formData: FormData) {
  const actor = await getCurrentUser();
  const userRoleId = formData.get("userRoleId") as string;

  await revokeUserRole(actor, userRoleId);
  revalidatePath("/users");
}
