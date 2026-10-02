import "server-only";

import { randomUUID } from "node:crypto";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma, type Reservation } from "@stayw/database";

export type { Reservation };

import {
  buildReservationListWhere,
  groupPropertiesByLocalDay,
  pageWindow,
  RESERVATION_LISTS,
  RESERVATION_VIEWS,
  reservationListOrderBy,
  TODAY_LIST_LIMIT,
  VIEW_LISTS,
  type PropertyTimeZoneInput,
  type ReservationListKind,
  type ReservationView,
  type ReservationViewParams,
} from "../lib/reservation-views";
import type {
  CreateReservationInput,
  UpdateReservationStatusInput,
} from "../schemas/reservations.schema";

import { isOperationalProperty } from "@/domains/properties/lib/operational-properties";
import { recordAudit } from "@/platform/audit/record-audit";

export async function listReservations(actor: AuthContext) {
  await assertPermission(actor, "reservations:read");
  return prisma.reservation.findMany({
    orderBy: { checkInDate: "desc" },
    include: { property: true, primaryGuest: true },
  });
}

/**
 * One tab of the operational views (see lib/reservation-views.ts) plus the
 * count for every tab under the same property/cancelled filters. All
 * filtering, counting and paging run in the database. `properties` is the
 * caller's permission-checked listProperties(); only operational ones
 * (ACTIVE / ONBOARDING, not deleted) take part. Read-only.
 *
 * Today returns its two lists (`checkIns`, `checkOuts`), each capped at
 * TODAY_LIST_LIMIT and unpaged; every other tab returns one paged `rows`.
 */
export async function listReservationView(
  actor: AuthContext,
  params: ReservationViewParams,
  properties: Array<
    PropertyTimeZoneInput & { status: string; deletedAt?: Date | null }
  >,
  now: Date = new Date(),
) {
  await assertPermission(actor, "reservations:read");

  const operational = properties.filter(isOperationalProperty);
  const { groups, unresolved } = groupPropertiesByLocalDay(operational, now);
  const filters = {
    propertyId: params.propertyId,
    includeCancelled: params.includeCancelled,
  };
  const whereFor = (list: ReservationListKind) =>
    buildReservationListWhere(
      list,
      groups,
      filters,
    ) as Prisma.ReservationWhereInput;
  const orderFor = (list: ReservationListKind) =>
    reservationListOrderBy(
      list,
    ) as Prisma.ReservationOrderByWithRelationInput[];
  const include = { property: true, primaryGuest: true } as const;

  const listCountEntries = await Promise.all(
    RESERVATION_LISTS.map(
      async (list) =>
        [
          list,
          await prisma.reservation.count({ where: whereFor(list) }),
        ] as const,
    ),
  );
  const listCounts = Object.fromEntries(listCountEntries) as Record<
    ReservationListKind,
    number
  >;
  const counts = Object.fromEntries(
    RESERVATION_VIEWS.map((view) => [
      view,
      VIEW_LISTS[view].reduce((sum, list) => sum + listCounts[list], 0),
    ]),
  ) as Record<ReservationView, number>;

  const base = {
    counts,
    listCounts,
    /** Distinct local "today" dates in use (one per timezone group). */
    localDays: groups.map((g) => g.today),
    /** Properties left out of date-based views because their timezone couldn't be resolved. */
    unresolvedTimezoneProperties: unresolved,
  };

  if (params.view === "today") {
    const todayList = (list: "check-ins" | "check-outs") =>
      prisma.reservation.findMany({
        where: whereFor(list),
        orderBy: orderFor(list),
        take: TODAY_LIST_LIMIT,
        include,
      });
    const [checkIns, checkOuts] = await Promise.all([
      todayList("check-ins"),
      todayList("check-outs"),
    ]);
    return {
      ...base,
      checkIns,
      checkOuts,
      rows: [] as typeof checkIns,
      total: counts.today,
      page: 1,
      pageCount: 1,
      pageSize: TODAY_LIST_LIMIT,
    };
  }

  const list = VIEW_LISTS[params.view][0]!;
  const total = listCounts[list];
  const window = pageWindow(params.page, total);
  const rows = await prisma.reservation.findMany({
    where: whereFor(list),
    orderBy: orderFor(list),
    skip: window.skip,
    take: window.take,
    include,
  });

  return {
    ...base,
    checkIns: [] as typeof rows,
    checkOuts: [] as typeof rows,
    rows,
    total,
    page: window.page,
    pageCount: window.pageCount,
    pageSize: window.take,
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

  // OwnerRez bookings are read-only in StayWhile (Meeting #6): changes are
  // made in OwnerRez, and the hourly sync would overwrite them anyway.
  // Enforced here so every caller (the /reservations form and the AI tool)
  // is covered, not just the UI.
  const current = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { source: true },
  });
  if (current.source === "OWNERREZ") {
    throw new Error(
      "OwnerRez bookings can't be changed in StayWhile — change them in OwnerRez.",
    );
  }

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
