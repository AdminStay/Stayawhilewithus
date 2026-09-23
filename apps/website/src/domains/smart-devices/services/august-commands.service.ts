import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  AugustClient,
  isAugustBrand,
  type AugustLockOperation,
} from "@stayw/integrations/august";
import { HttpRequestError } from "@stayw/integrations/core";

import { mergeAugustLockMetadata } from "./lock-refresh.service";

import { recordAudit } from "@/platform/audit/record-audit";

export type AugustLockCommandResult =
  | { status: "success"; lockState: string | null }
  | { status: "rejected"; reason: string }
  | { status: "already_running" }
  | { status: "failure"; reason: string };

export interface SendAugustLockCommandInput {
  smartDeviceId: string;
  operation: AugustLockOperation;
}

/**
 * Same reasoning/derivation class as nest-commands.service.ts's
 * STALE_COMMAND_THRESHOLD_MS — a real command here makes up to 3 sequential
 * real HTTP calls (a fresh getLockDetail() capability-refresh read, the
 * capabilities GET, the PUT command itself, then a second getLockDetail()
 * confirmation read — 4 total), each bounded by HttpClient's own 10s
 * timeout x up to 3 attempts with backoff. 5 minutes gives comfortable
 * margin over that worst case without leaving a genuinely crashed request
 * locked out for long.
 */
const STALE_COMMAND_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * The Production physical-execution safety gate (2026-09-18) — see
 * .env.example's own doc comment on AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS.
 * Malformed or missing means "nothing allowed," same fail-closed convention
 * as every other JSON-array env var in this codebase
 * (AUGUST_EXCLUDED_LOCK_IDS), never "allow everything."
 */
function parseTestDeviceAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * UX-only read of the exact same real, live `AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS`
 * gate `sendAugustLockCommand()` itself enforces (step 5 in its own doc
 * comment) — never a second, separate allowlist, never a relaxed copy.
 * Exists so the dashboard can decide whether to even show Lock/Unlock as
 * available BEFORE a real command is attempted, rather than only learning
 * "Live control isn't enabled for this lock yet" after a full confirm
 * dialog round trip. Recomputed fresh on every call (no caching) so it's
 * never stale relative to the real env var. This function makes no
 * database call, no provider call, and cannot itself allow or deny a real
 * command — sendAugustLockCommand() re-checks this exact same env var
 * unconditionally regardless of what this returns.
 */
export function isAugustLockCommandTestDevice(
  externalDeviceId: string,
): boolean {
  return parseTestDeviceAllowlist(
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS,
  ).has(externalDeviceId);
}

/** What LocksList shows in place of the Lock/Unlock controls when they're not currently eligible — never rendered when `eligible` is true. */
export interface LockControlEligibility {
  eligible: boolean;
  reason: string | null;
}

/** Exact same copy sendAugustLockCommand() itself returns when providerDevice is missing/disabled — reused, not paraphrased, so a pre-click and a post-click message never disagree. */
const NOT_ENABLED_FOR_CONTROL_REASON =
  "This device is not enabled for control — map and enable it from Discovered Devices first.";

/** Exact same copy sendAugustLockCommand() itself returns for the allowlist gate — reused, not paraphrased. */
const NOT_IN_TEST_ALLOWLIST_REASON =
  "Live control isn't enabled for this lock yet.";

/** Deliberately generic and safe — never the raw stored `metadata.errorDetail` (that field is written for internal/audit inspection, not general operator-facing display; see recordAuditSafely()'s own doc comment). */
const LAST_ATTEMPT_FAILED_REASON =
  "The last real attempt to control this lock did not succeed. Contact an admin before trying again.";

/**
 * The "not yet positively verified" reason — covers both "no real command
 * attempt exists at all" and "the only real attempt on record was a
 * REJECTED pre-flight refusal, never a real provider-level command." Never
 * a failure message (nothing is known to be broken), and never treated as
 * eligible either — see computeLockControlEligibility()'s own doc comment
 * for why absence of failure evidence is not proof of operability.
 */
const NOT_YET_VERIFIED_REASON =
  "Remote control has not been verified for this lock yet.";

/**
 * Combines the real signals above into one UX decision — never "mapped +
 * enabled alone," and never "no evidence of failure" either. StayWhile's
 * requirement (2026-09-23 correction) is fail-closed and POSITIVE: a lock
 * is only ever shown as controllable when real remote-command operability
 * for that exact device has already been demonstrated — a real, on-record
 * `SUCCEEDED` outcome from an actual `sendAugustLockCommand()` attempt
 * (e.g. Aqua Palm's real controlled test). Every other case defaults to
 * disabled:
 *
 *   - no real, enabled ProviderDevice mapping (`externalDeviceId` null) —
 *     disabled (nothing to even check).
 *   - not in the real AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS allowlist —
 *     disabled (the command would be refused before ever reaching August).
 *   - most recent real attempt `FAILED` (e.g. MJ - Front Door's real
 *     `403`) — disabled, and MUST NOT be inferred as "fixed" by mere
 *     allowlist membership or the passage of time; only a later real
 *     `SUCCEEDED` attempt (not made by this function or this UI) would
 *     change that.
 *   - no real attempt on record at all — disabled/unverified. An
 *     allowlisted-but-never-tested lock is NOT presented as ready; absence
 *     of failure evidence is not proof of operability.
 *   - most recent real attempt `REJECTED` only (StayWhile's own pre-flight
 *     refusal — mapping/capability/allowlist — never reached August at
 *     all) — disabled/unverified. A REJECTED record is never treated as
 *     equivalent to, or a step toward, a real SUCCEEDED outcome.
 *
 * This function makes no provider or database call, and — per explicit
 * instruction — never performs or triggers a real command to establish
 * verification; the only source of truth is already-existing AuditLog
 * history the caller supplies.
 */
export function computeLockControlEligibility(
  externalDeviceId: string | null,
  lastOutcome: AugustLockCommandRecordedOutcome | undefined,
): LockControlEligibility {
  if (externalDeviceId === null) {
    return { eligible: false, reason: NOT_ENABLED_FOR_CONTROL_REASON };
  }
  if (!isAugustLockCommandTestDevice(externalDeviceId)) {
    return { eligible: false, reason: NOT_IN_TEST_ALLOWLIST_REASON };
  }
  if (lastOutcome === "SUCCEEDED") {
    return { eligible: true, reason: null };
  }
  if (lastOutcome === "FAILED") {
    return { eligible: false, reason: LAST_ATTEMPT_FAILED_REASON };
  }
  // `undefined` (no real attempt on record) or `"REJECTED"` (a real attempt
  // was refused before ever reaching August) — neither is proof of real
  // remote-command operability.
  return { eligible: false, reason: NOT_YET_VERIFIED_REASON };
}

/**
 * A 403 alone is ambiguous: August returns it both for a genuinely
 * unauthorized/expired connection AND for a specific device/operation it
 * refuses for other reasons (2026-09-18 incident: MJ - Front Door's
 * remote-operate LOCK returned 403 while the account's other locks and
 * MJ's own read-only status/capability calls kept working fine on the same
 * credential — see august-commands investigation notes). Collapsing every
 * 403 into "re-authorize the connection" is actively misleading in that
 * case: there is nothing to re-authorize account-wide, and telling an
 * operator to do so sends them chasing the wrong fix. Only escalate to the
 * account-wide message when the provider's own error body says something
 * that actually sounds like a credential/session problem; otherwise report
 * this as a device-specific refusal.
 */
const ACCOUNT_AUTH_HINT_PATTERN = /token|credential|unauthor|session|re.?auth/i;

/**
 * Translates a raw provider/HTTP error into a message safe to show a user —
 * never the raw error (nor the provider's raw error body — only its two
 * extracted, already-sanitized fields, see HttpRequestError). Full detail
 * still reaches the audit log's metadata field (server-side only), same
 * discipline as translateNestCommandError() in nest-commands.service.ts.
 * Status codes verified against yalexs's actual exception handling
 * (2026-09-18): 422 = bridge offline, 423 = bridge busy with another
 * operation, 408 = bridge didn't respond in time.
 */
function translateAugustCommandError(err: unknown): string {
  if (err instanceof HttpRequestError) {
    switch (err.status) {
      case 401:
        return "August authorization failed — the connection may need to be re-authorized.";
      case 403: {
        const hint = `${err.providerErrorCode ?? ""} ${err.providerMessage ?? ""}`;
        if (ACCOUNT_AUTH_HINT_PATTERN.test(hint)) {
          return "August authorization failed — the connection may need to be re-authorized.";
        }
        return "August refused the command for this specific lock. The August connection is still working for read access, so this does not necessarily mean the account needs to be re-authorized.";
      }
      case 404:
        return "This device is no longer visible to the connected August account.";
      case 422:
        return "This lock's bridge is currently offline — the command could not be delivered.";
      case 423:
        return "This lock's bridge is busy with another operation right now — try again shortly.";
      case 408:
        return "This lock's bridge did not respond in time — try again shortly.";
      default:
        return "The lock command could not be completed. Try again, and contact support if this persists.";
    }
  }

  // Fallback for anything that isn't an HttpRequestError (e.g. a network
  // failure that never reached HttpClient's response handling at all, or a
  // plain Error in a test double) — same string-matching this function
  // always used before HttpRequestError existed.
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("401") || message.includes("403")) {
    return "August authorization failed — the connection may need to be re-authorized.";
  }
  if (message.includes("404")) {
    return "This device is no longer visible to the connected August account.";
  }
  if (message.includes("422")) {
    return "This lock's bridge is currently offline — the command could not be delivered.";
  }
  if (message.includes("423")) {
    return "This lock's bridge is busy with another operation right now — try again shortly.";
  }
  if (message.includes("408")) {
    return "This lock's bridge did not respond in time — try again shortly.";
  }
  return "The lock command could not be completed. Try again, and contact support if this persists.";
}

function getAugustClientFromEnv(): AugustClient {
  const identifier = process.env.AUGUST_IDENTIFIER;
  const installId = process.env.AUGUST_INSTALL_ID;
  const accessToken = process.env.AUGUST_ACCESS_TOKEN;
  const brand = process.env.AUGUST_BRAND;
  if (!identifier || !installId || !accessToken) {
    throw new Error(
      "August isn't configured — set AUGUST_IDENTIFIER/AUGUST_INSTALL_ID/AUGUST_ACCESS_TOKEN.",
    );
  }
  return new AugustClient({
    identifier,
    installId,
    accessToken,
    brand: brand && isAugustBrand(brand) ? brand : "august",
  });
}

/**
 * Real, sole write path for August lock/unlock/unlatch commands — the
 * lock-control equivalent of sendNestThermostatCommand()
 * (nest-commands.service.ts), same order of safety checks, deliberately
 * mirrored rather than redesigned:
 *
 *   1. Mapping chain intact: ProviderDevice mapped -> SmartDevice exists ->
 *      Property exists (not soft-deleted) -> ProviderDevice enabled.
 *      Rejected before RBAC is even checked — an unmapped/disabled device
 *      can never receive a command no matter who's asking, and there's no
 *      property to scope the permission check to otherwise.
 *   2. Property-scoped RBAC via `locks:manage` — deliberately separate
 *      from `smart_devices:update` (monitoring/mapping, comparatively
 *      harmless) so granting mapping access never implicitly grants
 *      physical lock control. Only `admin` has it today (via the `*`
 *      wildcard); no other role was extended it.
 *   3. Duplicate-command prevention: advisory-lock-guarded, in-progress
 *      marker read AND written inside the same locked transaction.
 *   4. Fresh capability refresh: a real getLockDetail() + getLockCapabilities()
 *      pair against August right now — never the stored
 *      ProviderDevice.rawMetadata snapshot, which could be arbitrarily old.
 *      A lock with no reported serialNumber, or whose capabilities don't
 *      confirm the requested operation, is rejected here — never assumed
 *      supported.
 *   5. PRODUCTION SAFETY GATE — the target's exact externalDeviceId must
 *      appear in AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS. This is checked AFTER
 *      every other real check has already passed (so a rejection here
 *      never masks a genuine mapping/RBAC/capability problem as "just not
 *      enabled yet"), and BEFORE any command is sent.
 *   6. The real command (PUT /remoteoperate/.../{lock|unlock|unlatch}, the
 *      synchronous variant — see AugustClient.lock()/unlock()/unlatch()'s
 *      own doc comments), then a second fresh getLockDetail() to confirm
 *      what August actually reports afterward. SmartDevice.metadata/status
 *      is only ever updated with that *confirmed* read, never a value this
 *      function guessed the command would produce — identical discipline
 *      to sendNestThermostatCommand()'s confirmation read.
 *   7. Audit logging on every outcome from step 2 onward.
 *
 * Never derives a target from a property/lock name, never falls back to
 * another lock if the requested one is unavailable, never fuzzy-matches —
 * `input.smartDeviceId` -> that exact row's `providerDevice.externalDeviceId`
 * is the only path from request to provider call, with no branch anywhere
 * that could substitute a different device.
 */
export async function sendAugustLockCommand(
  actor: AuthContext,
  input: SendAugustLockCommandInput,
): Promise<AugustLockCommandResult> {
  const smartDevice = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    include: { providerDevice: true, property: true },
  });

  if (!smartDevice || smartDevice.provider !== "AUGUST") {
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

  await assertPermission(actor, "locks:manage", {
    propertyId: smartDevice.propertyId,
  });

  // Atomic duplicate-command guard — identical shape to
  // sendNestThermostatCommand()'s: acquire the advisory lock, THEN read the
  // current marker from inside the same transaction (never the pre-fetched
  // `smartDevice` above, which could already be stale by the time we get
  // here).
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
    const client = getAugustClientFromEnv();

    // Fresh capability refresh — never the stored snapshot.
    const freshDetail = await client.getLockDetail(externalDeviceId);
    await prisma.providerDevice.update({
      where: { smartDeviceId: smartDevice.id },
      data: { rawMetadata: freshDetail as unknown as Prisma.InputJsonValue },
    });

    if (!freshDetail.serialNumber) {
      const reason =
        "This lock's capability could not be verified right now (no serial number reported) — command refused.";
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "REJECTED",
        errorDetail: reason,
      });
      return { status: "rejected", reason };
    }

    const capabilities = await client.getLockCapabilities(
      freshDetail.serialNumber,
    );
    const supported =
      input.operation === "LOCK"
        ? capabilities.lock
        : input.operation === "UNLOCK"
          ? capabilities.unlock
          : capabilities.unlatch;

    if (!supported) {
      const reason = `This lock does not support ${input.operation.toLowerCase()}.`;
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "REJECTED",
        errorDetail: reason,
      });
      return { status: "rejected", reason };
    }

    // PRODUCTION SAFETY GATE — checked after every real check has passed,
    // before any command is sent. Ships fail-closed (empty allowlist).
    const allowlist = parseTestDeviceAllowlist(
      process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS,
    );
    if (!allowlist.has(externalDeviceId)) {
      const reason = "Live control isn't enabled for this lock yet.";
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "REJECTED",
        errorDetail:
          "Blocked by AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS allowlist (device not present).",
      });
      return { status: "rejected", reason };
    }

    // The real command.
    if (input.operation === "LOCK") {
      await client.lock(externalDeviceId);
    } else if (input.operation === "UNLOCK") {
      await client.unlock(externalDeviceId);
    } else {
      await client.unlatch(externalDeviceId);
    }

    // Confirmation — read what August actually reports now, never assume
    // the command produced exactly the requested state.
    const confirmed = await client.getLockDetail(externalDeviceId);
    // Merged onto previousMetadata (captured above, before this command
    // ever ran) rather than replaced wholesale (2026-09-23 release-review
    // Fix 4) — this write is structurally unreachable for a currently
    // retired device today (the `providerDevice.enabled` check earlier in
    // this same function already rejects both a disabled ProviderDevice-
    // backed retirement and a legacy no-ProviderDevice one), but that
    // invariant must not depend on a future developer remembering that an
    // unrelated command guard happens to protect metadata — the write
    // itself is now safe on its own terms, the same general merge as
    // Fix 1/2/3 (mergeAugustLockMetadata, lock-refresh.service.ts), not a
    // retiredAt-specific carve-out. Every existing command guard (enabled/
    // mapping/property/capability/allowlist/positive-verification) above
    // this point is unchanged.
    const confirmedMetadata = mergeAugustLockMetadata(
      (previousMetadata as Record<string, unknown> | null) ?? {},
      {
        batteryLevel: confirmed.batteryLevel,
        lockState: confirmed.lockState,
        telemetryUpdatedAt: confirmed.telemetryUpdatedAt,
      },
    );

    await prisma.smartDevice.update({
      where: { id: smartDevice.id },
      data: {
        status: confirmed.connectivity,
        metadata: confirmedMetadata as Prisma.InputJsonValue,
        lastSeenAt: confirmed.seenAt ? new Date(confirmed.seenAt) : null,
      },
    });
    await prisma.providerDevice.update({
      where: { smartDeviceId: smartDevice.id },
      data: {
        connectivityStatus: confirmed.connectivity,
        rawMetadata: confirmed as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
    });

    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      operation: input.operation,
      previousMetadata,
      result: "SUCCEEDED",
      confirmedLockState: confirmed.lockState,
    });

    return { status: "success", lockState: confirmed.lockState };
  } catch (err) {
    const safeMessage = translateAugustCommandError(err);
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      operation: input.operation,
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
 * provider/operation/result/timestamp on every outcome from RBAC onward.
 * Never stores a credential, PIN, or access code (this file never handles
 * those — PIN management is explicitly out of scope for this phase).
 */
async function recordAuditSafely(args: {
  actor: AuthContext;
  smartDeviceId: string;
  propertyId: string;
  operation: AugustLockOperation;
  previousMetadata: Prisma.JsonValue;
  result: "SUCCEEDED" | "FAILED" | "REJECTED";
  confirmedLockState?: string | null;
  errorDetail?: string;
}): Promise<void> {
  await recordAudit({
    actorUserId: args.actor.userId,
    actorType: "USER",
    action: "smart_device.august_lock_command",
    entityType: "SmartDevice",
    entityId: args.smartDeviceId,
    beforeState: {
      provider: "AUGUST",
      propertyId: args.propertyId,
      metadata: args.previousMetadata,
    } as Prisma.InputJsonValue,
    afterState: {
      operation: args.operation,
      result: args.result,
      ...(args.confirmedLockState !== undefined && {
        confirmedLockState: args.confirmedLockState,
      }),
    } as Prisma.InputJsonValue,
    metadata: args.errorDetail
      ? ({ errorDetail: args.errorDetail } as Prisma.InputJsonValue)
      : undefined,
  });
}

/** The one real recorded outcome kind that means "a live provider-level command attempt actually happened and did not succeed" — see getLatestAugustLockCommandOutcomes()'s own doc comment for why only this one matters for UI eligibility. */
export type AugustLockCommandRecordedOutcome =
  "SUCCEEDED" | "FAILED" | "REJECTED";

/**
 * Read-only: the most recent recorded `smart_device.august_lock_command`
 * outcome per device, from the exact same AuditLog rows
 * recordAuditSafely() already writes above — never a second/derived
 * tracking mechanism. Used exclusively to decide whether the dashboard
 * should present Lock/Unlock as available (see
 * apps/website/app/(dashboard)/locks/page.tsx) — this function makes no
 * provider call and changes nothing; it only reads history that already
 * exists.
 *
 * Specifically answers "did the last REAL command attempt against this
 * device fail" (`result: "FAILED"` — set only in the catch block wrapping
 * the actual `client.lock()/unlock()/unlatch()` call, i.e. a genuine
 * provider-level refusal or transport failure, like MJ - Front Door's real
 * `403`) — distinct from `"REJECTED"` (StayWhile's own pre-flight checks:
 * mapping/capability/allowlist — already independently re-verified live on
 * every real attempt regardless of history, so stale REJECTED history adds
 * no safety value here and is not treated as blocking) and `"SUCCEEDED"`
 * (e.g. Aqua Palm's real controlled test). A device with no recorded
 * attempt at all returns no entry — absence of failure evidence, not
 * proof of success; callers must combine this with the real
 * AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS check (isAugustLockCommandTestDevice
 * above), never rely on this alone.
 */
export async function getLatestAugustLockCommandOutcomes(
  actor: AuthContext,
  smartDeviceIds: string[],
): Promise<Map<string, AugustLockCommandRecordedOutcome>> {
  await assertPermission(actor, "smart_devices:read");
  if (smartDeviceIds.length === 0) return new Map();

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "SmartDevice",
      entityId: { in: smartDeviceIds },
      action: "smart_device.august_lock_command",
    },
    orderBy: { occurredAt: "desc" },
    select: { entityId: true, afterState: true },
  });

  const outcomes = new Map<string, AugustLockCommandRecordedOutcome>();
  for (const row of rows) {
    // Rows are ordered most-recent-first — the first time we see a given
    // entityId is its most recent outcome; every later row for the same
    // device is older and ignored.
    if (outcomes.has(row.entityId)) continue;
    const afterState = row.afterState as { result?: unknown } | null;
    const result = afterState?.result;
    if (
      result === "SUCCEEDED" ||
      result === "FAILED" ||
      result === "REJECTED"
    ) {
      outcomes.set(row.entityId, result);
    }
  }
  return outcomes;
}
