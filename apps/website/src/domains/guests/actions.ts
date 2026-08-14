"use server";

import { revalidatePath } from "next/cache";

import { createGuestSchema, updateGuestSchema } from "./schemas/guests.schema";
import {
  createGuest,
  deleteGuest,
  updateGuest,
} from "./services/guests.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createGuestAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createGuestSchema.parse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });

  await createGuest(actor, input);
  revalidatePath("/guests");
}

export async function updateGuestAction(formData: FormData) {
  const actor = await getCurrentUser();
  const guestId = formData.get("guestId") as string;

  const input = updateGuestSchema.parse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });

  await updateGuest(actor, guestId, input);
  revalidatePath("/guests");
}

export async function deleteGuestAction(formData: FormData) {
  const actor = await getCurrentUser();
  const guestId = formData.get("guestId") as string;

  await deleteGuest(actor, guestId);
  revalidatePath("/guests");
}
