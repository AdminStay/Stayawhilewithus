"use server";

import { revalidatePath } from "next/cache";

import {
  assignUserRoleSchema,
  inviteTeamMemberSchema,
} from "./schemas/users.schema";
import {
  assignUserRole,
  deactivateTeamMember,
  inviteTeamMember,
  revokeInvitation,
  revokeUserRole,
} from "./services/users.service";

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

export async function inviteTeamMemberAction(formData: FormData) {
  const actor = await getCurrentUser();
  const roleId = formData.get("roleId");
  const propertyId = formData.get("propertyId");

  const input = inviteTeamMemberSchema.parse({
    email: formData.get("email"),
    roleId: roleId && roleId !== "" ? roleId : undefined,
    propertyId: propertyId && propertyId !== "" ? propertyId : undefined,
  });

  await inviteTeamMember(actor, input);
  revalidatePath("/users");
}

export async function revokeInvitationAction(formData: FormData) {
  const actor = await getCurrentUser();
  const invitationId = formData.get("invitationId") as string;

  await revokeInvitation(actor, invitationId);
  revalidatePath("/users");
}

export async function deactivateTeamMemberAction(formData: FormData) {
  const actor = await getCurrentUser();
  const userId = formData.get("userId") as string;

  await deactivateTeamMember(actor, userId);
  revalidatePath("/users");
}
