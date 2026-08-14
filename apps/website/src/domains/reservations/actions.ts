"use server";

import { revalidatePath } from "next/cache";

import {
  createReservationSchema,
  updateReservationStatusSchema,
} from "./schemas/reservations.schema";
import {
  createReservation,
  updateReservationStatus,
} from "./services/reservations.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createReservationAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createReservationSchema.parse({
    propertyId: formData.get("propertyId"),
    primaryGuestId: formData.get("primaryGuestId"),
    checkInDate: formData.get("checkInDate"),
    checkOutDate: formData.get("checkOutDate"),
    adults: Number(formData.get("adults")),
    children: Number(formData.get("children")),
    pets: Number(formData.get("pets")),
    totalAmount: Number(formData.get("totalAmount")),
    specialRequests: formData.get("specialRequests"),
  });

  await createReservation(actor, input);
  revalidatePath("/reservations");
}

export async function updateReservationStatusAction(formData: FormData) {
  const actor = await getCurrentUser();
  const reservationId = formData.get("reservationId") as string;

  const input = updateReservationStatusSchema.parse({
    status: formData.get("status"),
  });

  await updateReservationStatus(actor, reservationId, input);
  revalidatePath("/reservations");
}
