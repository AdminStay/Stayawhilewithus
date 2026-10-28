import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import {
  NestClient,
  NestOAuthRefreshError,
  computeNestDeviceCapabilities,
  executeNestThermostatCommand,
  validateNestCommand,
  type NestDevice,
  type NestThermostatCommand,
} from "@stayw/integrations/nest";

import {
  checkNestCommandSafety,
  isNestCommandConfirmed,
} from "../lib/nest-command-safety";

import { toSmartDeviceMetadata } from "./provider-devices.service";
import {
  readThermostatControlSetting,
  THERMOSTAT_CONTROL_OFF_REASON,
} from "./thermostat-control-settings.service";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * "success" = Nest accepted the command AND a read-back reports the
 * requested state. "unverified" = the command may have reached Nest (or
 * Nest accepted it) but the requested state couldn't be confirmed — it may
 * or may not have changed. "failure" = nothing was applied: either nothing
 * was sent, or Nest refused the command with a 4xx.
 */
export type NestCommandResult =
  | { status: "success" }
  | { status: "rejected"; reason: string }
  | { status: "already_running" }
  | { status: "failure"; reason: string }
  | { status: "unverified"; reason: string };

export interface SendNestThermostatCommandInput {
  smartDeviceId: string;
  command: NestThermostatCommand;
}

/** Test seam only (read-back delay). Never set by production callers. */
export interface NestCommandDeps {
  sleep?: (ms: number) => Promise<void>;
}

/** Wait before the second read-back when the first doesn't show the change yet. */
const READ_BACK_DELAY_MS = 3_000;

const UNVERIFIED_NO_ANSWER_REASON =
  "Nest didn't answer the command, so it may or may not have been applied. Check the thermostat before trying again.";
const UNVERIFIED_NOT_REPORTED_REASON =
  "Nest accepted the command, but the thermostat doesn't report the new setting yet. Check the thermostat before trying again.";

/**
 * Whether a command error means Nest certainly did not apply it: an OAuth
 * refresh failure (raised before the POST) or a 4xx answer (Nest refused
 * it). A 5xx, timeout or network error may have reached the thermostat.
 */
function isDefinitelyNotApplied(err: unknown): boolean {
  if (err instanceof NestOAuthRefreshError) return true;
  return (
    err instanceof HttpRequestError && err.status >= 400 && err.status < 500
  );
}

/**
 * A stale in-progress marker (older than this) self-heals rather than
 * permanently locking a device out. Derived, not guessed: a real command
 * now makes up to 4 sequential real HTTP calls (OAuth token refresh if
 * not cached, a fresh capability GET, the command POST, a confirmation
 * GET) — using the same worst-case-per-call math as
 * STALE_RUNNING_THRESHOLD_MS in integrations.service.ts (HttpClient: 10s
 * timeout x up to 3 attempts with backoff ~= 30.75s per call), that's
 * ~123s worst case. 5 minutes gives comfortable margin over that without
 * leaving a genuinely crashed request locked out for long.
 */
const STALE_COMMAND_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Translates a raw provider/HTTP error into a message safe to show a user
 * — never the raw error (which could carry internal Google details). Full
 * detail still reaches the audit log's metadata field (server-side only,
 * never rendered to the client), so nothing useful for debugging is lost.
 */
function translateNestCommandError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("401") || message.includes("403")) {
    return "Nest authorization failed — the connection may need to be re-authorized.";
  }
  if (message.includes("404")) {
    return "This device is no longer visible to the connected Nest account.";
  }
  if (message.includes("429")) {
    return "Too many requests to Nest right now — try again shortly.";
  }
  return "The thermostat command could not be completed. Try again, and contact support if this persists.";
}

function getNestClientFromEnv(): NestClient {
  const clientId = process.env.NEST_CLIENT_ID;
  const clientSecret = process.env.NEST_CLIENT_SECRET;
  const projectId = process.env.NEST_PROJECT_ID;
  const refreshToken = process.env.NEST_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !projectId || !refreshToken) {
    throw new Error(
      "Nest isn't configured — set NEST_CLIENT_ID/NEST_CLIENT_SECRET/NEST_PROJECT_ID/NEST_REFRESH_TOKEN.",
    );
  }
  return new NestClient({ clientId, clientSecret, projectId, refreshToken });
}

/**
 * Real, sole write path for Nest thermostat commands. Every safety
 * requirement lives here, in this order:
 *
 *   1. Mapping chain intact: ProviderDevice mapped -> SmartDevice exists
 *      -> Property exists (not soft-deleted) -> ProviderDevice enabled.
 *      Rejected before RBAC is even checked — there's no property to
 *      scope the permission check to otherwise, and an unmapped device
 *      can never receive a command no matter who's asking.
 *   2. Property-scoped RBAC via `thermostats:manage` — a resource
 *      dedicated to live physical-device commands, deliberately separate
 *      from `smart_devices:update` (sync/mapping, comparatively harmless)
 *      so granting mapping access never implicitly grants device control.
 *      Only `admin` has it today (via the `*` wildcard); no other role
 *      was extended it.
 *   3. Duplicate-command prevention: advisory-lock-guarded, and the
 *      in-progress marker is read AND written inside the same locked
 *      transaction (never the pre-fetched outer `smartDevice`) — see the
 *      transaction below for why that matters.
 *   4. Capability refresh: a fresh, real GET against Nest — never the
 *      stored ProviderDevice.rawMetadata snapshot from a prior discovery
 *      run, which could be arbitrarily old — is what validateNestCommand()
 *      actually validates against. Includes the Eco-mode check for
 *      setpoint commands, numeric-finite guard, and (for SET_RANGE)
 *      Google's own documented "cool must exceed heat" rule.
 *      Then checkNestCommandSafety() on the same fresh read (2026-10-28):
 *      ONLINE, setpoints inside 60–85 °F, at most 5 °F from the current
 *      setpoint, not a no-op.
 *   5. The real command — a single attempt, never retried (NestClient) —
 *      then a fresh GET (and one more after READ_BACK_DELAY_MS if the
 *      first doesn't show it yet) that must report the requested state.
 *      SmartDevice.metadata is only ever updated with that read, never a
 *      value this function guessed the command would produce.
 *   6. Audit logging (actor/property/device/provider/command/result) on
 *      every outcome from step 2 onward: SUCCEEDED (confirmed), FAILED
 *      (nothing applied), UNVERIFIED (may or may not have applied),
 *      REJECTED; translated errors only ever reach the caller, full detail
 *      stays server-side in the audit log.
 */
export async function sendNestThermostatCommand(
  actor: AuthContext,
  input: SendNestThermostatCommandInput,
  deps: NestCommandDeps = {},
): Promise<NestCommandResult> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const smartDevice = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    include: { providerDevice: true, property: true },
  });

  if (
    !smartDevice ||
    smartDevice.provider !== "NEST" ||
    smartDevice.deviceType !== "THERMOSTAT"
  ) {
    return { status: "rejected", reason: "Device not found." };
  }
  if (!smartDevice.providerDevice || !smartDevice.providerDevice.enabled) {
    return {
      status: "rejected",
      reason:
        "This device is not enabled for control — map and enable it from Discovered Devices first.",
    };
  }
  if (!smartDevice.providerDevice.propertyId) {
    return {
      status: "rejected",
      reason: "This device is not mapped to a property.",
    };
  }
  // The mapping must point at exactly this device and property — never
  // control a thermostat whose mapping and device record disagree.
  if (
    smartDevice.providerDevice.propertyId !== smartDevice.propertyId ||
    smartDevice.providerDevice.externalDeviceId !== smartDevice.externalDeviceId
  ) {
    return {
      status: "rejected",
      reason:
        "This device's mapping doesn't match its property. Fix the mapping in Discovered Devices first.",
    };
  }
  if (!smartDevice.property || smartDevice.property.deletedAt) {
    return {
      status: "rejected",
      reason: "This device's property no longer exists.",
    };
  }

  await assertPermission(actor, "thermostats:manage", {
    propertyId: smartDevice.propertyId,
  });

  // Global kill switch (2026-09-27, Nest Phase 1), default OFF: refused
  // here, before the duplicate-command lock, before the Nest client is even
  // built and before any Google request (capability read or command).
  const control = await readThermostatControlSetting();
  if (!control.enabled) {
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId: smartDevice.propertyId,
      command: input.command,
      previousMetadata: smartDevice.metadata,
      result: "REJECTED",
      errorDetail: "Blocked: remote thermostat control is OFF (kill switch).",
    });
    return { status: "rejected", reason: THERMOSTAT_CONTROL_OFF_REASON };
  }

  // Atomic duplicate-command guard: acquire the advisory lock, THEN read
  // the current marker from inside the same transaction (never the
  // pre-fetched `smartDevice` above, which could already be stale by the
  // time we get here) — this is what actually makes the check-then-act
  // atomic, not just the lock by itself. The lock only needs to be held
  // for this short read-check-write, not for the real HTTP calls below
  // (which happen after this transaction commits and releases it) —
  // correctness comes from every concurrent attempt re-reading the
  // truly-current committed state inside its own lock, not from holding
  // one lock open across a slow network call.
  const lockResult = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('device_command'), hashtext(${smartDevice.id})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      return { proceeding: false } as const;
    }

    const current = await tx.smartDevice.findUniqueOrThrow({
      where: { id: smartDevice.id },
      select: { commandInProgressAt: true },
    });

    if (current.commandInProgressAt) {
      const ageMs = Date.now() - current.commandInProgressAt.getTime();
      if (ageMs < STALE_COMMAND_THRESHOLD_MS) {
        return { proceeding: false } as const;
      }
    }

    await tx.smartDevice.update({
      where: { id: smartDevice.id },
      data: { commandInProgressAt: new Date() },
    });
    return { proceeding: true } as const;
  });

  if (!lockResult.proceeding) {
    return { status: "already_running" };
  }

  const previousMetadata = smartDevice.metadata;
  const propertyId = smartDevice.propertyId;
  const externalDeviceId = smartDevice.providerDevice.externalDeviceId;

  // Set once the command POST may have reached Nest; from then on an
  // unexpected error is reported as UNVERIFIED, never "nothing sent".
  let commandMayHaveBeenSent = false;

  try {
    const client = getNestClientFromEnv();

    // Capability refresh — real, current traits, not the stored snapshot.
    const fresh = await client.getDevice(externalDeviceId);
    await prisma.providerDevice.update({
      where: { smartDeviceId: smartDevice.id },
      data: { rawMetadata: fresh as unknown as Prisma.InputJsonValue },
    });

    const freshCapabilities = computeNestDeviceCapabilities(fresh.rawTraits);
    const validation = validateNestCommand(input.command, freshCapabilities);
    const safety = validation.allowed
      ? checkNestCommandSafety(input.command, fresh)
      : ({
          allowed: false,
          reason: validation.reason ?? "Not supported.",
        } as const);
    if (!safety.allowed) {
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        command: input.command,
        previousMetadata,
        result: "REJECTED",
        outcome: { commandSent: false },
        errorDetail: safety.reason,
      });
      return { status: "rejected", reason: safety.reason };
    }

    commandMayHaveBeenSent = true;
    try {
      await executeNestThermostatCommand(
        client,
        externalDeviceId,
        input.command,
      );
    } catch (err) {
      const errorDetail = err instanceof Error ? err.message : String(err);
      if (isDefinitelyNotApplied(err)) {
        await recordAuditSafely({
          actor,
          smartDeviceId: smartDevice.id,
          propertyId,
          command: input.command,
          previousMetadata,
          result: "FAILED",
          outcome: { commandSent: true, providerAccepted: false },
          errorDetail,
        });
        return { status: "failure", reason: translateNestCommandError(err) };
      }
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        command: input.command,
        previousMetadata,
        result: "UNVERIFIED",
        outcome: { commandSent: true, providerAccepted: null },
        errorDetail,
      });
      return { status: "unverified", reason: UNVERIFIED_NO_ANSWER_REASON };
    }

    // Read back what Nest reports now — never assume the command produced
    // exactly the requested value. Nest may take a moment to reflect it,
    // so a read that doesn't show it yet gets exactly one more try.
    let readBack: NestDevice | null = null;
    let readBackError: string | undefined;
    try {
      readBack = await client.getDevice(externalDeviceId);
      if (!isNestCommandConfirmed(input.command, readBack)) {
        await sleep(READ_BACK_DELAY_MS);
        readBack = await client.getDevice(externalDeviceId);
      }
    } catch (err) {
      readBackError = err instanceof Error ? err.message : String(err);
    }

    let confirmedMetadata: Record<string, unknown> | undefined;
    if (readBack) {
      // This read just happened, so — unlike setProviderDeviceEnabled()'s
      // reuse of an old discovery snapshot — stamping "now" is honest.
      confirmedMetadata = toSmartDeviceMetadata(readBack, new Date());
      await prisma.smartDevice.update({
        where: { id: smartDevice.id },
        data: { metadata: confirmedMetadata as Prisma.InputJsonValue },
      });
      await prisma.providerDevice.update({
        where: { smartDeviceId: smartDevice.id },
        data: { rawMetadata: readBack as unknown as Prisma.InputJsonValue },
      });
    }

    const verified =
      readBack !== null && isNestCommandConfirmed(input.command, readBack);
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      command: input.command,
      previousMetadata,
      result: verified ? "SUCCEEDED" : "UNVERIFIED",
      outcome: { commandSent: true, providerAccepted: true, verified },
      confirmedMetadata,
      errorDetail: readBackError,
    });
    return verified
      ? { status: "success" }
      : { status: "unverified", reason: UNVERIFIED_NOT_REPORTED_REASON };
  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    if (commandMayHaveBeenSent) {
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        command: input.command,
        previousMetadata,
        result: "UNVERIFIED",
        outcome: { commandSent: true, providerAccepted: null },
        errorDetail,
      }).catch(() => {});
      return { status: "unverified", reason: UNVERIFIED_NO_ANSWER_REASON };
    }
    const safeMessage = translateNestCommandError(err);
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      command: input.command,
      previousMetadata,
      result: "FAILED",
      outcome: { commandSent: false },
      errorDetail,
    });
    return { status: "failure", reason: safeMessage };
  } finally {
    await prisma.smartDevice.update({
      where: { id: smartDevice.id },
      data: { commandInProgressAt: null },
    });
  }
}

/**
 * Single audit-write call site for this file — actor/property/device/
 * provider/command/result/timestamp on every outcome from RBAC onward
 * (REJECTED covers a fresh-capability-check rejection; unmapped/disabled
 * rejections above never reach here — no property/permission context to
 * scope a meaningful entry to). `errorDetail` (server-diagnostic only,
 * e.g. the real HTTP status or rejection reason) goes in `metadata`,
 * never in anything a client response returns. For a successful command,
 * `afterState` holds the *requested* command plus the *confirmed*
 * resulting metadata read back from Nest — never a guessed value. Only
 * the requested temperature/mode is ever stored, never a PIN or secret
 * (this file doesn't handle those) — recordAudit() itself never receives
 * OAuth tokens/secrets, since none of this file ever holds one
 * (NestClient keeps its access token private, per client.ts). `outcome`
 * (2026-10-28) says whether the command was sent, whether Nest accepted
 * it, and whether the read-back confirmed it.
 */
async function recordAuditSafely(args: {
  actor: AuthContext;
  smartDeviceId: string;
  propertyId: string;
  command: NestThermostatCommand;
  previousMetadata: Prisma.JsonValue;
  result: "SUCCEEDED" | "FAILED" | "REJECTED" | "UNVERIFIED";
  outcome?: {
    commandSent: boolean;
    providerAccepted?: boolean | null;
    verified?: boolean;
  };
  confirmedMetadata?: Record<string, unknown>;
  errorDetail?: string;
}): Promise<void> {
  await recordAudit({
    actorUserId: args.actor.userId,
    actorType: "USER",
    action: "smart_device.nest_command",
    entityType: "SmartDevice",
    entityId: args.smartDeviceId,
    beforeState: {
      provider: "NEST",
      propertyId: args.propertyId,
      metadata: args.previousMetadata,
    } as Prisma.InputJsonValue,
    afterState: {
      command: args.command,
      result: args.result,
      ...args.outcome,
      ...(args.confirmedMetadata && {
        confirmedMetadata: args.confirmedMetadata,
      }),
    } as Prisma.InputJsonValue,
    metadata: args.errorDetail
      ? ({ errorDetail: args.errorDetail } as Prisma.InputJsonValue)
      : undefined,
  });
}
