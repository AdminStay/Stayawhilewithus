import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma, type Property } from "@stayw/database";
import {
  OwnerrezClient,
  type OwnerrezProperty,
} from "@stayw/integrations/ownerrez";

import {
  confirmOwnerRezPropertyMatchSchema,
  type ConfirmOwnerRezPropertyMatchInput,
} from "../schemas/ownerrez-match.schema";

import { recordAudit } from "@/platform/audit/record-audit";

function getOwnerRezCredentials(): { username: string; token: string } | null {
  const username = process.env.OWNERREZ_USERNAME;
  const token = process.env.OWNERREZ_API_TOKEN;
  if (!username || !token) return null;
  return { username, token };
}

export interface OwnerRezMatchReport {
  alreadyLinked: Array<{
    property: Property;
    ownerRezProperty: OwnerrezProperty;
  }>;
  proposedMatches: Array<{
    property: Property;
    ownerRezProperty: OwnerrezProperty;
  }>;
  unmatchedOwnerRez: OwnerrezProperty[];
  unmatchedStayWhile: Property[];
}

/**
 * `configured: false` means OWNERREZ_USERNAME/OWNERREZ_API_TOKEN simply
 * aren't set — a normal, expected state (matches the IntegrationHighlights
 * pattern in integrations.service.ts), not an error the page should crash
 * on.
 */
export type OwnerRezMatchReportResult =
  { configured: false } | { configured: true; report: OwnerRezMatchReport };

/**
 * Read-only: fetches OwnerRez's real, live property list (cheap — the list
 * endpoint, not per-property detail calls) and buckets it against
 * StayWhile's existing Property rows. Never writes anything, never links
 * anything automatically. Strict match order, per the approved design in
 * HANDOFF.md ("OwnerRez — expanded architecture detail"):
 *
 *   1. ownerRezPropertyId exact match -> alreadyLinked
 *   2. internalCode === OwnerRez internal_code, only for a StayWhile
 *      property not already linked to a different OwnerRez property ->
 *      proposedMatches (reported for human confirmation only)
 *   3. everything else -> unmatched on whichever side it's missing from
 *
 * No name-based matching anywhere — internalCode is StayWhile's own stable
 * identifier, chosen specifically because a display name can change.
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
    prisma.property.findMany({ where: { deletedAt: null } }),
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

/**
 * Explicit, human-confirmed link only — never inferred/auto-applied from
 * matchOwnerRezProperties()'s proposedMatches. Guards against relinking an
 * already-linked property and against double-linking the same OwnerRez
 * property to two StayWhile rows (the DB's own @unique on
 * ownerRezPropertyId would also catch the latter, but this gives a clear
 * error instead of a raw constraint violation).
 */
export async function confirmOwnerRezPropertyMatch(
  actor: AuthContext,
  rawInput: ConfirmOwnerRezPropertyMatchInput,
): Promise<Property> {
  await assertPermission(actor, "properties:update");
  const input = confirmOwnerRezPropertyMatchSchema.parse(rawInput);

  const property = await prisma.property.findUnique({
    where: { id: input.propertyId },
  });
  if (!property || property.deletedAt) {
    throw new Error("Property not found.");
  }
  if (property.ownerRezPropertyId) {
    throw new Error("This property is already linked to an OwnerRez property.");
  }

  const existingLink = await prisma.property.findUnique({
    where: { ownerRezPropertyId: input.ownerRezPropertyId },
  });
  if (existingLink) {
    throw new Error(
      "This OwnerRez property is already linked to a different StayWhile property.",
    );
  }

  const updated = await prisma.property.update({
    where: { id: input.propertyId },
    data: { ownerRezPropertyId: input.ownerRezPropertyId },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.ownerrez_matched",
    entityType: "Property",
    entityId: updated.id,
    afterState: updated,
  });

  return updated;
}

export interface OwnerRezSyncResult {
  synced: number;
  skipped: Array<{ propertyId: string; reason: string }>;
}

/**
 * OwnerRez-owned field pass for already-confirmed-linked properties only
 * (Property.ownerRezPropertyId set) — one getProperty(id) detail call per
 * linked property, since the list endpoint doesn't carry these fields.
 * Field-ownership policy (HANDOFF.md, "OwnerRez — revised field-ownership
 * policy"): a field is only overwritten when this specific pull actually
 * returned a non-null value for it — absence in a pull leaves the existing
 * StayWhile value untouched, never nulled. Never touches id/internalCode/
 * status/deletedAt — those stay StayWhile/admin-owned.
 *
 * `propertyType` is deliberately NOT synced here — no human-approved
 * mapping from OwnerRez's `property_type` strings to StayWhile's
 * `PropertyType` enum exists yet; forcing one would risk silently
 * mis-typing an existing property. A future pass can add that once a real
 * mapping is confirmed, per the standing "no guessed mappings" rule.
 *
 * `ownerRezActive`/`ownerRezLastSeenAt` are always written on a successful
 * pull — this is OwnerRez's own provider signal, deliberately separate from
 * `status` (PropertyStatus). Nothing here ever changes `status`.
 */
export async function syncLinkedOwnerRezProperties(
  actor: AuthContext,
): Promise<OwnerRezSyncResult> {
  await assertPermission(actor, "properties:update");

  const credentials = getOwnerRezCredentials();
  if (!credentials) {
    throw new Error(
      "OwnerRez isn't configured — set OWNERREZ_USERNAME/OWNERREZ_API_TOKEN.",
    );
  }

  const linkedProperties = await prisma.property.findMany({
    where: { deletedAt: null, ownerRezPropertyId: { not: null } },
  });

  const client = new OwnerrezClient(credentials);
  const skipped: OwnerRezSyncResult["skipped"] = [];
  let synced = 0;

  for (const property of linkedProperties) {
    const ownerRezId = Number(property.ownerRezPropertyId);
    if (!Number.isFinite(ownerRezId)) {
      skipped.push({
        propertyId: property.id,
        reason: "ownerRezPropertyId is not a valid OwnerRez id.",
      });
      continue;
    }

    let ownerRezProperty: OwnerrezProperty;
    try {
      ownerRezProperty = await client.getProperty(ownerRezId);
    } catch (err) {
      skipped.push({
        propertyId: property.id,
        reason: err instanceof Error ? err.message : "OwnerRez request failed.",
      });
      continue;
    }

    const bathroomCount =
      ownerRezProperty.bathrooms_full != null ||
      ownerRezProperty.bathrooms_half != null
        ? (ownerRezProperty.bathrooms_full ?? 0) +
          (ownerRezProperty.bathrooms_half ?? 0) * 0.5
        : undefined;

    const data: Prisma.PropertyUpdateInput = {
      ...(ownerRezProperty.name != null && { name: ownerRezProperty.name }),
      ...(ownerRezProperty.address?.street1 != null && {
        addressLine1: ownerRezProperty.address.street1,
      }),
      ...(ownerRezProperty.address?.street2 != null && {
        addressLine2: ownerRezProperty.address.street2,
      }),
      ...(ownerRezProperty.address?.city != null && {
        city: ownerRezProperty.address.city,
      }),
      ...(ownerRezProperty.address?.state != null && {
        state: ownerRezProperty.address.state,
      }),
      ...(ownerRezProperty.address?.postal_code != null && {
        postalCode: ownerRezProperty.address.postal_code,
      }),
      ...(ownerRezProperty.address?.country != null && {
        country: ownerRezProperty.address.country,
      }),
      ...(ownerRezProperty.latitude != null && {
        latitude: ownerRezProperty.latitude,
      }),
      ...(ownerRezProperty.longitude != null && {
        longitude: ownerRezProperty.longitude,
      }),
      ...(ownerRezProperty.bedrooms != null && {
        bedroomCount: ownerRezProperty.bedrooms,
      }),
      ...(bathroomCount != null && { bathroomCount }),
      ...(ownerRezProperty.max_guests != null && {
        maxOccupancy: ownerRezProperty.max_guests,
      }),
      ownerRezActive: ownerRezProperty.active,
      ownerRezLastSeenAt: new Date(),
    };

    const updated = await prisma.property.update({
      where: { id: property.id },
      data,
    });

    await recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "property.ownerrez_synced",
      entityType: "Property",
      entityId: updated.id,
      afterState: updated,
    });

    synced += 1;
  }

  return { synced, skipped };
}
