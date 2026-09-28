import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  OwnerrezClient,
  OwnerrezRequestBudgetError,
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
    const client = new OwnerrezClient(credentials, {
      requestBudget: OWNERREZ_RUN_REQUEST_BUDGET,
    });
    // 2026-09-27: operational retrieval (recent changes ∪ every stay
    // departing yesterday or later) — see OwnerrezClient
    // .listOperationalBookings(). A bare listBookings() only returned
    // bookings created/changed in the last 90 days.
    const [{ bookings, stats }, properties] = await Promise.all([
      client.listOperationalBookings(),
      prisma.property.findMany({
        where: { deletedAt: null, ownerRezPropertyId: { not: null } },
        select: { id: true, name: true, ownerRezPropertyId: true },
      }),
    ]);

    logOwnerRezReservationSync("preview_bookings_retrieved", stats);
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
  /**
   * Bookings not written this run because their guest couldn't be looked
   * up before the per-run OwnerRez request budget ran out (or OwnerRez
   * answered 429). Nothing is fabricated; a later run picks them up.
   */
  guestDeferred: Array<{ ownerRezBookingId: number; reason: string }>;
  /** When a follow-up run may start (set only when something was deferred). */
  deferredUntil: string | null;
}

export type OwnerRezReservationSyncOutcome =
  | ({ status: "completed" } & OwnerRezReservationSyncResult)
  | { status: "already_running" }
  | { status: "cooldown"; cooldownUntil: string }
  | { status: "failed"; reason: string };

/**
 * OwnerRez rate-limit safety (2026-09-28). OwnerRez documents 300 requests
 * per 5 minutes. Each preview/sync run gets its own client with a hard
 * request budget below that (headroom for concurrent dashboard reads), no
 * sleeps and no retries: when the budget is used up — or OwnerRez answers
 * 429 — the remaining guest lookups are deferred, the run is logged
 * PARTIAL with the marker below, and a new sync is refused until the
 * 5-minute window has passed. Guests already created are reused on the
 * next run, so repeated runs converge without duplicates.
 */
export const OWNERREZ_RUN_REQUEST_BUDGET = 200;
export const OWNERREZ_RATE_WINDOW_MS = 5 * 60 * 1000;
export const OWNERREZ_DEFERRED_MARKER = "OWNERREZ_DEFERRED";

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
  now: Date = new Date(),
): Promise<{
  guestIdByOwnerRezId: Map<number, string>;
  errors: Array<{ ownerRezGuestId: number; reason: string }>;
  deferredGuestIds: Set<number>;
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

  // Operationally urgent guests first (2026-09-28): anyone with a stay
  // departing today or later, soonest arrival first; then everyone else,
  // most recent stay first. If the request budget runs out, what's left
  // over is the least urgent.
  const priority = new Map<number, [number, number]>();
  const nowMs = now.getTime();
  for (const b of bookings) {
    const departs = Date.parse(b.departure);
    const arrives = Date.parse(b.arrival);
    const key: [number, number] =
      departs >= nowMs - 24 * 60 * 60 * 1000 ? [0, arrives] : [1, -departs];
    const current = priority.get(b.guest_id);
    if (
      !current ||
      key[0] < current[0] ||
      (key[0] === current[0] && key[1] < current[1])
    ) {
      priority.set(b.guest_id, key);
    }
  }
  const missingOwnerRezIds = distinctOwnerRezGuestIds
    .filter((id) => !guestIdByOwnerRezId.has(id))
    .sort((a, b) => {
      const ka = priority.get(a) ?? [2, 0];
      const kb = priority.get(b) ?? [2, 0];
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  const errors: Array<{ ownerRezGuestId: number; reason: string }> = [];
  const deferredGuestIds = new Set<number>();

  for (const batch of chunk(missingOwnerRezIds, GUEST_DETAIL_CONCURRENCY)) {
    if (deferredGuestIds.size > 0) {
      // Budget or rate limit already hit: send nothing more this run.
      for (const id of batch) deferredGuestIds.add(id);
      continue;
    }
    const settled = await Promise.allSettled(
      batch.map(async (ownerRezGuestId) => ({
        ownerRezGuestId,
        guest: await client.getGuest(ownerRezGuestId),
      })),
    );
    settled.forEach((outcome, index) => {
      if (
        outcome.status === "rejected" &&
        outcome.reason instanceof OwnerrezRequestBudgetError
      ) {
        deferredGuestIds.add(batch[index]!);
      }
    });
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        if (outcome.reason instanceof OwnerrezRequestBudgetError) continue;
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

  return { guestIdByOwnerRezId, errors, deferredGuestIds };
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

    // Rate-limit cooldown: a run that deferred work (or hit OwnerRez's
    // limit) blocks the next one until OwnerRez's 5-minute window passes.
    const deferred = await tx.integrationSyncLog.findFirst({
      where: {
        integrationConnectionId: connection.id,
        entityType: "Reservation",
        errorMessage: { startsWith: OWNERREZ_DEFERRED_MARKER },
        finishedAt: { gte: new Date(Date.now() - OWNERREZ_RATE_WINDOW_MS) },
      },
      orderBy: { finishedAt: "desc" },
    });
    if (deferred?.finishedAt) {
      return {
        proceeding: false,
        cooldownUntil: new Date(
          deferred.finishedAt.getTime() + OWNERREZ_RATE_WINDOW_MS,
        ).toISOString(),
      } as const;
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
    if ("cooldownUntil" in claim && claim.cooldownUntil) {
      logOwnerRezReservationSync("sync_skipped_cooldown", {
        cooldownUntil: claim.cooldownUntil,
      });
      return { status: "cooldown", cooldownUntil: claim.cooldownUntil };
    }
    logOwnerRezReservationSync("sync_skipped_already_running", {});
    return { status: "already_running" };
  }

  try {
    const client = new OwnerrezClient(credentials, {
      requestBudget: OWNERREZ_RUN_REQUEST_BUDGET,
    });
    const { bookings, stats } = await client.listOperationalBookings();
    logOwnerRezReservationSync("sync_bookings_retrieved", stats);

    const properties = await prisma.property.findMany({
      where: { deletedAt: null, ownerRezPropertyId: { not: null } },
      select: { id: true, name: true, ownerRezPropertyId: true },
    });
    const propertyByOwnerRezId = new Map(
      properties.map((p) => [p.ownerRezPropertyId as string, p] as const),
    );

    // Only bookings this run will actually write need a guest lookup —
    // unmatched-property / unrecognized-status bookings are skipped anyway,
    // so fetching their guests would only spend OwnerRez's rate limit.
    const writableBookings = bookings.filter(
      (b) =>
        propertyByOwnerRezId.has(String(b.property_id)) &&
        mapOwnerRezBookingStatus(b).recognized,
    );
    const {
      guestIdByOwnerRezId,
      errors: guestUpsertErrors,
      deferredGuestIds,
    } = await resolveGuestIds(client, writableBookings);

    const result: OwnerRezReservationSyncResult = {
      created: 0,
      updated: 0,
      unmatchedProperty: [],
      unrecognizedStatus: [],
      guestErrors: guestUpsertErrors.map((e) => ({
        ownerRezBookingId: -1,
        reason: `Guest ${e.ownerRezGuestId}: ${e.reason}`,
      })),
      guestDeferred: [],
      deferredUntil: null,
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
      if (!guestId && deferredGuestIds.has(booking.guest_id)) {
        result.guestDeferred.push({
          ownerRezBookingId: booking.id,
          reason: `Guest ${booking.guest_id} not looked up yet (OwnerRez request limit for this run) — deferred to the next sync.`,
        });
        continue;
      }
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

    const finishedAt = new Date();
    const partial = result.guestDeferred.length > 0;
    if (partial) {
      result.deferredUntil = new Date(
        finishedAt.getTime() + OWNERREZ_RATE_WINDOW_MS,
      ).toISOString();
    }
    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: {
        status: partial ? "PARTIAL" : "SUCCEEDED",
        recordsProcessed: result.created + result.updated,
        errorMessage: partial
          ? `${OWNERREZ_DEFERRED_MARKER}: ${result.guestDeferred.length} booking(s) deferred (OwnerRez request limit); run the sync again after ${result.deferredUntil}.`
          : null,
        finishedAt,
      },
    });
    if (!partial) {
      // lastSyncedAt means "last complete sync" — a partial run doesn't bump it.
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { status: "CONNECTED", lastSyncedAt: finishedAt },
      });
    }

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
        guestDeferredCount: result.guestDeferred.length,
        ownerRezRequestCount: client.usage.requestsMade,
      },
    });

    logOwnerRezReservationSync("sync_completed", {
      created: result.created,
      updated: result.updated,
      unmatchedProperty: result.unmatchedProperty.length,
      unrecognizedStatus: result.unrecognizedStatus.length,
      guestErrors: result.guestErrors.length,
      guestDeferred: result.guestDeferred.length,
      ownerRezRequests: client.usage.requestsMade,
      rateLimited: client.usage.rateLimited,
    });

    return { status: "completed", ...result };
  } catch (err) {
    // A budget/rate-limit stop while fetching bookings still starts the
    // cooldown (marker), so nobody immediately re-runs into the limit.
    const message =
      err instanceof OwnerrezRequestBudgetError
        ? `${OWNERREZ_DEFERRED_MARKER}: ${err.message} Nothing was written; run the sync again after 5 minutes.`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: { status: "FAILED", errorMessage: message, finishedAt: new Date() },
    });
    logOwnerRezReservationSync("sync_failed", { error: message });
    return { status: "failed", reason: message };
  }
}
