import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import {
  prisma,
  type Cleaner,
  type CleanerAssignmentRole,
  type CleanerContact,
  type CleanerStatus,
} from "@stayw/database";

import { CleanerRuleError } from "../lib/errors";
import { formatPhone, maskPhone, phoneLast4 } from "../lib/phone";
import type {
  AddCleanerContactInput,
  CreateCleanerInput,
  RemoveCleanerContactInput,
  UpdateCleanerContactInput,
  SetCleanerStatusInput,
  UpdateCleanerInput,
} from "../schemas/cleaners.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * What a cleaner looks like outside this service. `phone` (the full,
 * normalized number) is present ONLY when the viewer holds
 * `cleaners:manage`; otherwise it is null and `phoneDisplay` is masked.
 * Backup contacts follow exactly the same rule.
 * The raw Cleaner row is never returned to a page, so a full number can't
 * reach a browser that isn't allowed to show it.
 */
export interface CleanerView {
  id: string;
  name: string;
  status: CleanerStatus;
  notes: string | null;
  phone: string | null;
  phoneDisplay: string;
  currentAssignments: Array<{
    id: string;
    role: CleanerAssignmentRole;
    property: { id: string; name: string };
  }>;
  backupContacts: CleanerContactView[];
}

export interface CleanerContactView {
  id: string;
  /** Empty: another number for the cleaner themself. */
  name: string | null;
  relationship: string | null;
  notes: string | null;
  phone: string | null;
  phoneDisplay: string;
}

export function cleanerPhoneDisplay(
  phone: string,
  canSeeFullPhone: boolean,
): string {
  return canSeeFullPhone ? formatPhone(phone) : maskPhone(phone);
}

export function toCleanerView(
  cleaner: Cleaner & {
    assignments?: Array<{
      id: string;
      role: CleanerAssignmentRole;
      property: { id: string; name: string };
    }>;
    backupContacts?: CleanerContact[];
  },
  canSeeFullPhone: boolean,
): CleanerView {
  return {
    id: cleaner.id,
    name: cleaner.name,
    status: cleaner.status,
    notes: cleaner.notes,
    phone: canSeeFullPhone ? cleaner.phone : null,
    phoneDisplay: cleanerPhoneDisplay(cleaner.phone, canSeeFullPhone),
    currentAssignments: (cleaner.assignments ?? []).map((a) => ({
      id: a.id,
      role: a.role,
      property: { id: a.property.id, name: a.property.name },
    })),
    backupContacts: (cleaner.backupContacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      relationship: c.relationship,
      notes: c.notes,
      phone: canSeeFullPhone ? c.phone : null,
      phoneDisplay: cleanerPhoneDisplay(c.phone, canSeeFullPhone),
    })),
  };
}

/** Audit entries never store a full phone number — last 4 digits only. */
export function cleanerAuditSnapshot(cleaner: Cleaner) {
  return {
    id: cleaner.id,
    name: cleaner.name,
    phoneLast4: phoneLast4(cleaner.phone),
    status: cleaner.status,
    notes: cleaner.notes,
  };
}

function contactAuditSnapshot(contact: CleanerContact) {
  return {
    id: contact.id,
    cleanerId: contact.cleanerId,
    name: contact.name,
    relationship: contact.relationship,
    phoneLast4: phoneLast4(contact.phone),
    notes: contact.notes,
  };
}

/** ACTIVE first (enum order), then by name. Includes each cleaner's CURRENT assignments only, and their backup contacts. */
export async function listCleaners(actor: AuthContext) {
  await assertPermission(actor, "cleaners:read");
  const canManage = await hasPermission(actor, "cleaners:manage");

  const cleaners = await prisma.cleaner.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      assignments: {
        where: { endedAt: null },
        orderBy: { startedAt: "asc" },
        include: { property: { select: { id: true, name: true } } },
      },
      backupContacts: { orderBy: { createdAt: "asc" } },
    },
  });

  return {
    canManage,
    cleaners: cleaners.map((c) => toCleanerView(c, canManage)),
  };
}

/**
 * ACTIVE cleaners as `{ id, name }` only — for pickers outside /cleaners
 * (e.g. choosing a cleaning's cleaner on /cleaning). Deliberately selects
 * no phone field at all, so it is safe to hand to a client component.
 */
export async function listActiveCleanerOptions(
  actor: AuthContext,
): Promise<Array<{ id: string; name: string }>> {
  await assertPermission(actor, "cleaners:read");
  return prisma.cleaner.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function createCleaner(
  actor: AuthContext,
  input: CreateCleanerInput,
) {
  await assertPermission(actor, "cleaners:manage");

  return prisma.$transaction(async (tx) => {
    const cleaner = await tx.cleaner.create({
      data: {
        name: input.name,
        phone: input.phone,
        notes: input.notes || null,
      },
    });

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaner.created",
        entityType: "Cleaner",
        entityId: cleaner.id,
        afterState: cleanerAuditSnapshot(cleaner),
      },
      tx,
    );

    return cleaner;
  });
}

export async function updateCleaner(
  actor: AuthContext,
  input: UpdateCleanerInput,
) {
  await assertPermission(actor, "cleaners:manage");

  return prisma.$transaction(async (tx) => {
    const before = await tx.cleaner.findUnique({ where: { id: input.id } });
    if (!before) throw new CleanerRuleError("That cleaner no longer exists.");
    const sameAsBackup = await tx.cleanerContact.count({
      where: { cleanerId: input.id, phone: input.phone },
    });
    if (sameAsBackup > 0) {
      throw new CleanerRuleError(
        "That number is already one of this cleaner's backup contacts. Remove it there first, or use a different primary number.",
      );
    }

    const cleaner = await tx.cleaner.update({
      where: { id: input.id },
      data: {
        name: input.name,
        phone: input.phone,
        notes: input.notes || null,
      },
    });

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaner.updated",
        entityType: "Cleaner",
        entityId: cleaner.id,
        beforeState: cleanerAuditSnapshot(before),
        afterState: cleanerAuditSnapshot(cleaner),
      },
      tx,
    );

    return cleaner;
  });
}

/**
 * Deactivate / reactivate — cleaners are never deleted, so their history
 * and past cleanings keep their name. Deactivation is refused while the
 * cleaner still holds any CURRENT assignment: reassign those properties
 * first, so no property silently ends up pointing at an inactive cleaner.
 */
export async function setCleanerStatus(
  actor: AuthContext,
  input: SetCleanerStatusInput,
) {
  await assertPermission(actor, "cleaners:manage");

  return prisma.$transaction(async (tx) => {
    const before = await tx.cleaner.findUnique({ where: { id: input.id } });
    if (!before) throw new CleanerRuleError("That cleaner no longer exists.");
    if (before.status === input.status) {
      throw new CleanerRuleError(
        `${before.name} is already ${input.status === "ACTIVE" ? "active" : "inactive"}.`,
      );
    }

    if (input.status === "INACTIVE") {
      const currentAssignments = await tx.propertyCleanerAssignment.count({
        where: { cleanerId: input.id, endedAt: null },
      });
      if (currentAssignments > 0) {
        throw new CleanerRuleError(
          `${before.name} is still assigned to ${currentAssignments} ${currentAssignments === 1 ? "property" : "properties"}. Reassign or remove those first, then deactivate.`,
        );
      }
    }

    const cleaner = await tx.cleaner.update({
      where: { id: input.id },
      data: { status: input.status },
    });

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action:
          input.status === "INACTIVE"
            ? "cleaner.deactivated"
            : "cleaner.reactivated",
        entityType: "Cleaner",
        entityId: cleaner.id,
        beforeState: cleanerAuditSnapshot(before),
        afterState: cleanerAuditSnapshot(cleaner),
      },
      tx,
    );

    return cleaner;
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

const DUPLICATE_CONTACT_MESSAGE =
  "That number is already listed as a backup contact for this cleaner.";

/** A backup number must not repeat the cleaner's own primary number. */
function assertNotPrimaryPhone(cleaner: Cleaner, phone: string) {
  if (cleaner.phone === phone) {
    throw new CleanerRuleError(
      `That is already ${cleaner.name}'s primary phone number.`,
    );
  }
}

export async function addCleanerContact(
  actor: AuthContext,
  input: AddCleanerContactInput,
) {
  await assertPermission(actor, "cleaners:manage");

  try {
    return await prisma.$transaction(async (tx) => {
      const cleaner = await tx.cleaner.findUnique({
        where: { id: input.cleanerId },
      });
      if (!cleaner) {
        throw new CleanerRuleError("That cleaner no longer exists.");
      }
      assertNotPrimaryPhone(cleaner, input.phone);

      const contact = await tx.cleanerContact.create({
        data: {
          cleanerId: cleaner.id,
          phone: input.phone,
          name: input.name || null,
          relationship: input.relationship || null,
          notes: input.notes || null,
        },
      });

      await recordAudit(
        {
          actorUserId: actor.userId,
          actorType: "USER",
          action: "cleaner.contact_added",
          entityType: "CleanerContact",
          entityId: contact.id,
          afterState: contactAuditSnapshot(contact),
          metadata: { cleanerId: cleaner.id, cleanerName: cleaner.name },
        },
        tx,
      );

      return contact;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CleanerRuleError(DUPLICATE_CONTACT_MESSAGE);
    }
    throw err;
  }
}

export async function updateCleanerContact(
  actor: AuthContext,
  input: UpdateCleanerContactInput,
) {
  await assertPermission(actor, "cleaners:manage");

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.cleanerContact.findUnique({
        where: { id: input.id },
        include: { cleaner: true },
      });
      if (!before) {
        throw new CleanerRuleError("That backup contact no longer exists.");
      }
      assertNotPrimaryPhone(before.cleaner, input.phone);

      const contact = await tx.cleanerContact.update({
        where: { id: input.id },
        data: {
          phone: input.phone,
          name: input.name || null,
          relationship: input.relationship || null,
          notes: input.notes || null,
        },
      });

      await recordAudit(
        {
          actorUserId: actor.userId,
          actorType: "USER",
          action: "cleaner.contact_updated",
          entityType: "CleanerContact",
          entityId: contact.id,
          beforeState: contactAuditSnapshot(before),
          afterState: contactAuditSnapshot(contact),
          metadata: {
            cleanerId: before.cleaner.id,
            cleanerName: before.cleaner.name,
          },
        },
        tx,
      );

      return contact;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CleanerRuleError(DUPLICATE_CONTACT_MESSAGE);
    }
    throw err;
  }
}

/** Removes a backup contact. It has no history of its own; the audit entry (last 4 digits only) records the removal. */
export async function removeCleanerContact(
  actor: AuthContext,
  input: RemoveCleanerContactInput,
) {
  await assertPermission(actor, "cleaners:manage");

  return prisma.$transaction(async (tx) => {
    const before = await tx.cleanerContact.findUnique({
      where: { id: input.id },
      include: { cleaner: { select: { id: true, name: true } } },
    });
    if (!before) {
      throw new CleanerRuleError(
        "That backup contact was already removed. Refresh the page to see the latest.",
      );
    }

    await tx.cleanerContact.delete({ where: { id: input.id } });

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaner.contact_removed",
        entityType: "CleanerContact",
        entityId: before.id,
        beforeState: contactAuditSnapshot(before),
        metadata: {
          cleanerId: before.cleaner.id,
          cleanerName: before.cleaner.name,
        },
      },
      tx,
    );

    return before;
  });
}
