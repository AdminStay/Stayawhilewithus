import "server-only";

import { randomUUID } from "node:crypto";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma, type Reservation } from "@stayw/database";

export type { Reservation };

import {
  buildReservationViewWhere,
  groupPropertiesByLocalDay,
  pageWindow,
  RESERVATION_VIEWS,
  reservationViewOrderBy,
  type PropertyTimeZoneInput,
  type ReservationView,
  type ReservationViewParams,
} from "../lib/reservation-views";
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
 * One page of an operational view (see lib/reservation-views.ts) plus the
 * count for every view under the same property/cancelled filters. All
 * filtering, counting and paging run in the database. `properties`
 * supplies each property's timezone (the caller's permission-checked
 * listProperties()). Read-only.
 */
export async function listReservationView(
  actor: AuthContext,
  params: ReservationViewParams,
  properties: PropertyTimeZoneInput[],
  now: Date = new Date(),
) {
  await assertPermission(actor, "reservations:read");

  const { groups, unresolved } = groupPropertiesByLocalDay(properties, now);
  const filters = {
    propertyId: params.propertyId,
    includeCancelled: params.includeCancelled,
  };
  const whereFor = (view: ReservationView) =>
    buildReservationViewWhere(
      view,
      groups,
      filters,
    ) as Prisma.ReservationWhereInput;

  const countEntries = await Promise.all(
    RESERVATION_VIEWS.map(
      async (view) =>
        [
          view,
          await prisma.reservation.count({ where: whereFor(view) }),
        ] as const,
    ),
  );
  const counts = Object.fromEntries(countEntries) as Record<
    ReservationView,
    number
  >;

  const total = counts[params.view];
  const window = pageWindow(params.page, total);
  const rows = await prisma.reservation.findMany({
    where: whereFor(params.view),
    orderBy: reservationViewOrderBy(
      params.view,
    ) as Prisma.ReservationOrderByWithRelationInput[],
    skip: window.skip,
    take: window.take,
    include: { property: true, primaryGuest: true },
  });

  return {
    rows,
    counts,
    total,
    page: window.page,
    pageCount: window.pageCount,
    pageSize: window.take,
    /** Distinct local "today" dates in use (one per timezone group). */
    localDays: groups.map((g) => g.today),
    /** Properties left out of date-based views because their timezone couldn't be resolved. */
    unresolvedTimezoneProperties: unresolved,
  };
}

/** Narrow rows for the page's existing revenue/ADR metrics and total — no relations. */
export async function listReservationRevenueRows(actor: AuthContext) {
  await assertPermission(actor, "reservations:read");
  return prisma.reservation.findMany({
    select: {
      status: true,
      totalAmount: true,
      checkInDate: true,
      checkOutDate: true,
    },
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
