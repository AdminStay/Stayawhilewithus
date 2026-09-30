import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Cielo-only remote thermostat-control kill switch (2026-09-30), separate
 * from the Nest switch (thermostat-control-settings.service.ts) so turning
 * one on never enables the other. Stored on the CIELO IntegrationConnection
 * row's `metadata.cieloControl` (no migration). Default OFF: anything but an
 * explicit `enabled: true` — including a missing row — reads as OFF.
 */
export interface CieloControlSetting {
  enabled: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export const CIELO_CONTROL_OFF_REASON =
  "Remote Cielo thermostat control is OFF. No Cielo command can be sent until an admin turns it on.";

function parseSetting(metadata: Prisma.JsonValue | null): CieloControlSetting {
  const stored = (
    metadata as {
      cieloControl?: {
        enabled?: unknown;
        updatedAt?: unknown;
        updatedByUserId?: unknown;
      };
    } | null
  )?.cieloControl;
  return {
    enabled: stored?.enabled === true,
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
    updatedByUserId:
      typeof stored?.updatedByUserId === "string"
        ? stored.updatedByUserId
        : null,
  };
}

/** Internal read for the command service — no RBAC (it has its own). */
export async function readCieloControlSetting(): Promise<CieloControlSetting> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "CIELO" },
    select: { metadata: true },
  });
  if (!connection) {
    return { enabled: false, updatedAt: null, updatedByUserId: null };
  }
  return parseSetting(connection.metadata);
}

export async function getCieloControlSetting(
  actor: AuthContext,
): Promise<CieloControlSetting> {
  await assertPermission(actor, "smart_devices:read");
  return readCieloControlSetting();
}

export type SetCieloControlResult =
  | { status: "success"; enabled: boolean }
  | { status: "rejected"; reason: string };

/** Admin-only (GLOBAL thermostats:manage). Audited on every change. */
export async function setCieloControlEnabled(
  actor: AuthContext,
  enabled: boolean,
): Promise<SetCieloControlResult> {
  await assertPermission(actor, "thermostats:manage");

  return prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.findUnique({
      where: { provider: "CIELO" },
      select: { id: true, metadata: true },
    });
    if (!connection) {
      return {
        status: "rejected",
        reason:
          "Cielo isn't connected, so there is no thermostat control to turn on or off.",
      } as const;
    }

    const before = parseSetting(connection.metadata);
    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) ?? {}),
      cieloControl: { enabled, updatedAt, updatedByUserId: actor.userId },
    };
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cielo.thermostat_control.set_enabled",
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
