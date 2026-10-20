import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";
import {
  OwnerrezClient,
  OwnerrezRequestBudgetError,
} from "@stayw/integrations/ownerrez";

import { getOwnerRezCredentials } from "./ownerrez-match-report.service";

import { recordAudit } from "@/platform/audit/record-audit";

/** Same bound as the comparison and onboarding detail reads. */
const DETAIL_CONCURRENCY = 5;

export const MAX_GUESTS_SYNC_AUDIT_ACTION =
  "property.max_occupancy_synced_from_ownerrez";

/**
 * - `updated`: OwnerRez's value differed; maxOccupancy now matches it.
 * - `unchanged`: already equal; nothing written.
 * - `skipped_blank`: OwnerRez has no max_guests (or not a whole number ≥ 1);
 *   StayWhile's value is kept as-is.
 * - `failed`: this property was actually requested (or its link id is
 *   invalid) and the read or the save failed — including OwnerRez answering
 *   it with HTTP 429; nothing written for it.
 * - `not_checked`: never requested, because an earlier HTTP 429 stopped the
 *   run; nothing written for it.
 * - `changed_during_sync`: OwnerRez differed, but the property changed in
 *   StayWhile (max guests, OwnerRez link, or deleted) after this run read
 *   it, so nothing was written and nothing audited.
 */
export type MaxGuestsSyncOutcome =
  | "updated"
  | "unchanged"
  | "skipped_blank"
  | "failed"
  | "not_checked"
  | "changed_during_sync";

export const MAX_GUESTS_SYNC_OUTCOMES: readonly MaxGuestsSyncOutcome[] = [
  "updated",
  "unchanged",
  "skipped_blank",
  "failed",
  "not_checked",
  "changed_during_sync",
];

export type MaxGuestsSyncFailureReason =
  "invalid_link_id" | "rate_limited" | "request_failed" | "update_failed";

export interface MaxGuestsSyncPropertyResult {
  propertyId: string;
  propertyName: string;
  outcome: MaxGuestsSyncOutcome;
  /** StayWhile's maxOccupancy before this run. */
  before: number;
  /** The value this run left in place: equal to `before` unless updated. */
  after: number;
  /** OwnerRez's usable value, when one was read. */
  ownerRezValue?: number;
  reason?: MaxGuestsSyncFailureReason;
}

export type MaxGuestsSyncResult =
  | { configured: false }
  | {
      configured: true;
      results: MaxGuestsSyncPropertyResult[];
      counts: Record<MaxGuestsSyncOutcome, number>;
      /** True when OwnerRez answered HTTP 429; later properties weren't requested. */
      rateLimited: boolean;
    };

function parseOwnerRezId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** OwnerRez's max_guests, only when it's a usable occupancy (whole number ≥ 1). */
export function usableMaxGuests(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * OwnerRez → StayWhile maximum-guest sync (2026-10-21). Kenny's rule:
 * maximum guest count comes from OwnerRez, because it changes over time.
 * Manually triggered by an admin from /properties; gated by
 * `properties:update`.
 *
 * Scope is deliberately one field: for every non-deleted Property linked to
 * OwnerRez (exact `ownerRezPropertyId`), one `GET /properties/{id}`, then
 * OwnerRez `max_guests` → `Property.maxOccupancy` — the same mapping
 * createPropertyFromOwnerRez() uses at creation. Nothing else on the
 * Property is read from OwnerRez or written (no address, bedrooms,
 * bathrooms, timezone, status or link change), and nothing is ever written
 * back to OwnerRez.
 *
 * Never overwrites with a blank: a missing/invalid OwnerRez value, a failed
 * read, or an invalid link id leaves the property untouched. A property is
 * updated — and audited, with before/after — only when the value actually
 * differs. Reads run in batches of DETAIL_CONCURRENCY with a request budget
 * of one per property. Every request in a batch is sent together, so a
 * property in the batch that received HTTP 429 is `failed` (rate limited);
 * once a 429 is seen no further batch is requested, and those properties
 * are `not_checked` — never retried.
 *
 * Writes run one at a time after the reads, and one property's failure
 * never affects another's. Each save is conditional on the property being
 * exactly as this run read it (still undeleted, same OwnerRez link, same
 * maxOccupancy); otherwise it's `changed_during_sync`, with no write and
 * no audit entry, so a concurrent change is never overwritten and no audit
 * entry ever records a stale "before".
 */
export async function syncMaxGuestsFromOwnerRez(
  actor: AuthContext,
): Promise<MaxGuestsSyncResult> {
  await assertPermission(actor, "properties:update");

  const credentials = getOwnerRezCredentials();
  if (!credentials) return { configured: false };

  const properties = await prisma.property.findMany({
    where: { deletedAt: null, ownerRezPropertyId: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ownerRezPropertyId: true,
      maxOccupancy: true,
    },
  });

  const linked = properties.map((p) => ({
    property: p,
    ownerRezId: p.ownerRezPropertyId
      ? parseOwnerRezId(p.ownerRezPropertyId)
      : null,
  }));
  const requestable = linked.filter((l) => l.ownerRezId !== null);

  const client = new OwnerrezClient(credentials, {
    requestBudget: Math.max(requestable.length, 1),
  });
  const maxGuestsById = new Map<
    number,
    | { value: number | null }
    | { reason: MaxGuestsSyncFailureReason }
    | { notChecked: true }
  >();
  for (const batch of chunk(requestable, DETAIL_CONCURRENCY)) {
    // 429 breaker: nothing further is requested once OwnerRez has asked us
    // to slow down.
    if (client.usage.rateLimited) {
      for (const l of batch)
        maxGuestsById.set(l.ownerRezId!, { notChecked: true });
      continue;
    }
    const settled = await Promise.allSettled(
      batch.map((l) => client.getProperty(l.ownerRezId!)),
    );
    settled.forEach((result, i) => {
      maxGuestsById.set(
        batch[i]!.ownerRezId!,
        result.status === "fulfilled"
          ? { value: usableMaxGuests(result.value.max_guests) }
          : {
              reason:
                result.reason instanceof OwnerrezRequestBudgetError
                  ? "rate_limited"
                  : "request_failed",
            },
      );
    });
  }

  const results: MaxGuestsSyncPropertyResult[] = [];
  for (const { property: p, ownerRezId } of linked) {
    const base = {
      propertyId: p.id,
      propertyName: p.name,
      before: p.maxOccupancy,
      after: p.maxOccupancy,
    };
    const fetched =
      ownerRezId === null
        ? ({ reason: "invalid_link_id" } as const)
        : maxGuestsById.get(ownerRezId)!;

    if ("notChecked" in fetched) {
      results.push({ ...base, outcome: "not_checked" });
      continue;
    }
    if ("reason" in fetched) {
      results.push({ ...base, outcome: "failed", reason: fetched.reason });
      continue;
    }
    if (fetched.value === null) {
      results.push({ ...base, outcome: "skipped_blank" });
      continue;
    }
    if (fetched.value === p.maxOccupancy) {
      results.push({
        ...base,
        ownerRezValue: fetched.value,
        outcome: "unchanged",
      });
      continue;
    }

    const value = fetched.value;
    try {
      // Update + audit commit together, or neither does. The update only
      // matches the property exactly as read above; the audit is written
      // only when exactly that one row changed.
      const saved = await prisma.$transaction(async (tx) => {
        const { count } = await tx.property.updateMany({
          where: {
            id: p.id,
            deletedAt: null,
            ownerRezPropertyId: p.ownerRezPropertyId,
            maxOccupancy: p.maxOccupancy,
          },
          data: { maxOccupancy: value },
        });
        if (count === 0) return false;
        if (count !== 1) {
          // Unreachable (id is unique); roll back rather than audit it.
          throw new Error(`Unexpected update count ${count}`);
        }
        await recordAudit(
          {
            actorUserId: actor.userId,
            actorType: "USER",
            action: MAX_GUESTS_SYNC_AUDIT_ACTION,
            entityType: "Property",
            entityId: p.id,
            beforeState: { maxOccupancy: p.maxOccupancy },
            afterState: {
              maxOccupancy: value,
              ownerRezPropertyId: p.ownerRezPropertyId,
            },
          },
          tx,
        );
        return true;
      });
      results.push(
        saved
          ? { ...base, after: value, ownerRezValue: value, outcome: "updated" }
          : { ...base, ownerRezValue: value, outcome: "changed_during_sync" },
      );
    } catch {
      results.push({
        ...base,
        ownerRezValue: value,
        outcome: "failed",
        reason: "update_failed",
      });
    }
  }

  const counts = Object.fromEntries(
    MAX_GUESTS_SYNC_OUTCOMES.map((o) => [o, 0]),
  ) as Record<MaxGuestsSyncOutcome, number>;
  for (const r of results) counts[r.outcome]++;

  // Counts only — no property names or values in logs.
  console.log(
    "[ownerrez-max-guests-sync]",
    JSON.stringify({
      actorUserId: actor.userId,
      ...counts,
      rateLimited: client.usage.rateLimited,
    }),
  );

  return {
    configured: true,
    results,
    counts,
    rateLimited: client.usage.rateLimited,
  };
}
