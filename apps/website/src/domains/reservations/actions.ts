"use server";

import { revalidatePath } from "next/cache";

import {
  createReservationSchema,
  updateReservationStatusSchema,
} from "./schemas/reservations.schema";
import {
  syncOwnerRezReservations,
  type OwnerRezReservationSyncResult,
} from "./services/ownerrez-reservation-sync.service";
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

export type SyncOwnerRezReservationsActionState =
  | { status: "idle" }
  | ({ status: "success"; syncedAt: string } & OwnerRezReservationSyncResult)
  | { status: "already_running" }
  | { status: "failure"; error: string };

/**
 * Manual "Sync Now" trigger for the real OwnerRez -> Reservation
 * synchronization (see ownerrez-reservation-sync.service.ts's own doc
 * comment for the full read/write boundary and matching discipline). Same
 * guarded-outcome handling shape as refreshAugustAction
 * (smart-devices/actions.ts) — already_running/failure are real outcomes
 * from the service itself, not exceptions, so both are handled the same
 * way as an unexpected thrown error.
 */
export async function syncOwnerRezReservationsAction(
  _prevState: SyncOwnerRezReservationsActionState,
): Promise<SyncOwnerRezReservationsActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await syncOwnerRezReservations(actor);

    if (result.status === "already_running") {
      return { status: "already_running" };
    }
    if (result.status === "failed") {
      return { status: "failure", error: result.reason };
    }

    revalidatePath("/reservations");
    revalidatePath("/");
    return {
      status: "success",
      syncedAt: new Date().toISOString(),
      created: result.created,
      updated: result.updated,
      unmatchedProperty: result.unmatchedProperty,
      unrecognizedStatus: result.unrecognizedStatus,
      guestErrors: result.guestErrors,
    };
  } catch (err) {
    console.error("syncOwnerRezReservationsAction failed:", err);
    return {
      status: "failure",
      error: "Something went wrong syncing OwnerRez reservations.",
    };
  }
}
