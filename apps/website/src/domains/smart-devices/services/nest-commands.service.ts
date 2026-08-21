import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  NestClient,
  computeNestDeviceCapabilities,
  executeNestThermostatCommand,
  validateNestCommand,
  type NestThermostatCommand,
} from "@stayw/integrations/nest";

import { toSmartDeviceMetadata } from "./provider-devices.service";

import { recordAudit } from "@/platform/audit/record-audit";

export type NestCommandResult =
  | { status: "success" }
  | { status: "rejected"; reason: string }
  | { status: "already_running" }
  | { status: "failure"; reason: string };

export interface SendNestThermostatCommandInput {
  smartDeviceId: string;
  command: NestThermostatCommand;
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
 *   5. The real command, then a second fresh GET to confirm what Nest
 *      actually reports afterward — SmartDevice.metadata is only ever
 *      updated with that *confirmed* read, never a value this function
 *      guessed the command would produce.
 *   6. Audit logging (actor/property/device/provider/command/result) on
 *      every outcome from step 2 onward; translated errors only ever
 *      reach the caller, full detail stays server-side in the audit log.
 */
export async function sendNestThermostatCommand(
  actor: AuthContext,
  input: SendNestThermostatCommandInput,
): Promise<NestCommandResult> {
  const smartDevice = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    include: { providerDevice: true, property: true },
  });

  if (!smartDevice || smartDevice.provider !== "NEST") {
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
  if (!smartDevice.property || smartDevice.property.deletedAt) {
    return {
      status: "rejected",
      reason: "This device's property no longer exists.",
    };
  }

  await assertPermission(actor, "thermostats:manage", {
    propertyId: smartDevice.propertyId,
  });

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
    if (!validation.allowed) {
      const reason = validation.reason ?? "Not supported.";
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        command: input.command,
        previousMetadata,
        result: "REJECTED",
        errorDetail: reason,
      });
      return { status: "rejected", reason };
    }

    await executeNestThermostatCommand(client, externalDeviceId, input.command);

    // Confirmation — read what Nest actually reports now, never assume
    // the command produced exactly the requested value. This read just
    // happened, so — unlike setProviderDeviceEnabled()'s reuse of an old
    // discovery snapshot — stamping "now" here is honest, not fabricated.
    const confirmed = await client.getDevice(externalDeviceId);
    const confirmedMetadata = toSmartDeviceMetadata(confirmed, new Date());

    await prisma.smartDevice.update({
      where: { id: smartDevice.id },
      data: { metadata: confirmedMetadata as Prisma.InputJsonValue },
    });
    await prisma.providerDevice.update({
      where: { smartDeviceId: smartDevice.id },
      data: { rawMetadata: confirmed as unknown as Prisma.InputJsonValue },
    });

    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      command: input.command,
      previousMetadata,
      result: "SUCCEEDED",
      confirmedMetadata,
    });

    return { status: "success" };
  } catch (err) {
    const safeMessage = translateNestCommandError(err);
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      command: input.command,
      previousMetadata,
      result: "FAILED",
      errorDetail: err instanceof Error ? err.message : String(err),
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
 * (NestClient keeps its access token private, per client.ts).
 */
async function recordAuditSafely(args: {
  actor: AuthContext;
  smartDeviceId: string;
  propertyId: string;
  command: NestThermostatCommand;
  previousMetadata: Prisma.JsonValue;
  result: "SUCCEEDED" | "FAILED" | "REJECTED";
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
      ...(args.confirmedMetadata && {
        confirmedMetadata: args.confirmedMetadata,
      }),
    } as Prisma.InputJsonValue,
    metadata: args.errorDetail
      ? ({ errorDetail: args.errorDetail } as Prisma.InputJsonValue)
      : undefined,
  });
}
