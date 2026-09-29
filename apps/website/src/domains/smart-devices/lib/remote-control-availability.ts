/**
 * Remote-control availability, for display to every /locks viewer
 * (2026-09-30, three-way /locks separation). Read-only operational users
 * see WHETHER a lock can be remotely controlled right now and why not;
 * the Lock/Unlock controls themselves stay behind `locks:manage`.
 *
 * Mirrors computeLockControlEligibility() (august-commands.service.ts)
 * check for check, in the same order, so "Available" here always means the
 * same thing as `eligible` there (pinned by a cross-product test). Pure and
 * display-only: it is never an input to any command decision, and
 * sendAugustLockCommand() still re-checks everything server-side.
 */
import type { LockControlContext } from "../services/august-commands.service";

export type RemoteControlAvailabilityCode =
  | "AVAILABLE"
  | "CONTROL_OFF"
  | "ON_HOLD"
  | "NOT_MAPPED"
  | "BLOCKED_FAILED"
  | "BLOCKED_AMBIGUOUS"
  | "NOT_ONLINE"
  | "NOT_VERIFIED";

export const REMOTE_CONTROL_AVAILABILITY_LABELS: Record<
  RemoteControlAvailabilityCode,
  string
> = {
  AVAILABLE: "Available",
  CONTROL_OFF: "Unavailable — lock control switched off",
  ON_HOLD: "Unavailable — on hold",
  NOT_MAPPED: "Unavailable — not mapped",
  BLOCKED_FAILED: "Blocked — last command failed",
  BLOCKED_AMBIGUOUS: "Blocked — last command ambiguous",
  NOT_ONLINE: "Unavailable — not online",
  NOT_VERIFIED: "Unavailable — not verified yet",
};

export function describeRemoteControlAvailability(
  ctx: LockControlContext,
): RemoteControlAvailabilityCode {
  if (!ctx.lockControlEnabled) return "CONTROL_OFF";
  if (ctx.operationalHold) return "ON_HOLD";
  if (ctx.externalDeviceId === null) return "NOT_MAPPED";
  if (ctx.lastOutcome === "FAILED") return "BLOCKED_FAILED";
  if (ctx.lastOutcome === "AMBIGUOUS") return "BLOCKED_AMBIGUOUS";
  if (ctx.connectivity !== "ONLINE") return "NOT_ONLINE";
  if (ctx.lastOutcome === "SUCCEEDED") return "AVAILABLE";
  return "NOT_VERIFIED";
}
