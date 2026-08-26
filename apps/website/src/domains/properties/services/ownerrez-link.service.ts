import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Property } from "@stayw/database";

import { APPROVED_OWNERREZ_LINKS } from "../config/ownerrez-approved-links";
import {
  confirmOwnerRezLinkSchema,
  type ConfirmOwnerRezLinkInput,
} from "../schemas/ownerrez-link.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Narrow, duck-typed check for Prisma's unique-constraint violation code.
 * Deliberately not an `instanceof Prisma.PrismaClientKnownRequestError`
 * check — that would require importing and constructing the real Prisma
 * error class in tests just to simulate a race. Every real
 * PrismaClientKnownRequestError carries a string `code` property (e.g.
 * "P2002"), so checking that shape directly is sufficient here, scoped to
 * exactly the one `prisma.property.update` call below.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

const ALREADY_LINKED_TO_ANOTHER_PROPERTY =
  "This OwnerRez property is already linked to a different StayWhile property.";

/**
 * The only write path Phase B adds: sets exactly one already-unlinked
 * StayWhile Property's `ownerRezPropertyId`, one property at a time, and
 * only for a pairing a human has explicitly pre-approved in
 * APPROVED_OWNERREZ_LINKS. Never touches name/address/bedroomCount/
 * bathroomCount/maxOccupancy/status/internalCode, never calls OwnerRez's
 * API (the approved OwnerRez id/name are static, human-reviewed data — see
 * that file's own comment), and never accepts an arbitrary
 * property/OwnerRez-id pair.
 *
 * Trust boundary: nothing about the property's own name/internalCode, or
 * about the OwnerRez side's name/status, is ever taken from `rawInput`.
 * The property is reloaded fresh from the DB by `propertyId` and its own
 * `internalCode` (not anything submitted) is what's looked up in the
 * allow-list. The only submitted value that participates in authorization
 * is `ownerRezPropertyId`, and it must exactly equal the allow-listed value
 * for that DB row — a mismatch (tampered or stale) is rejected before any
 * write is attempted.
 */
export async function confirmOwnerRezLink(
  actor: AuthContext,
  rawInput: ConfirmOwnerRezLinkInput,
): Promise<Property> {
  await assertPermission(actor, "properties:update");
  const input = confirmOwnerRezLinkSchema.parse(rawInput);

  const property = await prisma.property.findUnique({
    where: { id: input.propertyId },
  });
  if (!property || property.deletedAt) {
    throw new Error("Property not found.");
  }
  if (property.ownerRezPropertyId) {
    throw new Error("This property is already linked to an OwnerRez property.");
  }

  const approved = APPROVED_OWNERREZ_LINKS.find(
    (link) => link.propertyInternalCode === property.internalCode,
  );
  if (!approved) {
    throw new Error("This property is not approved for OwnerRez linking.");
  }
  if (input.ownerRezPropertyId !== approved.ownerRezPropertyId) {
    throw new Error(
      "Submitted OwnerRez ID does not match the approved mapping for this property.",
    );
  }

  const existingLink = await prisma.property.findUnique({
    where: { ownerRezPropertyId: approved.ownerRezPropertyId },
  });
  if (existingLink) {
    throw new Error(ALREADY_LINKED_TO_ANOTHER_PROPERTY);
  }

  let updated: Property;
  try {
    updated = await prisma.property.update({
      where: { id: property.id },
      data: { ownerRezPropertyId: approved.ownerRezPropertyId },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new Error(ALREADY_LINKED_TO_ANOTHER_PROPERTY);
    }
    throw err;
  }

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "property.ownerrez_matched",
    entityType: "Property",
    entityId: updated.id,
    beforeState: { ownerRezPropertyId: null },
    afterState: { ownerRezPropertyId: approved.ownerRezPropertyId },
    metadata: {
      propertyName: property.name,
      propertyInternalCode: property.internalCode,
      ownerRezPropertyId: approved.ownerRezPropertyId,
      ownerRezPropertyName: approved.ownerRezPropertyName,
    },
  });

  return updated;
}
