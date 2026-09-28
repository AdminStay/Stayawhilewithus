"use server";

import { revalidatePath } from "next/cache";

import {
  summarizeOwnerRezPreview,
  type OwnerRezPreviewSummary,
} from "./lib/ownerrez-preview-summary";
import {
  createReservationSchema,
  updateReservationStatusSchema,
} from "./schemas/reservations.schema";
import {
  previewOwnerRezReservationSync,
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
  | { status: "cooldown"; cooldownUntil: string }
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
    if (result.status === "cooldown") {
      return { status: "cooldown", cooldownUntil: result.cooldownUntil };
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
      nonGuest: result.nonGuest,
      guestErrors: result.guestErrors,
      guestDeferred: result.guestDeferred,
      deferredUntil: result.deferredUntil,
    };
  } catch (err) {
    console.error("syncOwnerRezReservationsAction failed:", err);
    return {
      status: "failure",
      error: "Something went wrong syncing OwnerRez reservations.",
    };
  }
}

export type PreviewOwnerRezSyncActionState =
  | { status: "idle" }
  | { status: "preview"; generatedAt: string; summary: OwnerRezPreviewSummary }
  | { status: "not_configured" }
  | { status: "failure"; error: string };

/**
 * "Preview OwnerRez Sync" (2026-09-28). Strictly read-only: calls only
 * previewOwnerRezReservationSync(), which issues OwnerRez GETs (the same
 * operational retrieval and request budget as the real sync) plus
 * StayWhile database READS — no Guest/Reservation/link writes, no
 * IntegrationConnection or IntegrationSyncLog row, no audit entry. Nothing
 * is revalidated because nothing changed. Never calls the real sync.
 */
export async function previewOwnerRezSyncAction(
  _prevState: PreviewOwnerRezSyncActionState,
): Promise<PreviewOwnerRezSyncActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await previewOwnerRezReservationSync(actor);
    if (!result.configured) return { status: "not_configured" };
    if ("error" in result) return { status: "failure", error: result.error };
    const now = new Date();
    return {
      status: "preview",
      generatedAt: now.toISOString(),
      summary: summarizeOwnerRezPreview(result.plan, now),
    };
  } catch (err) {
    console.error("previewOwnerRezSyncAction failed:", err);
    return {
      status: "failure",
      error: "Something went wrong previewing the OwnerRez sync.",
    };
  }
}
