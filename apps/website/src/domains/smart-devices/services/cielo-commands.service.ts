import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  buildCieloSetpointFrame,
  CieloClient,
  sendCieloFrameAndAwaitState,
  validateCieloSetpoint,
  type CieloSocketFactory,
} from "@stayw/integrations/cielo";

import {
  CIELO_CONTROL_OFF_REASON,
  readCieloControlSetting,
} from "./cielo-control-settings.service";
import { toCieloSmartDeviceMetadata } from "./provider-devices.service";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Cielo thermostat setpoint command (2026-09-30, first version) — the only
 * write path for Cielo. Order of checks (nothing reaches Cielo until all
 * pass):
 *
 *   1. Device: an existing SmartDevice, provider CIELO, THERMOSTAT, not
 *      retired, on an existing property.
 *   2. Temporary allowlist: the device's MAC must be in CIELO_PROPERTY_MAP
 *      and map to the SAME property. The legacy map is only the test
 *      allowlist — dynamic, dashboard-managed Cielo mapping is still
 *      required before any broader rollout. A device with no SmartDevice
 *      row (e.g. 7206 - Office) can never be controlled.
 *   3. Property-scoped RBAC: thermostats:manage.
 *   4. Input: a whole-number °F target.
 *   5. Cielo kill switch (default OFF) — audited REJECTED.
 *   6. Duplicate/in-flight guard (advisory lock + commandInProgressAt).
 *   7. Fresh live read of the device from Cielo, then
 *      validateCieloSetpoint(): online, Fahrenheit (device + appliance),
 *      power on, mode heat/cool/auto, inside the appliance range AND
 *      60–85 °F, at most 5 °F from the current target, not a no-op, all
 *      frame fields present.
 *   8. One WebSocket frame, then confirmation: the device's StateUpdate
 *      and/or a read-back GET must report the requested setpoint.
 *
 * Results: SUCCEEDED (confirmed), FAILED (nothing was sent — Cielo was
 * unreachable or the connection never opened), AMBIGUOUS (sent, but not
 * confirmed — it may or may not have changed), REJECTED (a check refused
 * before sending). Every outcome from step 3 on is audited
 * (`smart_device.cielo_command`); credentials/tokens are never audited.
 */

export type CieloCommandResult =
  | { status: "succeeded"; confirmedTargetF: number }
  | { status: "failed"; reason: string }
  | { status: "ambiguous"; reason: string; readBackTargetF: number | null }
  | { status: "rejected"; reason: string }
  | { status: "already_running" };

export interface SendCieloSetpointInput {
  smartDeviceId: string;
  targetTemperatureF: number;
}

/** Test seams only (socket, delay). Never set by production callers. */
export interface CieloCommandDeps {
  createSocket?: CieloSocketFactory;
  sleep?: (ms: number) => Promise<void>;
}

const STALE_COMMAND_THRESHOLD_MS = 2 * 60 * 1000;
const STATE_UPDATE_TIMEOUT_MS = 12_000;
const READ_BACK_DELAY_MS = 3_000;

function parsePropertyMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The temporary allowlist: a CIELO thermostat whose MAC is in
 * CIELO_PROPERTY_MAP for the same property. Used by the page (to decide
 * whether to render the control) and re-checked inside the command.
 */
export function isCieloDeviceOnControlAllowlist(
  device: {
    provider: string;
    deviceType: string;
    externalDeviceId: string;
    propertyId: string;
  },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (device.provider !== "CIELO" || device.deviceType !== "THERMOSTAT") {
    return false;
  }
  const map = parsePropertyMap(env.CIELO_PROPERTY_MAP);
  return map[device.externalDeviceId] === device.propertyId;
}

function isRetired(metadata: Prisma.JsonValue): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).retiredAt === "string"
  );
}

export async function sendCieloSetpointCommand(
  actor: AuthContext,
  input: SendCieloSetpointInput,
  deps: CieloCommandDeps = {},
): Promise<CieloCommandResult> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const device = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    include: { property: true },
  });
  if (
    !device ||
    device.provider !== "CIELO" ||
    device.deviceType !== "THERMOSTAT"
  ) {
    return { status: "rejected", reason: "Cielo thermostat not found." };
  }
  if (isRetired(device.metadata)) {
    return { status: "rejected", reason: "This thermostat is retired." };
  }
  if (!device.property || device.property.deletedAt) {
    return {
      status: "rejected",
      reason: "This thermostat's property no longer exists.",
    };
  }
  if (!isCieloDeviceOnControlAllowlist(device)) {
    return {
      status: "rejected",
      reason:
        "This thermostat is not on the Cielo control allowlist (only the existing, confirmed mappings can be controlled).",
    };
  }

  await assertPermission(actor, "thermostats:manage", {
    propertyId: device.propertyId,
  });

  const targetF = input.targetTemperatureF;
  const command = { type: "SET_TEMPERATURE", targetF } as const;
  const audit = (
    result: "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "REJECTED",
    extra: Record<string, unknown> = {},
    errorDetail?: string,
  ) =>
    recordAudit({
      actorUserId: actor.userId,
      actorType: "USER",
      action: "smart_device.cielo_command",
      entityType: "SmartDevice",
      entityId: device.id,
      beforeState: {
        provider: "CIELO",
        propertyId: device.propertyId,
        metadata: device.metadata,
      } as Prisma.InputJsonValue,
      afterState: { command, result, ...extra } as Prisma.InputJsonValue,
      metadata: errorDetail
        ? ({ errorDetail } as Prisma.InputJsonValue)
        : undefined,
    });

  if (!Number.isInteger(targetF)) {
    await audit("REJECTED", { commandSent: false }, "Non-integer target.");
    return {
      status: "rejected",
      reason: "The temperature must be a whole number (°F).",
    };
  }

  const control = await readCieloControlSetting();
  if (!control.enabled) {
    await audit(
      "REJECTED",
      { commandSent: false },
      "Blocked: remote Cielo control is OFF (kill switch).",
    );
    return { status: "rejected", reason: CIELO_CONTROL_OFF_REASON };
  }

  const lock = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('device_command'), hashtext(${device.id})) AS locked
    `;
    if (!rows[0]?.locked) return { proceeding: false } as const;
    const current = await tx.smartDevice.findUniqueOrThrow({
      where: { id: device.id },
      select: { commandInProgressAt: true },
    });
    if (
      current.commandInProgressAt &&
      Date.now() - current.commandInProgressAt.getTime() <
        STALE_COMMAND_THRESHOLD_MS
    ) {
      return { proceeding: false } as const;
    }
    await tx.smartDevice.update({
      where: { id: device.id },
      data: { commandInProgressAt: new Date() },
    });
    return { proceeding: true } as const;
  });
  if (!lock.proceeding) return { status: "already_running" };

  // Set once a frame may have reached Cielo; from then on an unexpected
  // error can only ever be reported as AMBIGUOUS, never "nothing sent".
  let frameMayHaveBeenSent = false;

  try {
    const username = process.env.CIELO_USERNAME;
    const password = process.env.CIELO_PASSWORD;
    if (!username || !password) {
      await audit("REJECTED", { commandSent: false }, "Cielo not configured.");
      return { status: "rejected", reason: "Cielo isn't configured." };
    }
    const client = new CieloClient({ username, password });
    const session = await client.openControlSession();

    const live = await client.getControlSnapshot(
      session,
      device.externalDeviceId,
    );
    if (!live) {
      await audit(
        "REJECTED",
        { commandSent: false },
        "Device not returned by Cielo.",
      );
      return {
        status: "rejected",
        reason: "Cielo didn't return this thermostat; nothing was sent.",
      };
    }
    const validation = validateCieloSetpoint(live.snapshot, targetF);
    if (!validation.allowed) {
      await audit(
        "REJECTED",
        { commandSent: false, liveTargetF: live.snapshot.targetTemperatureF },
        validation.reason,
      );
      return { status: "rejected", reason: validation.reason };
    }

    const frame = buildCieloSetpointFrame(
      live.snapshot,
      session,
      targetF,
      Math.floor(Date.now() / 1000),
    );
    frameMayHaveBeenSent = true;
    const sent = await sendCieloFrameAndAwaitState({
      session,
      frame,
      macAddress: live.snapshot.macAddress,
      targetF,
      timeoutMs: STATE_UPDATE_TIMEOUT_MS,
      createSocket: deps.createSocket,
    });

    if (sent.sendState === "not_sent") {
      frameMayHaveBeenSent = false;
      await audit(
        "FAILED",
        { commandSent: false, previousTargetF: validation.currentTargetF },
        sent.error ?? "Connection to Cielo never opened.",
      );
      return {
        status: "failed",
        reason:
          "Couldn't connect to Cielo — nothing was sent to the thermostat. You can try again.",
      };
    }

    // Read back what Cielo reports now — never assume the command worked.
    let readBackTargetF: number | null = null;
    let readBackError: string | undefined;
    try {
      if (!sent.confirmedByStateUpdate) await sleep(READ_BACK_DELAY_MS);
      const after = await client.getControlSnapshot(
        session,
        device.externalDeviceId,
      );
      if (after) {
        readBackTargetF = after.snapshot.targetTemperatureF;
        await prisma.smartDevice.update({
          where: { id: device.id },
          data: {
            status: after.device.online ? "ONLINE" : "OFFLINE",
            lastSeenAt: after.device.online ? new Date() : null,
            metadata: toCieloSmartDeviceMetadata(
              after.device,
            ) as Prisma.InputJsonValue,
          },
        });
      }
    } catch (err) {
      readBackError = err instanceof Error ? err.message : String(err);
    }

    const confirmedBy = sent.confirmedByStateUpdate
      ? "state_update"
      : readBackTargetF === targetF
        ? "read_back"
        : null;
    const extra = {
      commandSent: true,
      sendState: sent.sendState,
      previousTargetF: validation.currentTargetF,
      stateUpdateSeen: sent.stateUpdateSeen,
      stateUpdateTargetF: sent.reportedTargetF,
      readBackTargetF,
      confirmedBy,
    };

    if (confirmedBy) {
      await audit("SUCCEEDED", extra);
      return { status: "succeeded", confirmedTargetF: targetF };
    }
    await audit(
      "AMBIGUOUS",
      extra,
      [sent.error, readBackError].filter(Boolean).join(" | ") || undefined,
    );
    return {
      status: "ambiguous",
      readBackTargetF,
      reason: `The command was sent, but Cielo hasn't confirmed ${targetF}°F${
        readBackTargetF !== null
          ? ` (it still reports ${readBackTargetF}°F)`
          : ""
      }. Check the thermostat before trying again.`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (frameMayHaveBeenSent) {
      await audit("AMBIGUOUS", { commandSent: true }, detail).catch(() => {});
      return {
        status: "ambiguous",
        readBackTargetF: null,
        reason:
          "Something went wrong after the command may have been sent. Check the thermostat before trying again.",
      };
    }
    await audit("FAILED", { commandSent: false }, detail);
    return {
      status: "failed",
      reason:
        "Couldn't reach Cielo — nothing was sent to the thermostat. Try again shortly.",
    };
  } finally {
    await prisma.smartDevice.update({
      where: { id: device.id },
      data: { commandInProgressAt: null },
    });
  }
}
