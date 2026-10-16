import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import {
  OwnerrezClient,
  OwnerrezRequestBudgetError,
  type OwnerrezPropertyDetail,
} from "@stayw/integrations/ownerrez";

import {
  compareOwnerRezProperty,
  countComparisonStatuses,
  type OwnerRezPropertyComparisonRow,
  type OwnerRezUnavailableReason,
} from "../lib/ownerrez-property-comparison";

import { getOwnerRezCredentials } from "./ownerrez-match-report.service";

export type { OwnerRezPropertyComparisonRow, OwnerRezUnavailableReason };

/** Same bound as ownerrez-onboarding.service.ts's detail enrichment. */
const DETAIL_CONCURRENCY = 5;

/** `configured: false`: OwnerRez credentials aren't set — nothing was read or requested. */
export type OwnerRezPropertyComparisonResult =
  | { configured: false }
  | {
      configured: true;
      rows: OwnerRezPropertyComparisonRow[];
      /** True when OwnerRez answered HTTP 429 during this run. */
      rateLimited: boolean;
    };

function parseOwnerRezId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function unavailableReasonFor(err: unknown): OwnerRezUnavailableReason {
  if (err instanceof OwnerrezRequestBudgetError) return "rate_limited";
  if (err instanceof HttpRequestError && err.status === 404) return "not_found";
  return "request_failed";
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Read-only OwnerRez-versus-StayWhile comparison (2026-10-16) for every
 * non-deleted StayWhile Property linked to OwnerRez (exact
 * `Property.ownerRezPropertyId`, the same key the match report and Confirm
 * Link use — never a name or address match). Gated by `properties:read`.
 *
 * NO WRITE PATH: one `property.findMany` read, then one OwnerRez
 * `GET /properties/{id}` per linked property, in batches of
 * DETAIL_CONCURRENCY. No Property update, no IntegrationSyncLog row, no
 * audit row, no timestamp change, and nothing is logged — field values
 * stay on the page. The client's request budget is exactly one request per
 * linked property, and after an HTTP 429 the client refuses every further
 * request, so the remaining rows are shown as "OwnerRez data unavailable"
 * (rate limited) instead of being retried.
 */
export async function compareLinkedOwnerRezProperties(
  actor: AuthContext,
): Promise<OwnerRezPropertyComparisonResult> {
  await assertPermission(actor, "properties:read");

  const credentials = getOwnerRezCredentials();
  if (!credentials) return { configured: false };

  const properties = await prisma.property.findMany({
    where: { deletedAt: null, ownerRezPropertyId: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      internalCode: true,
      status: true,
      ownerRezPropertyId: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      bedroomCount: true,
      bathroomCount: true,
      maxOccupancy: true,
      timezone: true,
    },
  });

  const linked = properties.flatMap((p) =>
    p.ownerRezPropertyId
      ? [
          {
            property: p,
            ownerRezPropertyId: p.ownerRezPropertyId,
            ownerRezId: parseOwnerRezId(p.ownerRezPropertyId),
          },
        ]
      : [],
  );
  const requestable = linked.filter((l) => l.ownerRezId !== null);

  const client = new OwnerrezClient(credentials, {
    requestBudget: Math.max(requestable.length, 1),
  });
  const details = new Map<
    number,
    { detail: OwnerrezPropertyDetail } | { reason: OwnerRezUnavailableReason }
  >();
  for (const batch of chunk(requestable, DETAIL_CONCURRENCY)) {
    const results = await Promise.allSettled(
      batch.map((l) => client.getProperty(l.ownerRezId!)),
    );
    results.forEach((result, i) => {
      details.set(
        batch[i]!.ownerRezId!,
        result.status === "fulfilled"
          ? { detail: result.value }
          : { reason: unavailableReasonFor(result.reason) },
      );
    });
  }

  const rows = linked.map(({ property: p, ownerRezPropertyId, ownerRezId }) => {
    const outcome =
      ownerRezId === null
        ? ({ reason: "invalid_link_id" } as const)
        : details.get(ownerRezId)!;
    const detail = "detail" in outcome ? outcome.detail : null;
    const fields = compareOwnerRezProperty(
      {
        addressLine1: p.addressLine1,
        addressLine2: p.addressLine2,
        city: p.city,
        state: p.state,
        postalCode: p.postalCode,
        bedroomCount: p.bedroomCount,
        bathroomCount:
          p.bathroomCount === null ? null : Number(p.bathroomCount.toString()),
        maxOccupancy: p.maxOccupancy,
        timezone: p.timezone,
      },
      detail,
    );
    return {
      property: {
        id: p.id,
        name: p.name,
        internalCode: p.internalCode,
        status: p.status,
        ownerRezPropertyId,
      },
      ownerRezName: detail?.name ?? null,
      unavailableReason: "reason" in outcome ? outcome.reason : null,
      fields,
      counts: countComparisonStatuses(fields),
    };
  });

  return { configured: true, rows, rateLimited: client.usage.rateLimited };
}
