import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  OwnerrezClient,
  type OwnerrezBooking,
} from "@stayw/integrations/ownerrez";

import {
  ensureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS,
} from "@/domains/integrations/services/integrations.service";
import { recordAudit } from "@/platform/audit/record-audit";

/**
 * OwnerRez -> StayWhile real reservation synchronization (2026-09-24) — the
 * read-from-provider, write-to-StayWhile-DB counterpart OwnerrezClient's own
 * sync() deliberately never became (see that method's doc comment:
 * "mapping bookings into Reservation/Guest rows needs its own
 * identity-matching and dedupe design plus explicit write authorization...
 * that stays a deliberately separate follow-up" — this file is that
 * follow-up). OwnerRez remains the sole source of truth: this never writes
 * anything back to OwnerRez, and never fabricates a reservation, guest, or
 * property relationship that OwnerRez's own data doesn't support.
 *
 * Matching discipline (same standing rule as every other provider in this
 * codebase — no fuzzy name matching, ever):
 *   - Property: matched ONLY by the already-established, admin-confirmed
 *     `Property.ownerRezPropertyId` (see the OwnerRez property-matching
 *     work referenced in HANDOFF.md) — a booking whose `property_id` has
 *     no StayWhile property linked to it is skipped and reported, never
 *     guessed by name.
 *   - Guest: matched ONLY by `Guest.ownerRezGuestId` (a real, already-
 *     modeled unique column) — created from OwnerRez's own guest record on
 *     first sight, never from booking-only data (which has no name).
 *
 * Idempotency: `Reservation` already has `@@unique([source,
 * externalReservationId])` — every write here is a real upsert on that
 * exact key (`source: "OWNERREZ"`, `externalReservationId: String(booking.id)`),
 * so re-running this sync any number of times never creates a duplicate
 * reservation, it only ever refreses the same real row.
 */

function getOwnerRezCredentials(): { username: string; token: string } | null {
  const username = process.env.OWNERREZ_USERNAME;
  const token = process.env.OWNERREZ_API_TOKEN;
  if (!username || !token) return null;
  return { username, token };
}

export function logOwnerRezReservationSync(
  event: string,
  data: Record<string, unknown> = {},
): void {
  console.log(
    "[ownerrez-reservation-sync]",
    JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }),
  );
}

/**
 * OwnerRez's real booking `status` field has exactly two observed values in
 * production data (confirmed live, read-only, 2026-09-24: 862 "active" / 79
 * "canceled" across 941 real bookings) — no PENDING/CONFIRMED/CHECKED_IN/
 * CHECKED_OUT distinction exists on the provider side at all. Mapping
 * "active" to StayWhile's `CONFIRMED` (rather than inventing a finer-grained
 * split StayWhile has no evidence for) is deliberate: `CONFIRMED` is already
 * in the dashboard's own `activeStatuses` set (dashboard.service.ts), so
 * real arrivals/departures/occupancy work correctly with zero dashboard
 * changes. Any OTHER status string OwnerRez might someday return is
 * deliberately NOT guessed at — the booking is skipped and reported
 * (`unrecognizedStatus`), never silently coerced into a StayWhile status
 * that OwnerRez never actually claimed.
 */
export type MappedOwnerRezStatus =
  | { recognized: true; status: "CONFIRMED"; cancelledAt: null }
  | { recognized: true; status: "CANCELLED"; cancelledAt: Date }
  | { recognized: false };

export function mapOwnerRezBookingStatus(
  booking: Pick<OwnerrezBooking, "status" | "updated_utc">,
): MappedOwnerRezStatus {
  if (booking.status === "active") {
    return { recognized: true, status: "CONFIRMED", cancelledAt: null };
  }
  if (booking.status === "canceled") {
    return {
      recognized: true,
      status: "CANCELLED",
      cancelledAt: new Date(booking.updated_utc),
    };
  }
  return { recognized: false };
}

export interface OwnerRezReservationSyncItem {
  ownerRezBookingId: number;
  ownerRezPropertyId: number;
  propertyName: string | null;
  status: string;
  arrival: string;
  departure: string;
}

export interface OwnerRezReservationSyncPlan {
  totalFetched: number;
  toCreate: OwnerRezReservationSyncItem[];
  toUpdate: OwnerRezReservationSyncItem[];
  unmatchedProperty: OwnerRezReservationSyncItem[];
  unrecognizedStatus: OwnerRezReservationSyncItem[];
}

export type OwnerRezReservationPreviewResult =
  | { configured: false }
  | { configured: true; plan: OwnerRezReservationSyncPlan }
  | { configured: true; error: string };

function toSyncItem(
  booking: OwnerrezBooking,
  propertyName: string | null,
): OwnerRezReservationSyncItem {
  return {
    ownerRezBookingId: booking.id,
    ownerRezPropertyId: booking.property_id,
    propertyName,
    status: booking.status,
    arrival: booking.arrival,
    departure: booking.departure,
  };
}

/**
 * Read-only: fetches real OwnerRez bookings and real StayWhile
 * property-mapping data, classifies every booking into
 * create/update/unmatched-property/unrecognized-status, and does the exact
 * same `Reservation` lookup-by-unique-key the real write path uses — but
 * never writes anything. This is the preview the first real Production sync
 * must be approved against.
 */
export async function previewOwnerRezReservationSync(
  actor: AuthContext,
): Promise<OwnerRezReservationPreviewResult> {
  await assertPermission(actor, "reservations:read");

  const credentials = getOwnerRezCredentials();
  if (!credentials) return { configured: false };

  try {
    const client = new OwnerrezClient(credentials);
    const [bookings, properties] = await Promise.all([
      client.listBookings(),
      prisma.property.findMany({
        where: { deletedAt: null, ownerRezPropertyId: { not: null } },
        select: { id: true, name: true, ownerRezPropertyId: true },
      }),
    ]);

    const propertyByOwnerRezId = new Map(
      properties.map((p) => [p.ownerRezPropertyId as string, p] as const),
    );

    const existingReservations = await prisma.reservation.findMany({
      where: {
        source: "OWNERREZ",
        externalReservationId: { in: bookings.map((b) => String(b.id)) },
      },
      select: { externalReservationId: true },
    });
    const existingIds = new Set(
      existingReservations.map((r) => r.externalReservationId),
    );

    const plan: OwnerRezReservationSyncPlan = {
      totalFetched: bookings.length,
      toCreate: [],
      toUpdate: [],
      unmatchedProperty: [],
      unrecognizedStatus: [],
    };

    for (const booking of bookings) {
      const property = propertyByOwnerRezId.get(String(booking.property_id));
      const mapped = mapOwnerRezBookingStatus(booking);

      if (!property) {
        plan.unmatchedProperty.push(toSyncItem(booking, null));
        continue;
      }
      if (!mapped.recognized) {
        plan.unrecognizedStatus.push(toSyncItem(booking, property.name));
        continue;
      }

      const item = toSyncItem(booking, property.name);
      if (existingIds.has(String(booking.id))) {
        plan.toUpdate.push(item);
      } else {
        plan.toCreate.push(item);
      }
    }

    return { configured: true, plan };
  } catch (err) {
    return {
      configured: true,
      error: err instanceof Error ? err.message : "OwnerRez request failed.",
    };
  }
}

export interface OwnerRezReservationSyncResult {
  created: number;
  updated: number;
  unmatchedProperty: OwnerRezReservationSyncItem[];
  unrecognizedStatus: OwnerRezReservationSyncItem[];
  guestErrors: Array<{ ownerRezBookingId: number; reason: string }>;
}

export type OwnerRezReservationSyncOutcome =
  | ({ status: "completed" } & OwnerRezReservationSyncResult)
  | { status: "already_running" }
  | { status: "failed"; reason: string };

const INTEGRATION_SYNC_LOCK_NAME = "integration_sync";
// Bounded concurrency for per-guest detail fetches — same discipline as
// AUGUST_DETAIL_CONCURRENCY (provider-devices.service.ts): OwnerRez's own
// per-booking data has no guest name, only a guest_id, so a first-sight
// guest needs one real GET /guests/{id}. Capped and batched to avoid the
// exact kind of connection-pool exhaustion that constant already guards
// against for August.
const GUEST_DETAIL_CONCURRENCY = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Resolves every distinct OwnerRez guest_id appearing in `bookings` to a
 * real StayWhile Guest id — reusing an existing `Guest.ownerRezGuestId`
 * match when one exists, otherwise fetching that guest's real name/email
 * from OwnerRez (never fabricated) and creating exactly one new Guest row
 * for it. A guest OwnerRez itself can't return (404, deleted) is reported
 * per-booking in `guestErrors`, never silently defaulted to a placeholder
 * name.
 */
async function resolveGuestIds(
  client: OwnerrezClient,
  bookings: OwnerrezBooking[],
): Promise<{
  guestIdByOwnerRezId: Map<number, string>;
  errors: Array<{ ownerRezGuestId: number; reason: string }>;
}> {
  const distinctOwnerRezGuestIds = [
    ...new Set(bookings.map((b) => b.guest_id)),
  ];
  const existingGuests = await prisma.guest.findMany({
    where: {
      ownerRezGuestId: { in: distinctOwnerRezGuestIds.map(String) },
    },
    select: { id: true, ownerRezGuestId: true },
  });

  const guestIdByOwnerRezId = new Map<number, string>();
  for (const g of existingGuests) {
    guestIdByOwnerRezId.set(Number(g.ownerRezGuestId), g.id);
  }

  const missingOwnerRezIds = distinctOwnerRezGuestIds.filter(
    (id) => !guestIdByOwnerRezId.has(id),
  );
  const errors: Array<{ ownerRezGuestId: number; reason: string }> = [];

  for (const batch of chunk(missingOwnerRezIds, GUEST_DETAIL_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      batch.map(async (ownerRezGuestId) => ({
        ownerRezGuestId,
        guest: await client.getGuest(ownerRezGuestId),
      })),
    );
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : "OwnerRez guest lookup failed.";
        logOwnerRezReservationSync("guest_lookup_failed", { reason });
        continue;
      }
      const { ownerRezGuestId, guest } = outcome.value;
      try {
        const created = await prisma.guest.upsert({
          where: { ownerRezGuestId: String(ownerRezGuestId) },
          update: {},
          create: {
            firstName: guest.first_name,
            lastName: guest.last_name,
            email: guest.email ?? undefined,
            phone: guest.phone ?? undefined,
            ownerRezGuestId: String(ownerRezGuestId),
          },
        });
        guestIdByOwnerRezId.set(ownerRezGuestId, created.id);
      } catch (err) {
        errors.push({
          ownerRezGuestId,
          reason: err instanceof Error ? err.message : "Guest upsert failed.",
        });
      }
    }
  }

  return { guestIdByOwnerRezId, errors };
}

/**
 * The real, guarded write path — same advisory-lock + IntegrationSyncLog
 * mutual-exclusion mechanism already proven for August
 * (lock-refresh.service.ts's runGuardedAugustTelemetryRefresh), scoped to
 * the OWNERREZ IntegrationConnection row and entityType "Reservation" so it
 * can never collide with an August/Nest/Cielo sync, and a second OwnerRez
 * sync (manual double-click, or overlapping automatic+manual in the
 * future) can never run concurrently with this one.
 *
 * Never touches CleaningSchedule — see this file's own README/HANDOFF note:
 * no established business rule exists yet for auto-generating a cleaning
 * from a reservation (exact date/time, same-day-turnover handling,
 * assigned cleaner, exceptions are all open questions), so this
 * deliberately stops at Reservation/Guest, exactly per explicit
 * instruction not to invent that rule.
 */
export async function syncOwnerRezReservations(
  actor: AuthContext,
): Promise<OwnerRezReservationSyncOutcome> {
  await assertPermission(actor, "reservations:update");

  const credentials = getOwnerRezCredentials();
  if (!credentials) {
    return { status: "failed", reason: "OwnerRez isn't configured." };
  }

  await ensureConnectionRows();
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider: "OWNERREZ" },
  });

  const claim = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext(${INTEGRATION_SYNC_LOCK_NAME}), hashtext(${connection.id})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      return { proceeding: false } as const;
    }

    const existingRunning = await tx.integrationSyncLog.findFirst({
      where: { integrationConnectionId: connection.id, status: "RUNNING" },
    });
    if (existingRunning) {
      const ageMs = Date.now() - existingRunning.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        return { proceeding: false } as const;
      }
      await tx.integrationSyncLog.update({
        where: { id: existingRunning.id },
        data: {
          status: "FAILED",
          errorMessage:
            "OwnerRez reservation sync timed out or the process terminated unexpectedly.",
          finishedAt: new Date(),
        },
      });
    }

    const log = await tx.integrationSyncLog.create({
      data: {
        integrationConnectionId: connection.id,
        direction: "INBOUND",
        entityType: "Reservation",
        status: "RUNNING",
      },
    });
    return { proceeding: true, logId: log.id } as const;
  });

  if (!claim.proceeding) {
    logOwnerRezReservationSync("sync_skipped_already_running", {});
    return { status: "already_running" };
  }

  try {
    const client = new OwnerrezClient(credentials);
    const bookings = await client.listBookings();

    const properties = await prisma.property.findMany({
      where: { deletedAt: null, ownerRezPropertyId: { not: null } },
      select: { id: true, name: true, ownerRezPropertyId: true },
    });
    const propertyByOwnerRezId = new Map(
      properties.map((p) => [p.ownerRezPropertyId as string, p] as const),
    );

    const { guestIdByOwnerRezId, errors: guestUpsertErrors } =
      await resolveGuestIds(client, bookings);

    const result: OwnerRezReservationSyncResult = {
      created: 0,
      updated: 0,
      unmatchedProperty: [],
      unrecognizedStatus: [],
      guestErrors: guestUpsertErrors.map((e) => ({
        ownerRezBookingId: -1,
        reason: `Guest ${e.ownerRezGuestId}: ${e.reason}`,
      })),
    };

    for (const booking of bookings) {
      const property = propertyByOwnerRezId.get(String(booking.property_id));
      if (!property) {
        result.unmatchedProperty.push(toSyncItem(booking, null));
        continue;
      }

      const mapped = mapOwnerRezBookingStatus(booking);
      if (!mapped.recognized) {
        result.unrecognizedStatus.push(toSyncItem(booking, property.name));
        continue;
      }

      const guestId = guestIdByOwnerRezId.get(booking.guest_id);
      if (!guestId) {
        result.guestErrors.push({
          ownerRezBookingId: booking.id,
          reason: `Guest ${booking.guest_id} could not be resolved — reservation skipped.`,
        });
        continue;
      }

      const existing = await prisma.reservation.findUnique({
        where: {
          source_externalReservationId: {
            source: "OWNERREZ",
            externalReservationId: String(booking.id),
          },
        },
        select: { id: true },
      });

      const data: Prisma.ReservationUncheckedCreateInput = {
        propertyId: property.id,
        primaryGuestId: guestId,
        source: "OWNERREZ",
        externalReservationId: String(booking.id),
        status: mapped.status,
        checkInDate: new Date(booking.arrival),
        checkOutDate: new Date(booking.departure),
        adults: booking.guests_adults,
        children: booking.guests_children,
        pets: booking.guests_pets,
        totalAmount: booking.total_amount ?? 0,
        cancelledAt: mapped.cancelledAt,
      };

      await prisma.$transaction(async (tx) => {
        const reservation = existing
          ? await tx.reservation.update({ where: { id: existing.id }, data })
          : await tx.reservation.create({ data });

        await tx.reservationGuest.upsert({
          where: {
            reservationId_guestId: {
              reservationId: reservation.id,
              guestId,
            },
          },
          update: {},
          create: { reservationId: reservation.id, guestId, isPrimary: true },
        });

        return reservation;
      });

      if (existing) result.updated++;
      else result.created++;
    }

    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: {
        status: "SUCCEEDED",
        recordsProcessed: result.created + result.updated,
        finishedAt: new Date(),
      },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "CONNECTED", lastSyncedAt: new Date() },
    });

    await recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "reservation.ownerrez_synced",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      afterState: {
        created: result.created,
        updated: result.updated,
        unmatchedPropertyCount: result.unmatchedProperty.length,
        unrecognizedStatusCount: result.unrecognizedStatus.length,
        guestErrorCount: result.guestErrors.length,
      },
    });

    logOwnerRezReservationSync("sync_completed", {
      created: result.created,
      updated: result.updated,
      unmatchedProperty: result.unmatchedProperty.length,
      unrecognizedStatus: result.unrecognizedStatus.length,
      guestErrors: result.guestErrors.length,
    });

    return { status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: { status: "FAILED", errorMessage: message, finishedAt: new Date() },
    });
    logOwnerRezReservationSync("sync_failed", { error: message });
    return { status: "failed", reason: message };
  }
}
