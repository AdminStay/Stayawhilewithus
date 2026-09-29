import { describe, expect, it } from "vitest";

import type { LockVerificationRow } from "./lock-verification";
import {
  buildCommandEvidence,
  buildVerificationHistory,
  isOpsConfirmedViaAugustApp,
  latestOpsEvidenceByStep,
  opsReportedFailure,
  parseOpsEvidence,
  summarizeDirection,
  type CommandAuditRow,
  type RecordedOpsEvidence,
} from "./lock-verification-evidence";
import { buildVerificationTrackerRow } from "./lock-verification-tracker";

// Fake fixtures shaped like the real command history of the five verified
// locks (HANDOFF Increment 186) — no Production data.
const cmd = (
  at: string,
  afterState: Record<string, unknown>,
  actorName: string | null = "Admin",
  metadata: Record<string, unknown> | null = null,
): CommandAuditRow => ({
  afterState,
  metadata,
  occurredAt: new Date(at),
  actorName,
});

const FIVE: Record<string, CommandAuditRow[]> = {
  "Aqua Palm": [
    cmd("2026-09-25T15:00:00Z", { operation: "LOCK", result: "SUCCEEDED" }),
    cmd("2026-09-25T15:05:00Z", { operation: "UNLOCK", result: "SUCCEEDED" }),
  ],
  Driftwood: [
    cmd("2026-09-25T16:00:00Z", { operation: "LOCK", result: "SUCCEEDED" }),
  ],
  "Royal Palms": [
    cmd("2026-09-25T17:00:00Z", { operation: "LOCK", result: "AMBIGUOUS" }),
    cmd(
      "2026-09-25T18:00:00Z",
      {
        result: "ADMIN_RESET",
        commandSent: false,
        observedLockState: "locked",
        resetFrom: "AMBIGUOUS",
      },
      "Khoa",
      { note: "Checked in person." },
    ),
    cmd("2026-09-26T15:00:00Z", { operation: "UNLOCK", result: "SUCCEEDED" }),
  ],
  "Once Upon a Pond": [
    cmd("2026-09-25T19:00:00Z", { operation: "UNLOCK", result: "SUCCEEDED" }),
    cmd("2026-09-25T19:05:00Z", { operation: "LOCK", result: "SUCCEEDED" }),
  ],
  "Moroccan Moon": [
    cmd("2026-09-26T16:00:00Z", { operation: "UNLOCK", result: "SUCCEEDED" }),
  ],
};

const base = (lockName: string): LockVerificationRow => ({
  smartDeviceId: `id-${lockName}`,
  propertyName: lockName,
  lockName: "Front Door",
  verification: { status: "AWAITING_OPS", verifiedAt: null },
  condition: { status: "HEALTHY", reasons: [] },
  connectivity: "ONLINE",
  batteryLevel: 80,
  doorCondition: "Closed",
});

function trackerFor(
  name: string,
  rows: CommandAuditRow[],
  opts: {
    lastCommandOutcome?: string | null;
    ops?: RecordedOpsEvidence[];
  } = {},
) {
  const commands = buildCommandEvidence(rows);
  const firstVerifiedAt =
    commands.find((c) => c.result === "SUCCEEDED")?.at ?? null;
  return buildVerificationTrackerRow({
    base: base(name),
    firstVerifiedAt,
    operationalHold: null,
    lastCommandOutcome: opts.lastCommandOutcome ?? null,
    mapped: true,
    lockState: "locked",
    commands,
    ops: opts.ops ?? [],
    availability: "AVAILABLE",
  });
}

const ops = (
  overrides: Partial<RecordedOpsEvidence> = {},
): RecordedOpsEvidence => ({
  version: 1,
  step: "REMOTE_LOCK",
  outcome: "PASSED",
  method: "AUGUST_APP_ONSITE",
  performedBy: "Ops tech",
  performedAt: "2026-09-30T14:00:00.000Z",
  notes: null,
  commandSent: false,
  recordedAt: "2026-09-30T15:00:00.000Z",
  recordedByName: "Admin",
  ...overrides,
});

describe("the five verified locks are preserved, with honest per-direction evidence", () => {
  it("all five are Verified overall — one successful direction is enough", () => {
    for (const [name, rows] of Object.entries(FIVE)) {
      expect(trackerFor(name, rows).verification.status).toBe("VERIFIED");
    }
  });

  it("per-direction StayWhile evidence matches the recorded history", () => {
    const dir = (name: string) => {
      const r = trackerFor(name, FIVE[name]!);
      return [r.remoteLock.status, r.remoteUnlock.status];
    };
    expect(dir("Aqua Palm")).toEqual(["PASSED", "PASSED"]);
    expect(dir("Driftwood")).toEqual(["PASSED", "NOT_TESTED"]);
    expect(dir("Royal Palms")).toEqual(["RESET_AFTER_CHECK", "PASSED"]);
    expect(dir("Once Upon a Pond")).toEqual(["PASSED", "PASSED"]);
    expect(dir("Moroccan Moon")).toEqual(["NOT_TESTED", "PASSED"]);
  });

  it("Royal Palms' admin reset is attributed to the ambiguous LOCK, by the admin who did it", () => {
    const r = trackerFor("Royal Palms", FIVE["Royal Palms"]!);
    expect(r.remoteLock.latest).toMatchObject({
      result: "ADMIN_RESET",
      actorName: "Khoa",
      observedLockState: "locked",
    });
    const reset = r.history.find(
      (h) => h.outcome === "Reset after physical check",
    );
    expect(reset).toMatchObject({
      step: "REMOTE_LOCK",
      by: "Khoa",
      method: "Admin reset after physical check (no command sent)",
      notes: "Door seen locked in person. Checked in person.",
    });
  });

  it("a verified lock is never downgraded — a later FAILED shows as 'later', status stays Verified", () => {
    const r = trackerFor(
      "Driftwood",
      [
        ...FIVE.Driftwood!,
        cmd("2026-09-29T10:00:00Z", { operation: "LOCK", result: "FAILED" }),
      ],
      { lastCommandOutcome: "FAILED" },
    );
    expect(r.verification.status).toBe("VERIFIED");
    expect(r.remoteLock.status).toBe("PASSED");
    expect(r.remoteLock.latest?.result).toBe("FAILED");
    expect(r.holdOrBlock).toMatch(/Last remote command FAILED/);
  });
});

describe("Coco Vista stays not verified", () => {
  const coco = [
    cmd("2026-09-25T20:00:00Z", { operation: "LOCK", result: "AMBIGUOUS" }),
  ];

  it("an AMBIGUOUS command → not verified, needs attention", () => {
    const r = trackerFor("Coco Vista", coco, {
      lastCommandOutcome: "AMBIGUOUS",
    });
    expect(r.verification.status).toBe("NOT_VERIFIED_NEEDS_ATTENTION");
    expect(r.remoteLock.status).toBe("AMBIGUOUS");
  });

  it("an Ops August-app confirmation is a badge only — never promotes the lock to Verified", () => {
    const r = trackerFor("Coco Vista", coco, {
      lastCommandOutcome: "AMBIGUOUS",
      ops: [ops({ step: "REMOTE_LOCK" })],
    });
    expect(r.opsConfirmedViaAugustApp).toBe(true);
    expect(r.verification.status).toBe("NOT_VERIFIED_NEEDS_ATTENTION");
    expect(r.remoteLock.status).toBe("AMBIGUOUS");
    expect(r.remoteLock.ops?.method).toBe("AUGUST_APP_ONSITE");
  });
});

describe("command evidence parsing", () => {
  it("skips REJECTED and NO_ACTION rows — nothing moved", () => {
    const e = buildCommandEvidence([
      cmd("2026-09-25T15:00:00Z", { operation: "LOCK", result: "REJECTED" }),
      cmd("2026-09-25T15:01:00Z", {
        operation: "LOCK",
        result: "NO_ACTION_ALREADY_IN_STATE",
        commandSent: false,
      }),
    ]);
    expect(e).toEqual([]);
    expect(summarizeDirection(e, "LOCK", null).status).toBe("NOT_TESTED");
  });

  it("orders by time regardless of input order", () => {
    const e = buildCommandEvidence([...FIVE["Aqua Palm"]!].reverse());
    expect(e.map((x) => x.direction)).toEqual(["LOCK", "UNLOCK"]);
  });
});

describe("Ops evidence", () => {
  it("parses a valid row and rejects a visual check claimed for a remote step", () => {
    const evidence = {
      version: 1,
      step: "MAPPING",
      outcome: "PASSED",
      method: "ONSITE_VISUAL",
      performedBy: "Ops tech",
      performedAt: "2026-09-30T14:00:00.000Z",
      notes: "",
      commandSent: false,
    };
    expect(parseOpsEvidence({ evidence })).toMatchObject({
      step: "MAPPING",
      notes: null,
    });
    expect(
      parseOpsEvidence({ evidence: { ...evidence, step: "REMOTE_UNLOCK" } }),
    ).toBeNull();
    expect(parseOpsEvidence({ hold: {} })).toBeNull();
    expect(parseOpsEvidence(null)).toBeNull();
  });

  it("append-only: the newest row per step is current; an earlier failure stays in history", () => {
    const rows = [
      ops({
        step: "MAPPING",
        method: "ONSITE_VISUAL",
        outcome: "FAILED",
        notes: "Wrong door",
        performedAt: "2026-09-29T10:00:00.000Z",
      }),
      ops({
        step: "MAPPING",
        method: "ONSITE_VISUAL",
        outcome: "PASSED",
        performedAt: "2026-09-30T10:00:00.000Z",
      }),
    ];
    const latest = latestOpsEvidenceByStep(rows);
    expect(latest.MAPPING?.outcome).toBe("PASSED");
    expect(opsReportedFailure(latest)).toBe(false);
    const history = buildVerificationHistory([], rows);
    expect(history.map((h) => h.outcome)).toEqual(["Passed", "Failed"]);
    expect(history[1]).toMatchObject({
      source: "OPS",
      notes: "Wrong door",
      recordedBy: "Admin",
    });
  });

  it("a current Ops failure makes an unverified lock 'needs attention' but never touches a verified one", () => {
    const failed = [
      ops({
        step: "DEVICE_STATUS",
        method: "ONSITE_VISUAL",
        outcome: "FAILED",
        notes: "Dead",
      }),
    ];
    expect(opsReportedFailure(latestOpsEvidenceByStep(failed))).toBe(true);
    expect(
      trackerFor("New Lock", [], { ops: failed }).verification.status,
    ).toBe("NOT_VERIFIED_NEEDS_ATTENTION");
    expect(
      trackerFor("Aqua Palm", FIVE["Aqua Palm"]!, { ops: failed }).verification
        .status,
    ).toBe("VERIFIED");
  });

  it("only a PASSED August-app test for LOCK/UNLOCK counts as 'Ops-confirmed via August app'", () => {
    expect(isOpsConfirmedViaAugustApp(latestOpsEvidenceByStep([ops()]))).toBe(
      true,
    );
    expect(
      isOpsConfirmedViaAugustApp(
        latestOpsEvidenceByStep([ops({ outcome: "FAILED" })]),
      ),
    ).toBe(false);
    expect(
      isOpsConfirmedViaAugustApp(
        latestOpsEvidenceByStep([ops({ step: "MAPPING" })]),
      ),
    ).toBe(false);
  });

  it("a lock with no evidence awaits Ops", () => {
    const r = trackerFor("Untested", []);
    expect(r.verification.status).toBe("AWAITING_OPS");
    expect(r.lastEvidence).toBeNull();
    expect(r.history).toEqual([]);
  });
});
