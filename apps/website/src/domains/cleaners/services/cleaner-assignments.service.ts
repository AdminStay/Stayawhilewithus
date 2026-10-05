import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import {
  prisma,
  type CleanerAssignmentRole,
  type CleanerStatus,
  type Prisma,
  type PropertyStatus,
} from "@stayw/database";

import { CleanerRuleError } from "../lib/errors";
import type {
  AssignCleanerInput,
  EndCleanerAssignmentInput,
} from "../schemas/cleaners.schema";

import { cleanerPhoneDisplay } from "./cleaners.service";

import {
  isOperationalProperty,
  OPERATIONAL_PROPERTY_STATUSES,
} from "@/domains/properties/lib/operational-properties";
import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Property ↔ cleaner assignments (Cleaner Assignments Phase 3). All of it is
 * dashboard-managed data — nothing here knows any particular roster.
 *
 * A row is CURRENT while endedAt is null. Changes never edit history: they
 * end the current row (endedAt/endedBy) and start a new one. The database
 * itself enforces one current PRIMARY per property and one current row per
 * cleaner per property (partial unique indexes in the
 * 20261003120000_add_cleaners migration); the checks below just turn those
 * cases into readable messages. A property may have team members and no
 * PRIMARY — e.g. a team whose primary contact hasn't been decided.
 *
 * Nothing here changes cleanings (CleaningSchedule.cleanerId) or sends any
 * message. That is deliberate (Cleaner Phase 4, approved "Option A"): a new
 * cleaning copies the property's current PRIMARY when it is created
 * (findCurrentPrimaryCleanerId below), and existing cleanings keep their
 * stored cleaner when the PRIMARY later changes — an operator changes one
 * job at a time on /cleaning. Messaging is Phase 5.
 */

export interface AssignmentView {
  id: string;
  role: CleanerAssignmentRole;
  startedAt: Date;
  endedAt: Date | null;
  cleaner: {
    id: string;
    name: string;
    status: CleanerStatus;
    phoneDisplay: string;
  };
  assignedByName: string | null;
  endedByName: string | null;
}

export interface PropertyCleanerRow {
  property: {
    id: string;
    name: string;
    internalCode: string;
    status: PropertyStatus;
    deleted: boolean;
  };
  /**
   * false for an Inactive / Offboarded / removed property that still has
   * current cleaners: shown only so they can be REMOVED (nothing new can be
   * assigned there, and the cleaner can't be deactivated until they are).
   */
  assignable: boolean;
  primary: AssignmentView | null;
  teamMembers: AssignmentView[];
  /** Ended assignments, newest first. */
  history: AssignmentView[];
}

/** Display names only for the Properties list — no phone numbers at all. */
export interface PropertyCleanerSummary {
  primary: string | null;
  teamMembers: string[];
}

const CONCURRENT_CHANGE_MESSAGE =
  "This property's cleaners were just changed by someone else. Refresh the page and try again.";

function userName(
  user: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null,
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email;
}

const USER_NAME_SELECT = {
  select: { firstName: true, lastName: true, email: true },
} as const;

/**
 * Every operational property (ACTIVE / ONBOARDING, not deleted) with its
 * current cleaners and history — PLUS any other property (Inactive,
 * Offboarded or removed) that still has a current assignment, so those
 * leftover assignments stay visible and removable. Operational properties
 * come first.
 */
export async function listPropertyCleanerAssignments(
  actor: AuthContext,
): Promise<PropertyCleanerRow[]> {
  await assertPermission(actor, "cleaners:read");
  const canSeeFullPhone = await hasPermission(actor, "cleaners:manage");

  const properties = await prisma.property.findMany({
    where: {
      OR: [
        // Same rule as OPERATIONAL_PROPERTY_WHERE, spread into a mutable array for Prisma's type.
        {
          deletedAt: null,
          status: { in: [...OPERATIONAL_PROPERTY_STATUSES] },
        },
        { cleanerAssignments: { some: { endedAt: null } } },
      ],
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      internalCode: true,
      status: true,
      deletedAt: true,
      cleanerAssignments: {
        orderBy: { startedAt: "desc" },
        include: {
          cleaner: true,
          assignedBy: USER_NAME_SELECT,
          endedBy: USER_NAME_SELECT,
        },
      },
    },
  });

  const rows = properties.map((p): PropertyCleanerRow => {
    const views: AssignmentView[] = p.cleanerAssignments.map((a) => ({
      id: a.id,
      role: a.role,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      cleaner: {
        id: a.cleaner.id,
        name: a.cleaner.name,
        status: a.cleaner.status,
        phoneDisplay: cleanerPhoneDisplay(a.cleaner.phone, canSeeFullPhone),
      },
      assignedByName: userName(a.assignedBy),
      endedByName: userName(a.endedBy),
    }));
    const current = views.filter((v) => v.endedAt === null);
    return {
      property: {
        id: p.id,
        name: p.name,
        internalCode: p.internalCode,
        status: p.status,
        deleted: p.deletedAt !== null,
      },
      assignable: isOperationalProperty(p),
      primary: current.find((v) => v.role === "PRIMARY") ?? null,
      teamMembers: current
        .filter((v) => v.role === "TEAM_MEMBER")
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
      history: views.filter((v) => v.endedAt !== null),
    };
  });
  // Stable sort: assignable (operational) first, each group still by name.
  return [
    ...rows.filter((r) => r.assignable),
    ...rows.filter((r) => !r.assignable),
  ];
}

/** propertyId → current cleaner names, for the Properties list's "Cleaner" column. */
export async function listCurrentCleanerSummaries(
  actor: AuthContext,
): Promise<Record<string, PropertyCleanerSummary>> {
  await assertPermission(actor, "cleaners:read");

  const current = await prisma.propertyCleanerAssignment.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: "asc" },
    select: {
      propertyId: true,
      role: true,
      cleaner: { select: { name: true } },
    },
  });

  const summaries: Record<string, PropertyCleanerSummary> = {};
  for (const a of current) {
    const summary = (summaries[a.propertyId] ??= {
      primary: null,
      teamMembers: [],
    });
    if (a.role === "PRIMARY") summary.primary = a.cleaner.name;
    else summary.teamMembers.push(a.cleaner.name);
  }
  return summaries;
}

/** A property's current cleaners as ids + names (no phones), for pickers. */
export interface PropertyCleanerOptions {
  primary: { id: string; name: string } | null;
  teamMembers: Array<{ id: string; name: string }>;
}

/**
 * propertyId → current PRIMARY and TEAM_MEMBERs, ids + names only. Used by
 * /cleaning (Cleaner Phase 4) to show a property's default cleaner or team
 * and to build the per-job cleaner picker. Properties with no current
 * assignment are simply absent from the map.
 */
export async function listCurrentPropertyCleanerOptions(
  actor: AuthContext,
): Promise<Record<string, PropertyCleanerOptions>> {
  await assertPermission(actor, "cleaners:read");

  const current = await prisma.propertyCleanerAssignment.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: "asc" },
    select: {
      propertyId: true,
      role: true,
      cleaner: { select: { id: true, name: true } },
    },
  });

  const options: Record<string, PropertyCleanerOptions> = {};
  for (const a of current) {
    const entry = (options[a.propertyId] ??= {
      primary: null,
      teamMembers: [],
    });
    if (a.role === "PRIMARY") entry.primary = a.cleaner;
    else entry.teamMembers.push(a.cleaner);
  }
  return options;
}

/**
 * The property's current PRIMARY cleaner id, or null. Used as the default
 * cleaner when a cleaning is created (Cleaner Phase 4) — the value is
 * copied onto the cleaning and does NOT follow later assignment changes.
 *
 * Only a CURRENT (endedAt null) PRIMARY row counts, and only if that
 * cleaner is ACTIVE. A TEAM_MEMBER is never returned: a team-only property
 * has no default, and nothing here designates one. The database allows at
 * most one current PRIMARY per property, so this is never ambiguous.
 *
 * No permission check — an internal lookup for callers that have already
 * checked their own (e.g. createCleaningSchedule); pass their transaction
 * client so the lookup and the write see the same state.
 */
export async function findCurrentPrimaryCleanerId(
  client: Prisma.TransactionClient,
  propertyId: string,
): Promise<string | null> {
  const primary = await client.propertyCleanerAssignment.findFirst({
    where: {
      propertyId,
      endedAt: null,
      role: "PRIMARY",
      cleaner: { status: "ACTIVE" },
    },
    select: { cleanerId: true },
  });
  return primary?.cleanerId ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

async function loadAssignableTargets(
  tx: Prisma.TransactionClient,
  propertyId: string,
  cleanerId: string,
) {
  const [property, cleaner] = await Promise.all([
    tx.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, status: true, deletedAt: true },
    }),
    tx.cleaner.findUnique({ where: { id: cleanerId } }),
  ]);
  if (!property || !isOperationalProperty(property)) {
    throw new CleanerRuleError(
      "Cleaners can only be assigned to Active or Onboarding properties.",
    );
  }
  if (!cleaner) throw new CleanerRuleError("That cleaner no longer exists.");
  if (cleaner.status !== "ACTIVE") {
    throw new CleanerRuleError(
      `${cleaner.name} is inactive. Reactivate them before assigning.`,
    );
  }
  return { property, cleaner };
}

/**
 * Makes `cleanerId` the property's PRIMARY cleaner: ends the current
 * PRIMARY row (if any) and, when the cleaner is currently a TEAM_MEMBER
 * here, ends that row too (a promotion), then starts the new PRIMARY row.
 * The previous primary is NOT kept on as a team member — add them back
 * explicitly if that's wanted.
 */
export async function setPrimaryCleaner(
  actor: AuthContext,
  input: Pick<AssignCleanerInput, "propertyId" | "cleanerId">,
) {
  await assertPermission(actor, "cleaners:manage");

  try {
    return await prisma.$transaction(async (tx) => {
      const { property, cleaner } = await loadAssignableTargets(
        tx,
        input.propertyId,
        input.cleanerId,
      );

      const current = await tx.propertyCleanerAssignment.findMany({
        where: { propertyId: property.id, endedAt: null },
        include: { cleaner: { select: { id: true, name: true } } },
      });
      const previousPrimary = current.find((a) => a.role === "PRIMARY");
      if (previousPrimary?.cleanerId === cleaner.id) {
        throw new CleanerRuleError(
          `${cleaner.name} is already the primary cleaner for ${property.name}.`,
        );
      }
      const promotedFromTeam = current.find(
        (a) => a.role === "TEAM_MEMBER" && a.cleanerId === cleaner.id,
      );

      const now = new Date();
      const toEnd = [previousPrimary, promotedFromTeam].filter(
        (a): a is NonNullable<typeof a> => a !== undefined,
      );
      for (const a of toEnd) {
        await tx.propertyCleanerAssignment.update({
          where: { id: a.id },
          data: { endedAt: now, endedByUserId: actor.userId },
        });
      }

      const assignment = await tx.propertyCleanerAssignment.create({
        data: {
          propertyId: property.id,
          cleanerId: cleaner.id,
          role: "PRIMARY",
          startedAt: now,
          assignedByUserId: actor.userId,
        },
      });

      await recordAudit(
        {
          actorUserId: actor.userId,
          actorType: "USER",
          action: "property_cleaner.primary_set",
          entityType: "PropertyCleanerAssignment",
          entityId: assignment.id,
          beforeState: {
            primaryCleanerId: previousPrimary?.cleanerId ?? null,
            primaryCleanerName: previousPrimary?.cleaner.name ?? null,
          },
          afterState: {
            primaryCleanerId: cleaner.id,
            primaryCleanerName: cleaner.name,
          },
          metadata: {
            propertyId: property.id,
            propertyName: property.name,
            endedAssignmentIds: toEnd.map((a) => a.id),
            promotedFromTeam: promotedFromTeam !== undefined,
          },
        },
        tx,
      );

      return assignment;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CleanerRuleError(CONCURRENT_CHANGE_MESSAGE);
    }
    throw err;
  }
}

/** Adds `cleanerId` to the property's team. Never changes the PRIMARY. */
export async function addTeamMember(
  actor: AuthContext,
  input: Pick<AssignCleanerInput, "propertyId" | "cleanerId">,
) {
  await assertPermission(actor, "cleaners:manage");

  try {
    return await prisma.$transaction(async (tx) => {
      const { property, cleaner } = await loadAssignableTargets(
        tx,
        input.propertyId,
        input.cleanerId,
      );

      const existing = await tx.propertyCleanerAssignment.findFirst({
        where: {
          propertyId: property.id,
          cleanerId: cleaner.id,
          endedAt: null,
        },
      });
      if (existing) {
        throw new CleanerRuleError(
          `${cleaner.name} is already assigned to ${property.name} (${existing.role === "PRIMARY" ? "primary" : "team member"}).`,
        );
      }

      const assignment = await tx.propertyCleanerAssignment.create({
        data: {
          propertyId: property.id,
          cleanerId: cleaner.id,
          role: "TEAM_MEMBER",
          assignedByUserId: actor.userId,
        },
      });

      await recordAudit(
        {
          actorUserId: actor.userId,
          actorType: "USER",
          action: "property_cleaner.team_member_added",
          entityType: "PropertyCleanerAssignment",
          entityId: assignment.id,
          afterState: {
            cleanerId: cleaner.id,
            cleanerName: cleaner.name,
            role: "TEAM_MEMBER",
          },
          metadata: { propertyId: property.id, propertyName: property.name },
        },
        tx,
      );

      return assignment;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CleanerRuleError(CONCURRENT_CHANGE_MESSAGE);
    }
    throw err;
  }
}

/**
 * Ends one current assignment (primary or team member). The row stays as
 * history. Allowed on any property, so a cleaner can still be removed from
 * a property that has since gone Inactive/Offboarded.
 */
export async function endCleanerAssignment(
  actor: AuthContext,
  input: EndCleanerAssignmentInput,
) {
  await assertPermission(actor, "cleaners:manage");

  return prisma.$transaction(async (tx) => {
    const assignment = await tx.propertyCleanerAssignment.findUnique({
      where: { id: input.assignmentId },
      include: {
        cleaner: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
      },
    });
    if (!assignment || assignment.endedAt !== null) {
      throw new CleanerRuleError(
        "This assignment has already ended. Refresh the page to see the latest.",
      );
    }

    const ended = await tx.propertyCleanerAssignment.update({
      where: { id: assignment.id },
      data: { endedAt: new Date(), endedByUserId: actor.userId },
    });

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "property_cleaner.assignment_ended",
        entityType: "PropertyCleanerAssignment",
        entityId: assignment.id,
        beforeState: {
          cleanerId: assignment.cleaner.id,
          cleanerName: assignment.cleaner.name,
          role: assignment.role,
        },
        metadata: {
          propertyId: assignment.property.id,
          propertyName: assignment.property.name,
        },
      },
      tx,
    );

    return ended;
  });
}
