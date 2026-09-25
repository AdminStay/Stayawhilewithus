import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Global remote lock-control kill switch (2026-09-25, "enable all locks").
 *
 * Stored in the August IntegrationConnection's existing `metadata` JSON
 * column under `lockControl` — database-backed and dashboard-managed with no
 * schema migration. When OFF, sendAugustLockCommand() refuses every physical
 * command for every lock before anything is sent.
 *
 * Defaults:
 *   - no `lockControl.enabled` key yet → ON (the owner asked for ON after
 *     deploy; turning it off is one admin click).
 *   - no August IntegrationConnection row at all → OFF (nothing to control,
 *     and nowhere to record a toggle).
 */
export interface LockControlSetting {
  enabled: boolean;
  /** ISO timestamp of the last toggle, null if never toggled. */
  updatedAt: string | null;
  updatedByUserId: string | null;
}

interface StoredLockControl {
  enabled?: unknown;
  updatedAt?: unknown;
  updatedByUserId?: unknown;
}

function parseSetting(metadata: Prisma.JsonValue | null): LockControlSetting {
  const stored = (metadata as { lockControl?: StoredLockControl } | null)
    ?.lockControl;
  return {
    enabled: stored?.enabled === false ? false : true,
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
    updatedByUserId:
      typeof stored?.updatedByUserId === "string"
        ? stored.updatedByUserId
        : null,
  };
}

/**
 * Internal, unauthenticated read for the command path — sendAugustLockCommand()
 * has already passed its own RBAC check before calling this. Always a fresh
 * read, never cached, so a toggle takes effect on the very next command.
 */
export async function readLockControlSetting(): Promise<LockControlSetting> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "AUGUST" },
    select: { metadata: true },
  });
  if (!connection) {
    return { enabled: false, updatedAt: null, updatedByUserId: null };
  }
  return parseSetting(connection.metadata);
}

/** Dashboard read — anyone who can see devices can see whether remote control is on. */
export async function getLockControlSetting(
  actor: AuthContext,
): Promise<LockControlSetting> {
  await assertPermission(actor, "smart_devices:read");
  return readLockControlSetting();
}

export type SetLockControlResult =
  | { status: "success"; enabled: boolean }
  | { status: "rejected"; reason: string };

/**
 * Admin-only toggle. Checked as a GLOBAL `locks:manage` grant (no propertyId),
 * which in Production is held by the `admin` role only — a property-scoped
 * grant can never flip a switch that affects every property. Every toggle is
 * audit-logged with the before/after value, including a no-change toggle.
 */
export async function setLockControlEnabled(
  actor: AuthContext,
  enabled: boolean,
): Promise<SetLockControlResult> {
  await assertPermission(actor, "locks:manage");

  return prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.findUnique({
      where: { provider: "AUGUST" },
      select: { id: true, metadata: true },
    });
    if (!connection) {
      return {
        status: "rejected",
        reason:
          "August isn't connected, so there is no lock control to turn on or off.",
      } as const;
    }

    const before = parseSetting(connection.metadata);
    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) ?? {}),
      lockControl: { enabled, updatedAt, updatedByUserId: actor.userId },
    };
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "august.lock_control.set_enabled",
        entityType: "IntegrationConnection",
        entityId: connection.id,
        beforeState: { enabled: before.enabled } as Prisma.InputJsonValue,
        afterState: { enabled } as Prisma.InputJsonValue,
      },
      tx,
    );
    return { status: "success", enabled } as const;
  });
}
