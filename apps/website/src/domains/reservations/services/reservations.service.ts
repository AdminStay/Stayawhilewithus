import "server-only";

import { randomUUID } from "node:crypto";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Reservation } from "@stayw/database";

export type { Reservation };

import type {
  CreateReservationInput,
  UpdateReservationStatusInput,
} from "../schemas/reservations.schema";

import { recordAudit } from "@/platform/audit/record-audit";

export async function listReservations(actor: AuthContext) {
  await assertPermission(actor, "reservations:read");
  return prisma.reservation.findMany({
    orderBy: { checkInDate: "desc" },
    include: { property: true, primaryGuest: true },
  });
}

/**
 * Manually-created bookings are modeled as source=DIRECT with a generated
 * externalReservationId, since that column (together with `source`) is the
 * table's uniqueness key and every non-DIRECT source gets a real ID from its
 * provider (OwnerRez, Airbnb) once that sync exists.
 */
export async function createReservation(
  actor: AuthContext,
  input: CreateReservationInput,
) {
  await assertPermission(actor, "reservations:create");

  const reservation = await prisma.$transaction(async (tx) => {
    const created = await tx.reservation.create({
      data: {
        propertyId: input.propertyId,
        primaryGuestId: input.primaryGuestId,
        source: "DIRECT",
        externalReservationId: randomUUID(),
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        pets: input.pets,
        totalAmount: input.totalAmount,
        specialRequests: input.specialRequests || undefined,
      },
    });

    await tx.reservationGuest.create({
      data: {
        reservationId: created.id,
        guestId: input.primaryGuestId,
        isPrimary: true,
      },
    });

    return created;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "reservation.created",
    entityType: "Reservation",
    entityId: reservation.id,
    afterState: reservation,
  });

  return reservation;
}

export async function updateReservationStatus(
  actor: AuthContext,
  reservationId: string,
  input: UpdateReservationStatusInput,
) {
  await assertPermission(actor, "reservations:update");

  const reservation = await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: input.status },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "reservation.status_updated",
    entityType: "Reservation",
    entityId: reservation.id,
    afterState: reservation,
  });

  return reservation;
}
