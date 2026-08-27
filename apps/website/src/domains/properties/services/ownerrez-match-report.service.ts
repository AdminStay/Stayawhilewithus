import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";
import {
  OwnerrezClient,
  type OwnerrezProperty,
} from "@stayw/integrations/ownerrez";

/** Exported for reuse by ownerrez-onboarding.service.ts — same credential source, no behavior change. */
export function getOwnerRezCredentials(): {
  username: string;
  token: string;
} | null {
  const username = process.env.OWNERREZ_USERNAME;
  const token = process.env.OWNERREZ_API_TOKEN;
  if (!username || !token) return null;
  return { username, token };
}

/**
 * Deliberately narrow — exactly the four StayWhile Property fields the
 * match report actually needs, never the full Prisma Property row. Keeps
 * this read-only preview independent of future schema additions (a new
 * column elsewhere on Property can't accidentally leak into this UI) and
 * makes the Prisma query itself select only these columns, not every
 * scalar field.
 */
export interface StayWhilePropertySummary {
  id: string;
  name: string;
  internalCode: string;
  ownerRezPropertyId: string | null;
}

export interface OwnerRezMatchReport {
  alreadyLinked: Array<{
    property: StayWhilePropertySummary;
    ownerRezProperty: OwnerrezProperty;
  }>;
  proposedMatches: Array<{
    property: StayWhilePropertySummary;
    ownerRezProperty: OwnerrezProperty;
  }>;
  unmatchedOwnerRez: OwnerrezProperty[];
  unmatchedStayWhile: StayWhilePropertySummary[];
}

/**
 * `configured: false` means OWNERREZ_USERNAME/OWNERREZ_API_TOKEN simply
 * aren't set — a normal, expected state, not an error the page should crash
 * on.
 */
export type OwnerRezMatchReportResult =
  { configured: false } | { configured: true; report: OwnerRezMatchReport };

/**
 * Read-only Production preview: fetches OwnerRez's real, fully-paginated
 * property list (packages/integrations/src/ownerrez/client.ts's
 * listProperties() — active AND inactive, no truncation) and buckets it
 * against StayWhile's existing Property rows. Never writes anything, never
 * links or creates anything automatically. Strict match order:
 *
 *   1. ownerRezPropertyId exact match -> alreadyLinked
 *   2. internal_code === StayWhile internalCode, only for a StayWhile
 *      property not already linked to a different OwnerRez property ->
 *      proposedMatches (reported for human review only — this function
 *      never links or writes anything itself)
 *   3. everything else -> unmatched on whichever side it's missing from
 *
 * No name-based matching anywhere, no fuzzy matching — internalCode is
 * StayWhile's own stable identifier, chosen specifically because a display
 * name can change. This is deliberately a narrower read-only-only module
 * than a full property-sync service: it contains no field-change preview,
 * no confirm/create/apply functions, and no write path of any kind — that
 * capability is a separate, not-yet-approved phase.
 */
export async function matchOwnerRezProperties(
  actor: AuthContext,
): Promise<OwnerRezMatchReportResult> {
  await assertPermission(actor, "properties:read");

  const credentials = getOwnerRezCredentials();
  if (!credentials) {
    return { configured: false };
  }

  const [ownerRezProperties, stayWhileProperties] = await Promise.all([
    new OwnerrezClient(credentials).listProperties(),
    prisma.property.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        internalCode: true,
        ownerRezPropertyId: true,
      },
    }),
  ]);

  const stayWhileById = new Map(
    stayWhileProperties
      .filter((p) => p.ownerRezPropertyId)
      .map((p) => [p.ownerRezPropertyId as string, p] as const),
  );
  const stayWhileByCode = new Map(
    stayWhileProperties.map((p) => [p.internalCode.toUpperCase(), p] as const),
  );

  const alreadyLinked: OwnerRezMatchReport["alreadyLinked"] = [];
  const proposedMatches: OwnerRezMatchReport["proposedMatches"] = [];
  const unmatchedOwnerRez: OwnerrezProperty[] = [];
  const matchedStayWhileIds = new Set<string>();

  for (const ownerRezProperty of ownerRezProperties) {
    const linked = stayWhileById.get(String(ownerRezProperty.id));
    if (linked) {
      alreadyLinked.push({ property: linked, ownerRezProperty });
      matchedStayWhileIds.add(linked.id);
      continue;
    }

    const code = ownerRezProperty.internal_code?.toUpperCase();
    const candidate = code ? stayWhileByCode.get(code) : undefined;
    if (candidate && !candidate.ownerRezPropertyId) {
      proposedMatches.push({ property: candidate, ownerRezProperty });
      matchedStayWhileIds.add(candidate.id);
      continue;
    }

    unmatchedOwnerRez.push(ownerRezProperty);
  }

  const unmatchedStayWhile = stayWhileProperties.filter(
    (p) => !matchedStayWhileIds.has(p.id) && !p.ownerRezPropertyId,
  );

  return {
    configured: true,
    report: {
      alreadyLinked,
      proposedMatches,
      unmatchedOwnerRez,
      unmatchedStayWhile,
    },
  };
}
