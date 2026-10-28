import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import {
  checkNestLiveTestEligibility,
  NEST_LIVE_TEST_MAX_DEVICES,
  parseNestLiveTestList,
  type NestLiveTestList,
} from "../lib/nest-live-test";

import { lockNestConnectionRow } from "./nest-connection-row-lock";

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
    // Serializes with setNestLiveTestDevice() — both rewrite this row's
    // metadata, and neither may drop the other's key.
    await lockNestConnectionRow(tx);
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

/**
 * Nest live-test list (2026-10-28) — see lib/nest-live-test.ts. Internal,
 * unauthenticated read for the command path (sendNestThermostatCommand()
 * has passed RBAC first). Always a fresh read, never cached; missing or
 * malformed data reads as an empty list.
 */
export async function readNestLiveTestList(): Promise<NestLiveTestList> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "NEST" },
    select: { metadata: true },
  });
  return parseNestLiveTestList(connection?.metadata ?? null);
}

/** Dashboard read — same audience as the switch itself. */
export async function getNestLiveTestList(
  actor: AuthContext,
): Promise<NestLiveTestList> {
  await assertPermission(actor, "smart_devices:read");
  return readNestLiveTestList();
}

export type SetNestLiveTestDeviceResult =
  | { status: "success"; onList: boolean; smartDeviceIds: string[] }
  | { status: "rejected"; reason: string };

/**
 * Adds a thermostat to, or removes it from, the Nest live-test list.
 * Admin-only (GLOBAL thermostats:manage, like the switch). Adding requires
 * an eligible device (checkNestLiveTestEligibility) and room under
 * NEST_LIVE_TEST_MAX_DEVICES; removing always works, whatever the device's
 * state. Holds the NEST row lock, merges into the existing metadata (the
 * switch is never touched), and audits every change with the list before
 * and after. A request that changes nothing writes nothing.
 */
export async function setNestLiveTestDevice(
  actor: AuthContext,
  smartDeviceId: string,
  onList: boolean,
): Promise<SetNestLiveTestDeviceResult> {
  await assertPermission(actor, "thermostats:manage");

  return prisma.$transaction(async (tx) => {
    await lockNestConnectionRow(tx);
    const connection = await tx.integrationConnection.findUnique({
      where: { provider: "NEST" },
      select: { id: true, metadata: true },
    });
    if (!connection) {
      return {
        status: "rejected",
        reason:
          "Nest isn't connected, so there is no live-test list to change.",
      } as const;
    }

    const before = parseNestLiveTestList(connection.metadata).smartDeviceIds;
    const alreadyOnList = before.includes(smartDeviceId);
    if (alreadyOnList === onList) {
      return { status: "success", onList, smartDeviceIds: before } as const;
    }

    if (onList) {
      const device = await tx.smartDevice.findUnique({
        where: { id: smartDeviceId },
        include: { providerDevice: true, property: true },
      });
      const eligibility = checkNestLiveTestEligibility(device);
      if (!eligibility.eligible) {
        return { status: "rejected", reason: eligibility.reason } as const;
      }
      if (before.length >= NEST_LIVE_TEST_MAX_DEVICES) {
        return {
          status: "rejected",
          reason: `The live-test list already has ${NEST_LIVE_TEST_MAX_DEVICES} thermostats. Remove one first.`,
        } as const;
      }
    }

    const after = onList
      ? [...before, smartDeviceId]
      : before.filter((id) => id !== smartDeviceId);
    const nextMetadata = {
      ...((connection.metadata as Record<string, unknown> | null) ?? {}),
      nestLiveTest: {
        smartDeviceIds: after,
        updatedAt: new Date().toISOString(),
        updatedByUserId: actor.userId,
      },
    };
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "nest.thermostat_control.live_test_device_set",
        entityType: "IntegrationConnection",
        entityId: connection.id,
        beforeState: { smartDeviceIds: before } as Prisma.InputJsonValue,
        afterState: {
          smartDeviceIds: after,
          smartDeviceId,
          onList,
        } as Prisma.InputJsonValue,
      },
      tx,
    );
    return { status: "success", onList, smartDeviceIds: after } as const;
  });
}
