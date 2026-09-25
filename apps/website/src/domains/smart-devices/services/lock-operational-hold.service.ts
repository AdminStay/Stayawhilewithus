import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import {
  parseOperationalHold,
  type OperationalHold,
  type OperationalHoldKind,
} from "../lib/lock-health";

import { recordAudit } from "@/platform/audit/record-audit";

/** The one AuditLog action that records holds; the newest row per lock wins. */
export const LOCK_OPERATIONAL_HOLD_ACTION =
  "smart_device.lock_operational_hold";

/**
 * Internal, unauthenticated read for the command path (already past its own
 * RBAC check): the lock's active hold, or null. Newest row wins; a "cleared"
 * row means no hold.
 */
export async function readActiveOperationalHold(
  smartDeviceId: string,
): Promise<OperationalHold | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      entityType: "SmartDevice",
      entityId: smartDeviceId,
      action: LOCK_OPERATIONAL_HOLD_ACTION,
    },
    orderBy: { occurredAt: "desc" },
    select: { afterState: true },
  });
  return row ? parseOperationalHold(row.afterState) : null;
}

/** Dashboard read: active holds for the given locks. */
export async function getActiveOperationalHolds(
  actor: AuthContext,
  smartDeviceIds: string[],
): Promise<Map<string, OperationalHold>> {
  await assertPermission(actor, "smart_devices:read");
  if (smartDeviceIds.length === 0) return new Map();
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "SmartDevice",
      entityId: { in: smartDeviceIds },
      action: LOCK_OPERATIONAL_HOLD_ACTION,
    },
    orderBy: { occurredAt: "desc" },
    select: { entityId: true, afterState: true },
  });
  const seen = new Set<string>();
  const holds = new Map<string, OperationalHold>();
  for (const row of rows) {
    if (seen.has(row.entityId)) continue;
    seen.add(row.entityId);
    const hold = parseOperationalHold(row.afterState);
    if (hold) holds.set(row.entityId, hold);
  }
  return holds;
}

export type OperationalHoldResult =
  { status: "success" } | { status: "rejected"; reason: string };

async function findLockDevice(smartDeviceId: string) {
  return prisma.smartDevice.findUnique({
    where: { id: smartDeviceId },
    select: { id: true, deviceType: true, propertyId: true },
  });
}

/**
 * Admin-only (GLOBAL locks:manage, same as the kill switch and admin reset;
 * to move to a separate locks:admin permission when that split is made).
 * Records a hold as a new AuditLog row. Never sends a command, never changes
 * mapping, telemetry, or command history.
 */
export async function setLockOperationalHold(
  actor: AuthContext,
  input: { smartDeviceId: string; kind: OperationalHoldKind; note: string },
): Promise<OperationalHoldResult> {
  await assertPermission(actor, "locks:manage");
  const device = await findLockDevice(input.smartDeviceId);
  if (!device || device.deviceType !== "LOCK") {
    return { status: "rejected", reason: "Lock not found." };
  }
  const previous = await readActiveOperationalHold(device.id);
  const hold: OperationalHold = {
    kind: input.kind,
    note: input.note,
    setAt: new Date().toISOString(),
    setByUserId: actor.userId,
  };
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: LOCK_OPERATIONAL_HOLD_ACTION,
    entityType: "SmartDevice",
    entityId: device.id,
    beforeState: { hold: previous } as Prisma.InputJsonValue,
    afterState: { hold } as unknown as Prisma.InputJsonValue,
  });
  return { status: "success" };
}

/** Admin-only. Clearing is a new row, so the hold's history stays intact. */
export async function clearLockOperationalHold(
  actor: AuthContext,
  input: { smartDeviceId: string; note: string },
): Promise<OperationalHoldResult> {
  await assertPermission(actor, "locks:manage");
  const device = await findLockDevice(input.smartDeviceId);
  if (!device || device.deviceType !== "LOCK") {
    return { status: "rejected", reason: "Lock not found." };
  }
  const previous = await readActiveOperationalHold(device.id);
  if (!previous) {
    return { status: "rejected", reason: "This lock has no active hold." };
  }
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: LOCK_OPERATIONAL_HOLD_ACTION,
    entityType: "SmartDevice",
    entityId: device.id,
    beforeState: { hold: previous } as unknown as Prisma.InputJsonValue,
    afterState: {
      hold: null,
      clearedAt: new Date().toISOString(),
      note: input.note,
    } as Prisma.InputJsonValue,
  });
  return { status: "success" };
}
