import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Property } from "@stayw/database";
import {
  OwnerrezClient,
  type OwnerrezProperty,
  type OwnerrezPropertyDetail,
} from "@stayw/integrations/ownerrez";

import {
  createPropertyFromOwnerRezSchema,
  type CreatePropertyFromOwnerRezInput,
} from "../schemas/ownerrez-onboarding.schema";

import { isUniqueConstraintViolation } from "./ownerrez-link.service";
import { getOwnerRezCredentials } from "./ownerrez-match-report.service";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Bounds how many OwnerRez detail (getProperty) requests run concurrently
 * when enriching the unmatched-properties report. Chosen for the same
 * reason discoverAugustDevices() bounds its own detail-call concurrency
 * (see provider-devices.service.ts) — one sequential call per property
 * would be the exact resource-contention shape that caused Production's
 * P2024/300s incident. This report is admin-only and occasional, but the
 * lesson still applies: never fan out unboundedly.
 */
const DETAIL_CONCURRENCY = 5;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface UnmatchedOwnerRezSummary {
  ownerRezProperty: OwnerrezProperty;
  /**
   * null when this property's detail was never fetched (inactive — see
   * below) or the fetch failed. A null detail means "Create" isn't offered
   * for this row — never partially create from an incomplete fetch.
   */
  detail: OwnerrezPropertyDetail | null;
}

export interface OwnerRezOnboardingReport {
  active: UnmatchedOwnerRezSummary[];
  /**
   * Detail is deliberately never fetched for inactive properties — this
   * testing milestone prioritizes active properties (per explicit
   * instruction), and skipping the detail call for the ~20 inactive ones
   * both keeps this report cheap and avoids offering a Create action for
   * listings OwnerRez itself has marked inactive.
   */
  inactive: UnmatchedOwnerRezSummary[];
}

/**
 * Enriches the OwnerRez-only bucket a caller already has (from
 * matchOwnerRezProperties()'s unmatchedOwnerRez — this function does not
 * re-fetch the property list itself, so a caller that already has a
 * report doesn't pay for a second full listProperties() round trip) with
 * real address/bedroom/bathroom/timezone detail for the active subset
 * only, in bounded-concurrency batches. A failed detail fetch for one
 * property never blocks its batch-mates (Promise.allSettled) and simply
 * leaves that row's `detail` null — the UI treats that as "not enough
 * data to offer Create yet", never a fabricated fallback.
 */
export async function enrichUnmatchedOwnerRezProperties(
  actor: AuthContext,
  unmatchedOwnerRez: OwnerrezProperty[],
): Promise<OwnerRezOnboardingReport> {
  await assertPermission(actor, "properties:read");

  const active = unmatchedOwnerRez.filter((p) => p.active);
  const inactive = unmatchedOwnerRez.filter((p) => !p.active);
  const inactiveSummaries: UnmatchedOwnerRezSummary[] = inactive.map(
    (ownerRezProperty) => ({ ownerRezProperty, detail: null }),
  );

  const credentials = getOwnerRezCredentials();
  if (!credentials || active.length === 0) {
    return {
      active: active.map((ownerRezProperty) => ({
        ownerRezProperty,
        detail: null,
      })),
      inactive: inactiveSummaries,
    };
  }

  const client = new OwnerrezClient(credentials);
  const activeSummaries: UnmatchedOwnerRezSummary[] = [];

  for (const batch of chunk(active, DETAIL_CONCURRENCY)) {
    const results = await Promise.allSettled(
      batch.map((p) => client.getProperty(p.id)),
    );
    results.forEach((result, i) => {
      activeSummaries.push({
        ownerRezProperty: batch[i]!,
        detail: result.status === "fulfilled" ? result.value : null,
      });
    });
  }

  return { active: activeSummaries, inactive: inactiveSummaries };
}

const REQUIRED_FIELD_CHECKS: Array<{
  label: string;
  present: (detail: OwnerrezPropertyDetail) => boolean;
}> = [
  { label: "name", present: (d) => Boolean(d.name) },
  { label: "internal_code", present: (d) => Boolean(d.internal_code) },
  { label: "address.street1", present: (d) => Boolean(d.address?.street1) },
  { label: "address.city", present: (d) => Boolean(d.address?.city) },
  { label: "address.state", present: (d) => Boolean(d.address?.state) },
  {
    label: "address.postal_code",
    present: (d) => Boolean(d.address?.postal_code),
  },
  { label: "address.country", present: (d) => Boolean(d.address?.country) },
  { label: "bedrooms", present: (d) => d.bedrooms != null },
  {
    label: "bathrooms_full/bathrooms_half",
    present: (d) => d.bathrooms_full != null || d.bathrooms_half != null,
  },
  { label: "max_guests", present: (d) => d.max_guests != null },
  { label: "time_zone", present: (d) => Boolean(d.time_zone) },
];

/**
 * The one-at-a-time "Create StayWhile Property from OwnerRez" write path.
 * Every Property field comes from a *fresh* getProperty() call keyed by
 * the submitted ownerRezPropertyId — never from client-supplied field
 * values, so nothing here can be tampered into creating a fabricated
 * property under a real-looking OwnerRez id.
 *
 * Refuses to create anything if any NOT NULL Property column can't be
 * derived from OwnerRez's own response — never fabricates a missing
 * address/bedroom/bathroom/timezone value. propertyType is the one
 * deliberate exception: HANDOFF's revised OwnerRez field-ownership policy
 * explicitly sanctions `OTHER` as a creation-time default when no
 * human-approved OwnerRez-type -> StayWhile-type mapping exists yet (none
 * does today) — this is a documented default, not a guess.
 *
 * Always creates at PropertyStatus.ONBOARDING, never ACTIVE, regardless of
 * what schema.prisma's own default is — an onboarded property needs
 * explicit human promotion to ACTIVE separately, same as manual property
 * creation's existing convention.
 */
export async function createPropertyFromOwnerRez(
  actor: AuthContext,
  rawInput: CreatePropertyFromOwnerRezInput,
): Promise<Property> {
  await assertPermission(actor, "properties:create");
  const input = createPropertyFromOwnerRezSchema.parse(rawInput);

  const existingLink = await prisma.property.findUnique({
    where: { ownerRezPropertyId: input.ownerRezPropertyId },
  });
  if (existingLink) {
    throw new Error(
      "This OwnerRez property is already linked to a StayWhile property.",
    );
  }

  const credentials = getOwnerRezCredentials();
  if (!credentials) {
    throw new Error("OwnerRez isn't configured.");
  }
  const client = new OwnerrezClient(credentials);
  const ownerRezId = Number(input.ownerRezPropertyId);
  const detail = await client.getProperty(ownerRezId);

  const missing = REQUIRED_FIELD_CHECKS.filter(
    (check) => !check.present(detail),
  ).map((check) => check.label);
  if (missing.length > 0) {
    throw new Error(
      `Cannot create a StayWhile property from OwnerRez property ${input.ownerRezPropertyId} — missing required field(s): ${missing.join(", ")}. This property needs manual review instead.`,
    );
  }

  const existingByCode = await prisma.property.findUnique({
    where: { internalCode: detail.internal_code! },
  });
  if (existingByCode) {
    throw new Error(
      `A StayWhile property with internal code "${detail.internal_code}" already exists — refusing to create a duplicate.`,
    );
  }

  const data = {
    name: detail.name,
    internalCode: detail.internal_code!,
    addressLine1: detail.address!.street1!,
    addressLine2: detail.address!.street2,
    city: detail.address!.city!,
    state: detail.address!.state!,
    postalCode: detail.address!.postal_code!,
    country: detail.address!.country!,
    latitude: detail.latitude,
    longitude: detail.longitude,
    propertyType: "OTHER" as const,
    bedroomCount: detail.bedrooms!,
    bathroomCount:
      (detail.bathrooms_full ?? 0) + (detail.bathrooms_half ?? 0) * 0.5,
    maxOccupancy: detail.max_guests!,
    timezone: detail.time_zone!,
    ownerRezPropertyId: input.ownerRezPropertyId,
    status: "ONBOARDING" as const,
  };

  let property: Property;
  try {
    property = await prisma.property.create({ data });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new Error(
        "This OwnerRez property or internal code is already linked to a StayWhile property.",
      );
    }
    throw err;
  }

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.created_from_ownerrez",
    entityType: "Property",
    entityId: property.id,
    afterState: property,
    metadata: {
      ownerRezPropertyId: input.ownerRezPropertyId,
      ownerRezPropertyName: detail.name,
    },
  });

  return property;
}
