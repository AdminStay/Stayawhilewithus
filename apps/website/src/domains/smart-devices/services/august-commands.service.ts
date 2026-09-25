import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  AugustClient,
  isAugustBrand,
  type AugustLockDetail,
  type AugustLockOperation,
} from "@stayw/integrations/august";
import { HttpRequestError } from "@stayw/integrations/core";

import { acquireAugustCommandSlotsLock } from "./august-command-locks";
import { readLockControlSetting } from "./lock-control-settings.service";
import { mergeAugustLockMetadata } from "./lock-refresh.service";

import { recordAudit } from "@/platform/audit/record-audit";

export type AugustLockCommandResult =
  | { status: "success"; lockState: string | null }
  /**
   * 2026-09-25: the lock already reported the requested target state
   * BEFORE this call, so no physical command was sent. Only ever returned
   * for routine control on an already-VERIFIED device (a first-verification
   * attempt in this situation is REJECTED instead). Deliberately NOT a
   * `success` variant: nothing moved, so it must never read as, or count
   * toward, a confirmed transition.
   */
  | { status: "no_action"; lockState: string | null }
  | { status: "rejected"; reason: string }
  | { status: "already_running" }
  | { status: "failure"; reason: string }
  | { status: "ambiguous"; reason: string };

export interface SendAugustLockCommandInput {
  smartDeviceId: string;
  operation: AugustLockOperation;
}

/**
 * Same reasoning/derivation class as nest-commands.service.ts's
 * STALE_COMMAND_THRESHOLD_MS — recomputed 2026-09-25 for Phase 2 (async
 * command mode + bounded confirmation polling). Worst case is now: the
 * pre-command capability refresh read and the capabilities read (each
 * still HttpClient's default up to 3 attempts x 10s + backoff, ~31s worst
 * case each, since only the physical write itself is single-attempt) +
 * the async command PUT itself (single attempt, maxRetries: 0, ~10s worst
 * case) + up to CONFIRMATION_POLL_ATTEMPTS confirmation reads (each also
 * ~31s worst case) with CONFIRMATION_POLL_DELAY_MS between them. With the
 * constants below (4 poll attempts, 3s apart) that's roughly
 * 31 + 31 + 10 + (4 x 31) + (3 x 3) ≈ 205 seconds in the most pathological
 * case where every single read also exhausts its own retry budget — far
 * from typical (reads have consistently been fast in practice, generally
 * sub-second), but still comfortably (~32% margin) under this 5-minute
 * threshold. In the realistic/typical case (reads succeed on their first
 * attempt), the whole confirmation window adds roughly 9-13 seconds of
 * actual wall-clock time — this repo has no configured Vercel
 * `maxDuration` for this route today, so the exact hosting function time
 * limit is unknown; these numbers were chosen to stay reasonable under any
 * plausible default (a few seconds typical, well under a minute even in an
 * unlucky-but-not-pathological case) rather than against a specific known
 * ceiling — confirm the real configured limit if a stronger guarantee is
 * ever needed.
 */
const STALE_COMMAND_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Bounded confirmation window after the async command PUT acknowledges
 * receipt (2026-09-25, Phase 2 of the Orion incident's root-cause
 * correction) — deliberately conservative starting constants, not a
 * scientifically-derived optimum: 4 attempts, 3 seconds apart (12 seconds
 * of enforced pause across the window, plus the reads' own time — up from
 * the original 3x2s=6s), giving August's bridge/lock more real chances,
 * over a longer real-world window, to report the requested state before
 * this function gives up and reports AMBIGUOUS. Every individual read here
 * still uses this client's normal, unchanged retry behavior (up to 3
 * attempts internally) — this loop adds POLL ATTEMPTS on top of that, it
 * does not touch or duplicate HttpClient's own retry logic. See
 * STALE_COMMAND_THRESHOLD_MS's own comment for why this stays well under
 * that 5-minute ceiling even in the worst case.
 */
const CONFIRMATION_POLL_ATTEMPTS = 4;
const CONFIRMATION_POLL_DELAY_MS = 3000;

/**
 * Wall-clock budget for one sendAugustLockCommand() call's provider work
 * (2026-09-25, pre-deploy item 2). It must finish well inside the hosting
 * function limit, because a function killed mid-confirmation would send a
 * physical command and then never write its audit row. The /locks page,
 * which hosts this server action, sets `maxDuration = 60`; 45s of budget
 * leaves 15s for the DB/audit writes and the `finally` cleanup.
 *
 * Worst case, step by step:
 *   - Pre-command reads (default retries, about 31s worst each) are checked
 *     against PRE_COMMAND_DEADLINE_MS after each one. Past it, the command
 *     is REJECTED and nothing is sent: at most 15s + 31s = 46s.
 *   - Otherwise the PUT starts by 15s and is single-attempt, so it ends by
 *     25s at most (one 10s timeout).
 *   - Each confirmation read is single-attempt (at most 10s). A poll, or the
 *     pause before it, only starts if it can finish by the 45s budget; if
 *     not, the result is AMBIGUOUS.
 * Typical case (sub-second reads): roughly 1–10 seconds in total.
 */
const COMMAND_TIME_BUDGET_MS = 45_000;
const PRE_COMMAND_DEADLINE_MS = 15_000;
/** HttpClient's per-attempt timeout (DEFAULT_TIMEOUT_MS) — one single-attempt read's worst case. */
const SINGLE_READ_WORST_CASE_MS = 10_000;

/** Operator-facing reason when pre-command reads were too slow to safely start a physical command inside the time budget. */
/**
 * Account-wide cap on physical commands in flight at once (2026-09-25,
 * "enable all locks") — one command per lock is already enforced by the
 * per-device guard; this keeps several operators testing different locks at
 * the same time from overloading August's API. There is no bulk/"test all"
 * path anywhere: every command is one lock, one confirmed click.
 */
const MAX_CONCURRENT_AUGUST_COMMANDS = 3;

const COMMANDS_BUSY_REASON =
  "Other lock commands are in progress right now, so nothing was sent. Try again in a few seconds.";

const SLOW_PROVIDER_REJECTED_REASON =
  "August is responding too slowly right now, so no command was sent. Try again shortly.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The one and only state August's real API ever reports for each
 * operation (verified against py-august's source plus a live field audit —
 * see AugustLockDetail's own doc comment, types.ts: the provider's
 * LockStatus.status vocabulary is exactly "locked"/"unlocked", nothing
 * else, and UNLATCH's own result is reported as "unlocked" too — there is
 * no distinct provider-reported "unlatched" state to check against; this
 * is a real, verified provider fact, not a guess).
 */
function expectedLockStateFor(
  operation: AugustLockOperation,
): "locked" | "unlocked" {
  return operation === "LOCK" ? "locked" : "unlocked";
}

/**
 * Polls getLockDetail() up to CONFIRMATION_POLL_ATTEMPTS times, pausing
 * CONFIRMATION_POLL_DELAY_MS between attempts, until August reports a
 * real, valid lock state that MATCHES the requested operation (2026-09-25
 * correction — with async mode, an early poll can legitimately still
 * report the OLD state, e.g. still "locked" shortly after an UNLOCK was
 * sent, before the bridge has actually relayed the change; accepting the
 * first non-null reading unconditionally could record that old state as a
 * "confirmed" SUCCEEDED result, falsely verifying a lock that never
 * physically moved). A reading whose `lockState` is `null` (provider
 * didn't mark it valid — see AugustLockDetail's own doc comment, never
 * fabricated) or whose `lockState` doesn't match `expectedLockStateFor()`
 * is treated as "not yet confirmed" and polling continues. Returns the
 * first genuinely matching reading, used exactly as reported (never
 * further guessed beyond the equality check itself). Returns `null`
 * (never throws) if every attempt is exhausted without ever reporting the
 * expected state — the caller (sendAugustLockCommand()) treats that as
 * AMBIGUOUS, never a guessed success.
 */
async function pollForConfirmedLockState(
  client: AugustClient,
  externalDeviceId: string,
  operation: AugustLockOperation,
  deadline: number,
): Promise<AugustLockDetail | null> {
  const expected = expectedLockStateFor(operation);
  for (let attempt = 0; attempt < CONFIRMATION_POLL_ATTEMPTS; attempt++) {
    const pause = attempt > 0 ? CONFIRMATION_POLL_DELAY_MS : 0;
    // Only start a poll (and its pause) if it can finish inside the time
    // budget — see COMMAND_TIME_BUDGET_MS.
    if (Date.now() + pause + SINGLE_READ_WORST_CASE_MS > deadline) break;
    if (pause > 0) await sleep(pause);
    try {
      // Single attempt: this loop is the retry mechanism, and one timeout
      // per read is what makes the budget check above hold.
      const detail = await client.getLockDetail(externalDeviceId, {
        maxRetries: 0,
      });
      if (detail.lockState?.toLowerCase() === expected) return detail;
    } catch {
      // A read failure is treated the same as "no confirmation yet" — try
      // again on the next poll rather than aborting the whole window.
    }
  }
  return null;
}

/**
 * Read-only, single-device lookup of the same history
 * getLatestAugustLockCommandOutcomes() reads for the whole dashboard. Used
 * inside sendAugustLockCommand() (already past its own locks:manage RBAC
 * check) and resetAugustLockAfterPhysicalCheck().
 */
async function getMostRecentRecordedOutcome(
  smartDeviceId: string,
): Promise<AugustLockCommandRecordedOutcome | undefined> {
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "SmartDevice",
      entityId: smartDeviceId,
      action: "smart_device.august_lock_command",
    },
    orderBy: { occurredAt: "desc" },
    select: { afterState: true },
  });
  for (const row of rows) {
    const outcome = parseRecordedOutcome(row.afterState);
    if (outcome) return outcome;
  }
  return undefined;
}

/**
 * The one place an AuditLog `afterState` becomes a recorded outcome — the
 * state that decides whether a lock is verified, blocked, or untested.
 *
 * Only rows that reflect something that actually happened to (or was
 * physically checked on) the lock count: SUCCEEDED, FAILED, AMBIGUOUS, and
 * ADMIN_RESET. REJECTED (stopped before anything was sent) and
 * NO_ACTION_ALREADY_IN_STATE (no command needed) return undefined, so the
 * caller falls through to the next-older row. That way neither can ever
 * mask a real FAILED/AMBIGUOUS block, nor count toward "verified".
 */
function parseRecordedOutcome(
  afterState: Prisma.JsonValue | null,
): AugustLockCommandRecordedOutcome | undefined {
  const result = (afterState as { result?: unknown } | null)?.result;
  if (
    result === "SUCCEEDED" ||
    result === "FAILED" ||
    result === "AMBIGUOUS" ||
    result === "ADMIN_RESET"
  ) {
    return result;
  }
  return undefined;
}

/** What LocksList shows in place of the Lock/Unlock controls when they're not currently eligible — never rendered when `eligible` is true. */
export interface LockControlEligibility {
  eligible: boolean;
  reason: string | null;
}

/**
 * Everything eligibility depends on (2026-09-25, "enable all locks") —
 * fully dynamic, nothing per-lock hard-coded and no env allowlist. A lock
 * added or renamed in August becomes eligible as soon as it is mapped,
 * enabled, and reports online.
 */
export interface LockControlContext {
  /** The enabled ProviderDevice mapping's externalDeviceId — null when the lock is unmapped or its mapping is disabled. */
  externalDeviceId: string | null;
  /** Last connectivity August reported (SmartDevice.status). Only ONLINE locks can be commanded remotely. */
  connectivity: string;
  lastOutcome: AugustLockCommandRecordedOutcome | undefined;
  /** The global kill switch (readLockControlSetting). */
  lockControlEnabled: boolean;
}

/** Exact same copy sendAugustLockCommand() itself returns when providerDevice is missing/disabled — reused, not paraphrased, so a pre-click and a post-click message never disagree. */
const NOT_ENABLED_FOR_CONTROL_REASON =
  "This device is not enabled for control — map and enable it from Discovered Devices first.";

const KILL_SWITCH_OFF_REASON =
  "Remote lock control is turned off by an admin. No commands can be sent to any lock.";

/**
 * August only reports live status and accepts remote commands for a lock
 * connected to its cloud (a WiFi bridge/connection it reports as online). A
 * live fleet check on 2026-09-25 found 39 of 43 locks with no bridge
 * reported and lock status "unknown" from August itself.
 */
const NOT_ONLINE_REASON =
  "August isn't reporting this lock as online, so it can't be controlled remotely. Check its WiFi bridge connection in the August/Yale app.";

/** Deliberately generic and safe — never the raw stored `metadata.errorDetail`. */
const LAST_ATTEMPT_FAILED_REASON =
  "The last real attempt to control this lock did not succeed. An admin must check the door in person and reset it before it can be tried again.";

const NOT_YET_VERIFIED_REASON =
  "Remote control has not been verified for this lock yet.";

/**
 * Distinct from LAST_ATTEMPT_FAILED_REASON on purpose (the Orion incident) —
 * never implies the command failed or succeeded.
 */
const AMBIGUOUS_OUTCOME_BLOCKED_REASON =
  "Command outcome uncertain. Do not retry until the lock's physical state has been checked in person and an admin has reset it.";

/**
 * Whether the routine Lock/Unlock controls are available. Fail-closed and
 * positive: only a lock with a real on-record SUCCEEDED outcome (since any
 * admin reset) is routine-controllable, and only while the kill switch is
 * ON, the lock is mapped + enabled, and August reports it ONLINE.
 * FAILED/AMBIGUOUS block until an admin reset. No outcome / ADMIN_RESET
 * means "not yet verified" — the separate first-test workflow applies.
 *
 * UX only: sendAugustLockCommand() re-checks every one of these conditions
 * server-side (connectivity from a fresh August read, not stored status).
 */
export function computeLockControlEligibility(
  ctx: LockControlContext,
): LockControlEligibility {
  if (!ctx.lockControlEnabled) {
    return { eligible: false, reason: KILL_SWITCH_OFF_REASON };
  }
  if (ctx.externalDeviceId === null) {
    return { eligible: false, reason: NOT_ENABLED_FOR_CONTROL_REASON };
  }
  if (ctx.lastOutcome === "FAILED") {
    return { eligible: false, reason: LAST_ATTEMPT_FAILED_REASON };
  }
  if (ctx.lastOutcome === "AMBIGUOUS") {
    return { eligible: false, reason: AMBIGUOUS_OUTCOME_BLOCKED_REASON };
  }
  if (ctx.connectivity !== "ONLINE") {
    return { eligible: false, reason: NOT_ONLINE_REASON };
  }
  if (ctx.lastOutcome === "SUCCEEDED") {
    return { eligible: true, reason: null };
  }
  return { eligible: false, reason: NOT_YET_VERIFIED_REASON };
}

/** Whether to offer the separate "Test controllability" first-verification workflow. */
export interface FirstTestEligibility {
  eligible: boolean;
}

/**
 * The first rung for a not-yet-verified lock: offered only when the kill
 * switch is ON, the lock is mapped + enabled and ONLINE, and it has no
 * blocking or verifying outcome (no history, or an ADMIN_RESET). Never
 * offered alongside the routine controls, and never for a FAILED/AMBIGUOUS
 * lock (those need an admin reset first).
 */
export function computeFirstTestEligibility(
  ctx: LockControlContext,
): FirstTestEligibility {
  if (!ctx.lockControlEnabled) return { eligible: false };
  if (ctx.externalDeviceId === null) return { eligible: false };
  if (ctx.connectivity !== "ONLINE") return { eligible: false };
  if (
    ctx.lastOutcome === "SUCCEEDED" ||
    ctx.lastOutcome === "FAILED" ||
    ctx.lastOutcome === "AMBIGUOUS"
  ) {
    return { eligible: false };
  }
  return { eligible: true };
}

/** An admin "reset after physical check" is offered only for a lock blocked by FAILED or AMBIGUOUS. */
export function isAdminResetAvailable(
  lastOutcome: AugustLockCommandRecordedOutcome | undefined,
): boolean {
  return lastOutcome === "FAILED" || lastOutcome === "AMBIGUOUS";
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
 *      physical lock control. Only `admin` is granted it in Production.
 *   2a. Global kill switch (readLockControlSetting) and blocking history:
 *      a lock whose last real outcome is FAILED or AMBIGUOUS is refused
 *      until an admin resets it after an in-person check.
 *   3. Duplicate-command prevention: advisory-lock-guarded, in-progress
 *      marker read AND written inside the same locked transaction, plus an
 *      account-wide cap of MAX_CONCURRENT_AUGUST_COMMANDS in flight.
 *   4. Fresh capability refresh: a real getLockDetail() + getLockCapabilities()
 *      pair against August right now — never the stored
 *      ProviderDevice.rawMetadata snapshot, which could be arbitrarily old.
 *      A lock with no reported serialNumber, or whose capabilities don't
 *      confirm the requested operation, is rejected here — never assumed
 *      supported.
 *   5. Dynamic eligibility (2026-09-25, replaces the old
 *      AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS env allowlist): the fresh read
 *      above must report the lock ONLINE, and the kill switch is re-read
 *      right before sending so a toggle takes effect immediately.
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

  // Kill switch and blocking history, before any August call or command
  // marker. A refusal here never reaches the lock.
  const lockControl = await readLockControlSetting();
  if (!lockControl.enabled) {
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId: smartDevice.propertyId,
      operation: input.operation,
      previousMetadata: smartDevice.metadata,
      result: "REJECTED",
      errorDetail: "Blocked by the global lock-control kill switch (OFF).",
    });
    return { status: "rejected", reason: KILL_SWITCH_OFF_REASON };
  }
  const lastOutcome = await getMostRecentRecordedOutcome(smartDevice.id);
  if (lastOutcome === "FAILED" || lastOutcome === "AMBIGUOUS") {
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId: smartDevice.propertyId,
      operation: input.operation,
      previousMetadata: smartDevice.metadata,
      result: "REJECTED",
      errorDetail: `Blocked: last real outcome is ${lastOutcome}; requires an admin reset after an in-person check.`,
    });
    return {
      status: "rejected",
      reason:
        lastOutcome === "FAILED"
          ? LAST_ATTEMPT_FAILED_REASON
          : AMBIGUOUS_OUTCOME_BLOCKED_REASON,
    };
  }

  // Atomic duplicate-command guard — identical shape to
  // sendNestThermostatCommand()'s: acquire the advisory lock, THEN read the
  // current marker from inside the same transaction (never the pre-fetched
  // `smartDevice` above, which could already be stale by the time we get
  // here).
  const lockResult = await prisma.$transaction(async (tx) => {
    // Serializes the account-wide in-flight count below across concurrent
    // requests for different locks (held only for this short transaction).
    await acquireAugustCommandSlotsLock(tx);
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('device_command'), hashtext(${smartDevice.id})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      return { proceeding: false, busy: false } as const;
    }

    const current = await tx.smartDevice.findUniqueOrThrow({
      where: { id: smartDevice.id },
      select: { commandInProgressAt: true },
    });

    if (current.commandInProgressAt) {
      const ageMs = Date.now() - current.commandInProgressAt.getTime();
      if (ageMs < STALE_COMMAND_THRESHOLD_MS) {
        return { proceeding: false, busy: false } as const;
      }
    }

    const otherCommandsInFlight = await tx.smartDevice.count({
      where: {
        provider: "AUGUST",
        id: { not: smartDevice.id },
        commandInProgressAt: {
          gt: new Date(Date.now() - STALE_COMMAND_THRESHOLD_MS),
        },
      },
    });
    if (otherCommandsInFlight >= MAX_CONCURRENT_AUGUST_COMMANDS) {
      return { proceeding: false, busy: true } as const;
    }

    await tx.smartDevice.update({
      where: { id: smartDevice.id },
      data: { commandInProgressAt: new Date() },
    });
    return { proceeding: true, busy: false } as const;
  });

  if (!lockResult.proceeding) {
    return lockResult.busy
      ? { status: "rejected", reason: COMMANDS_BUSY_REASON }
      : { status: "already_running" };
  }

  const previousMetadata = smartDevice.metadata;
  const propertyId = smartDevice.propertyId;
  const externalDeviceId = smartDevice.providerDevice.externalDeviceId;
  // Set true only immediately before the real client.lock()/unlock()/
  // unlatch() call below — the single fact the catch block below needs to
  // tell "this failed before we ever tried to command the physical lock"
  // (a pre-flight capability-read problem, unchanged FAILED classification)
  // apart from "we tried to command it and something went wrong after
  // that point" (2026-09-25, the Orion incident's root cause investigation
  // — see this function's own doc comment item 6/7 below).
  let commandAttempted = false;
  const startedAt = Date.now();

  // Pre-command time check (see COMMAND_TIME_BUDGET_MS): if August's reads
  // were too slow, refuse before any physical command is sent.
  const rejectIfTooSlow = async (): Promise<AugustLockCommandResult | null> => {
    if (Date.now() - startedAt <= PRE_COMMAND_DEADLINE_MS) return null;
    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      operation: input.operation,
      previousMetadata,
      result: "REJECTED",
      errorDetail: `Pre-command reads exceeded ${PRE_COMMAND_DEADLINE_MS}ms; no command sent.`,
    });
    return { status: "rejected", reason: SLOW_PROVIDER_REJECTED_REASON };
  };

  try {
    const client = getAugustClientFromEnv();

    // Fresh capability refresh — never the stored snapshot.
    const freshDetail = await client.getLockDetail(externalDeviceId);
    const slowAfterDetail = await rejectIfTooSlow();
    if (slowAfterDetail) return slowAfterDetail;
    await prisma.providerDevice.update({
      where: { smartDeviceId: smartDevice.id },
      data: { rawMetadata: freshDetail as unknown as Prisma.InputJsonValue },
    });

    // Dynamic eligibility: August must report this lock ONLINE right now
    // (fresh read, never the stored status). Offline/unknown locks have no
    // cloud connection for a remote command to travel over.
    if (freshDetail.connectivity !== "ONLINE") {
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "REJECTED",
        errorDetail: `Not online: August reported connectivity "${freshDetail.connectivity}"; no command sent.`,
      });
      return { status: "rejected", reason: NOT_ONLINE_REASON };
    }

    // ALREADY-IN-REQUESTED-STATE CHECK (2026-09-25 correction): if the
    // lock already reports the exact state this operation would produce,
    // a later matching poll reading would prove nothing about whether the
    // lock actually moved. Only checked when we have a real, valid current
    // reading (`lockState !== null` — never guessed); a null/unknown
    // current state means we have no evidence this would be a no-op, so we
    // proceed normally.
    const preCommandState = freshDetail.lockState?.toLowerCase() ?? null;
    const targetState = expectedLockStateFor(input.operation);
    if (preCommandState === targetState) {
      // Anything short of a real, on-record SUCCEEDED means this exact
      // device has never had its remote-command operability positively
      // proven yet (matches computeFirstTestEligibility's own definition)
      // — a first-verification attempt here MUST be held to the "prove a
      // real transition" bar, never allowed to pass on a pre-existing,
      // unrelated state.
      const isFirstVerification = lastOutcome !== "SUCCEEDED";

      if (isFirstVerification) {
        const requestedLabel = input.operation === "LOCK" ? "Lock" : "Unlock";
        const oppositeLabel = input.operation === "LOCK" ? "Unlock" : "Lock";
        const reason = `This lock is already ${preCommandState}, so a ${requestedLabel} test could not prove the lock physically moves. Test ${oppositeLabel} instead.`;
        await recordAuditSafely({
          actor,
          smartDeviceId: smartDevice.id,
          propertyId,
          operation: input.operation,
          previousMetadata,
          result: "REJECTED",
          errorDetail: `Already-in-requested-state pre-flight block (first verification only): lock already reports "${preCommandState}".`,
        });
        return { status: "rejected", reason };
      }

      // Routine control on an already-VERIFIED device: honest no-op.
      // Never send a redundant physical command — the lock is already
      // exactly where the operator wants it. Still persist the fresh
      // telemetry we just read, same discipline as the real command path.
      // Audited as NO_ACTION_ALREADY_IN_STATE, never SUCCEEDED: nothing
      // moved, so this row must never count toward "verified" (see
      // parseRecordedOutcome()).
      const noopMetadata = mergeAugustLockMetadata(
        (previousMetadata as Record<string, unknown> | null) ?? {},
        {
          batteryLevel: freshDetail.batteryLevel,
          lockState: freshDetail.lockState,
          telemetryUpdatedAt: freshDetail.telemetryUpdatedAt,
        },
      );
      await prisma.smartDevice.update({
        where: { id: smartDevice.id },
        data: {
          status: freshDetail.connectivity,
          metadata: noopMetadata as Prisma.InputJsonValue,
          lastSeenAt: freshDetail.seenAt ? new Date(freshDetail.seenAt) : null,
        },
      });
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "NO_ACTION_ALREADY_IN_STATE",
        confirmedLockState: freshDetail.lockState,
        note: `No command was sent: the lock already reported "${preCommandState}" before ${input.operation}.`,
      });
      return { status: "no_action", lockState: freshDetail.lockState };
    }

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
    const slowAfterCapabilities = await rejectIfTooSlow();
    if (slowAfterCapabilities) return slowAfterCapabilities;
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

    // Kill switch re-read immediately before sending, so an admin turning
    // it OFF mid-request still stops this command.
    if (!(await readLockControlSetting()).enabled) {
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "REJECTED",
        errorDetail:
          "Blocked by the global lock-control kill switch (turned OFF before send).",
      });
      return { status: "rejected", reason: KILL_SWITCH_OFF_REASON };
    }

    // The real command. Every existing safety check above this point has
    // already passed — from here onward, any failure means we genuinely
    // don't know for certain the physical lock was untouched.
    commandAttempted = true;
    if (input.operation === "LOCK") {
      await client.lock(externalDeviceId);
    } else if (input.operation === "UNLOCK") {
      await client.unlock(externalDeviceId);
    } else {
      await client.unlatch(externalDeviceId);
    }

    // Confirmation (2026-09-25, Phase 2 — async mode + bounded polling):
    // the PUT above only acknowledged receipt, it does not itself prove
    // the physical operation completed (see operate()'s own doc comment,
    // packages/integrations/src/august/client.ts). Poll for a bounded
    // window for August to report the real, provider-confirmed state that
    // actually MATCHES the requested operation — an early poll reporting
    // the OLD state (e.g. still "locked" shortly after an UNLOCK) must
    // never be accepted as confirmation; only a matching state counts
    // toward SUCCEEDED/verified.
    const confirmed = await pollForConfirmedLockState(
      client,
      externalDeviceId,
      input.operation,
      startedAt + COMMAND_TIME_BUDGET_MS,
    );
    if (!confirmed) {
      // August acknowledged the request (no HttpRequestError was thrown
      // above — that path already returns FAILED), but no definitive lock
      // state was ever confirmed within the polling window. This is
      // exactly the "command transmission/result cannot be established"
      // case AMBIGUOUS exists for — never guessed as a success, never
      // recorded as a confirmed failure (August never told us it failed).
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "AMBIGUOUS",
        errorDetail:
          "Command was sent and acknowledged by August, but no definitive lock state was confirmed within the polling window.",
      });
      return { status: "ambiguous", reason: AMBIGUOUS_OUTCOME_BLOCKED_REASON };
    }
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
    // FAILED means real, DEFINITIVE evidence of a problem: either the
    // failure happened before the real command was ever attempted (a
    // pre-flight capability read broke — commandAttempted is still false),
    // or August's own server sent back an actual HTTP response with a
    // status code (HttpRequestError — a genuine, identifiable answer, even
    // an unhappy one like a 403 refusal or a 422 bridge-offline). Either
    // way we KNOW something concrete, and the existing MJ-style permanent
    // block is the correct, evidence-backed response.
    //
    // AMBIGUOUS (2026-09-25, the Orion incident's root cause) is the other
    // case: commandAttempted is true (we reached the point of calling
    // client.lock()/unlock()/unlatch(), or the post-command confirmation
    // read after it) AND the error is NOT an HttpRequestError — i.e. no
    // response of any kind ever came back (a network-level abort/timeout,
    // like HttpClient's own AbortController firing after its configured
    // timeout with zero bytes received). We have no evidence the command
    // reached August, no evidence it didn't, and no evidence of the
    // resulting physical state — treating this as a confirmed "FAILED"
    // would overclaim; treating it as safe-to-retry would ignore that a
    // real write may already be in flight or already delivered. AMBIGUOUS
    // blocks identically to FAILED (see computeLockControlEligibility/
    // computeFirstTestEligibility) without claiming to be one.
    const isDefinitive = !commandAttempted || err instanceof HttpRequestError;
    const errorDetail = err instanceof Error ? err.message : String(err);

    if (isDefinitive) {
      const safeMessage = translateAugustCommandError(err);
      await recordAuditSafely({
        actor,
        smartDeviceId: smartDevice.id,
        propertyId,
        operation: input.operation,
        previousMetadata,
        result: "FAILED",
        errorDetail,
      });
      return { status: "failure", reason: safeMessage };
    }

    await recordAuditSafely({
      actor,
      smartDeviceId: smartDevice.id,
      propertyId,
      operation: input.operation,
      previousMetadata,
      result: "AMBIGUOUS",
      errorDetail,
    });
    return { status: "ambiguous", reason: AMBIGUOUS_OUTCOME_BLOCKED_REASON };
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
  result:
    | Exclude<AugustLockCommandRecordedOutcome, "ADMIN_RESET">
    | "REJECTED"
    | "NO_ACTION_ALREADY_IN_STATE";
  confirmedLockState?: string | null;
  errorDetail?: string;
  /** Operator-readable explanation for a non-error outcome (NO_ACTION_ALREADY_IN_STATE). */
  note?: string;
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
      ...(args.result === "NO_ACTION_ALREADY_IN_STATE" && {
        commandSent: false,
      }),
    } as Prisma.InputJsonValue,
    metadata:
      args.errorDetail || args.note
        ? ({
            ...(args.errorDetail && { errorDetail: args.errorDetail }),
            ...(args.note && { note: args.note }),
          } as Prisma.InputJsonValue)
        : undefined,
  });
}

/**
 * The recorded outcomes that decide a lock's control state (see
 * parseRecordedOutcome()): SUCCEEDED (verified), FAILED / AMBIGUOUS
 * (blocked until an admin reset), ADMIN_RESET (back to not-yet-verified
 * after an in-person check). REJECTED and NO_ACTION_ALREADY_IN_STATE rows
 * are still written to the audit log but never change this state.
 */
export type AugustLockCommandRecordedOutcome =
  "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "ADMIN_RESET";

/**
 * Read-only: each device's most recent recorded outcome (see
 * AugustLockCommandRecordedOutcome), from the same AuditLog rows
 * recordAuditSafely() and resetAugustLockAfterPhysicalCheck() write. A
 * device with no such row returns no entry — absence of failure evidence,
 * never proof of success. Makes no provider call and changes nothing.
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
    // NO_ACTION_ALREADY_IN_STATE rows parse to undefined and are skipped,
    // so the device's next-older real outcome is used instead.
    if (outcomes.has(row.entityId)) continue;
    const outcome = parseRecordedOutcome(row.afterState);
    if (outcome) outcomes.set(row.entityId, outcome);
  }
  return outcomes;
}

export type ResetAugustLockResult =
  { status: "success" } | { status: "rejected"; reason: string };

export interface ResetAugustLockInput {
  smartDeviceId: string;
  /** What the admin saw at the door in person. */
  observedLockState: "locked" | "unlocked";
  /** Free-text note, e.g. who checked and when. */
  note?: string;
}

/**
 * Admin "reset after physical check" (2026-09-25) for a lock blocked by a
 * FAILED or AMBIGUOUS outcome (e.g. Orion, MJ - Front Door). The admin
 * confirms they checked the door's real state in person.
 *
 * Never sends a command, never touches the lock's stored telemetry, and
 * never counts as verified: it writes one ADMIN_RESET audit row, which
 * returns the lock to "not yet verified", so the next step is the ordinary
 * first-verification test. Global (not property-scoped) `locks:manage` —
 * admin only in Production.
 */
export async function resetAugustLockAfterPhysicalCheck(
  actor: AuthContext,
  input: ResetAugustLockInput,
): Promise<ResetAugustLockResult> {
  await assertPermission(actor, "locks:manage");

  const smartDevice = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    select: { id: true, provider: true, propertyId: true, metadata: true },
  });
  if (!smartDevice || smartDevice.provider !== "AUGUST") {
    return { status: "rejected", reason: "Device not found." };
  }

  const lastOutcome = await getMostRecentRecordedOutcome(smartDevice.id);
  if (!isAdminResetAvailable(lastOutcome)) {
    return {
      status: "rejected",
      reason: "This lock isn't blocked, so there is nothing to reset.",
    };
  }

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "smart_device.august_lock_command",
    entityType: "SmartDevice",
    entityId: smartDevice.id,
    beforeState: {
      provider: "AUGUST",
      propertyId: smartDevice.propertyId,
      blockedBy: lastOutcome,
    } as Prisma.InputJsonValue,
    afterState: {
      result: "ADMIN_RESET",
      commandSent: false,
      observedLockState: input.observedLockState,
      resetFrom: lastOutcome,
    } as Prisma.InputJsonValue,
    metadata: {
      note:
        input.note?.trim() ||
        "Admin confirmed the door's physical state in person. No command was sent.",
    } as Prisma.InputJsonValue,
  });
  return { status: "success" };
}
