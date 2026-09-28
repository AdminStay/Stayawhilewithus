import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Global remote Nest thermostat-control kill switch (2026-09-27, Nest
 * Phase 1). Same storage pattern as the August lock kill switch
 * (lock-control-settings.service.ts): the Nest IntegrationConnection's
 * existing `metadata` JSON column, under `thermostatControl` — no schema
 * migration. When OFF, sendNestThermostatCommand() refuses every physical
 * command (setpoint/mode/fan) for every thermostat before any Google call.
 *
 * Defaults — deliberately the OPPOSITE of the lock switch's: no command has
 * ever been sent to a real Nest thermostat, so control is OFF until an admin
 * explicitly turns it on. Only a stored `enabled: true` counts as ON:
 *   - no `thermostatControl` key yet → OFF (so existing admins don't
 *     suddenly get live controls when this ships);
 *   - any other stored value → OFF;
 *   - no Nest IntegrationConnection row at all → OFF.
 */
export interface ThermostatControlSetting {
  enabled: boolean;
  /** ISO timestamp of the last toggle, null if never toggled. */
  updatedAt: string | null;
  updatedByUserId: string | null;
}

interface StoredThermostatControl {
  enabled?: unknown;
  updatedAt?: unknown;
  updatedByUserId?: unknown;
}

export const THERMOSTAT_CONTROL_OFF_REASON =
  "Remote Nest thermostat control is OFF. No thermostat command can be sent until an admin turns it on.";

function parseSetting(
  metadata: Prisma.JsonValue | null,
): ThermostatControlSetting {
  const stored = (
    metadata as { thermostatControl?: StoredThermostatControl } | null
  )?.thermostatControl;
  return {
    enabled: stored?.enabled === true,
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
    updatedByUserId:
      typeof stored?.updatedByUserId === "string"
        ? stored.updatedByUserId
        : null,
  };
}

/**
 * Internal, unauthenticated read for the command path —
 * sendNestThermostatCommand() has already passed its own RBAC check before
 * calling this. Always a fresh read, never cached, so a toggle takes effect
 * on the very next command.
 */
export async function readThermostatControlSetting(): Promise<ThermostatControlSetting> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "NEST" },
    select: { metadata: true },
  });
  if (!connection) {
    return { enabled: false, updatedAt: null, updatedByUserId: null };
  }
  return parseSetting(connection.metadata);
}

/** Dashboard read — anyone who can see devices can see whether remote thermostat control is on. */
export async function getThermostatControlSetting(
  actor: AuthContext,
): Promise<ThermostatControlSetting> {
  await assertPermission(actor, "smart_devices:read");
  return readThermostatControlSetting();
}

export type SetThermostatControlResult =
  | { status: "success"; enabled: boolean }
  | { status: "rejected"; reason: string };

/**
 * Admin-only toggle. Checked as a GLOBAL `thermostats:manage` grant (no
 * propertyId) — held only by `admin` today — so a property-scoped grant can
 * never flip a switch that affects every property. Every toggle is
 * audit-logged with the before/after value, including a no-change toggle.
 */
export async function setThermostatControlEnabled(
  actor: AuthContext,
  enabled: boolean,
): Promise<SetThermostatControlResult> {
  await assertPermission(actor, "thermostats:manage");

  return prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.findUnique({
      where: { provider: "NEST" },
      select: { id: true, metadata: true },
    });
    if (!connection) {
      return {
        status: "rejected",
        reason:
          "Nest isn't connected, so there is no thermostat control to turn on or off.",
      } as const;
    }

    const before = parseSetting(connection.metadata);
    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) ?? {}),
      thermostatControl: { enabled, updatedAt, updatedByUserId: actor.userId },
    };
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "nest.thermostat_control.set_enabled",
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
