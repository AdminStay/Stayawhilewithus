import { describe, expect, it } from "vitest";

import {
  classifyLockHealth,
  type LockHealthFlag,
  type LockHealthSnapshot,
  type OperationalHold,
} from "./lock-health";
import {
  buildOpsVerificationChecklist,
  deriveLockCondition,
  deriveLockVerification,
  describeDoorCondition,
  needsOpsFollowUp,
  type LockVerificationRow,
} from "./lock-verification";

const NOW = new Date("2026-09-29T12:00:00.000Z");

const hold = (
  kind: OperationalHold["kind"],
  note: string,
): OperationalHold => ({
  kind,
  note,
  setAt: "2026-09-27T10:00:00.000Z",
  setByUserId: "admin-1",
});

// A fresh, healthy August reading (real LockHealthSnapshot shape): online,
// locked, door closed, good battery.
function healthyMetadata(overrides: Partial<LockHealthSnapshot> = {}) {
  return {
    batteryLevel: 80,
    lockHealth: {
      observedAt: "2026-09-29T11:50:00.000Z",
      lockState: "locked",
      lockStatusValid: true,
      lockStatusAt: "2026-09-29T11:50:00.000Z",
      unknownReason: null,
      doorState: "closed",
      connectivity: "ONLINE",
      bridgePresent: true,
      bridgeLastOnline: "2026-09-29T11:50:00.000Z",
      bridgeLastOffline: null,
      wifiConnectionIssueCount: 0,
      batteryLevel: 80,
      batteryWarningState: "lock_state_battery_warning_none",
      batteryReadingAt: "2026-09-29T10:00:00.000Z",
      lastValidLockState: "locked",
      lastValidLockStateAt: "2026-09-29T11:50:00.000Z",
      lockStateSince: null,
      consecutiveUnknownRefreshes: 0,
      ...overrides,
    } satisfies LockHealthSnapshot,
  };
}

function flagsFor(input: {
  metadata?: unknown;
  connectivity?: string;
  lastCommandOutcome?: string | null;
  operationalHold?: OperationalHold | null;
}): LockHealthFlag[] {
  return classifyLockHealth({
    metadata: input.metadata ?? healthyMetadata(),
    connectivity: input.connectivity ?? "ONLINE",
    now: NOW,
    recentUnknownTransitions: 0,
    lastCommandOutcome: input.lastCommandOutcome ?? null,
    operationalHold: input.operationalHold ?? null,
  });
}

describe("deriveLockVerification — historical, never inferred", () => {
  it("a recorded successful command → Verified, with its date", () => {
    expect(
      deriveLockVerification({
        firstVerifiedAt: "2026-09-25T18:09:00.000Z",
        operationalHold: null,
      }),
    ).toEqual({ status: "VERIFIED", verifiedAt: "2026-09-25T18:09:00.000Z" });
  });

  it("ONLINE and healthy does NOT imply Verified — no success recorded → awaiting Ops", () => {
    const flags = flagsFor({});
    expect(flags).toEqual([]);
    expect(
      deriveLockVerification({ firstVerifiedAt: null, operationalHold: null }),
    ).toEqual({ status: "AWAITING_OPS", verifiedAt: null });
  });

  it("a hold never erases verification (a verified lock put on hold stays Verified)", () => {
    expect(
      deriveLockVerification({
        firstVerifiedAt: "2026-09-25T18:09:00.000Z",
        operationalHold: hold("OUT_OF_SERVICE", "Battery replacement"),
      }).status,
    ).toBe("VERIFIED");
  });

  it("an unverified lock out of service or excluded from testing is 'Not verified (on hold)', not awaiting Ops", () => {
    expect(
      deriveLockVerification({
        firstVerifiedAt: null,
        operationalHold: hold("OUT_OF_SERVICE", "Lock replacement required"),
      }).status,
    ).toBe("NOT_VERIFIED_ON_HOLD");
    expect(
      deriveLockVerification({
        firstVerifiedAt: null,
        operationalHold: hold("EXCLUDED_FROM_TESTING", "Connect error"),
      }).status,
    ).toBe("NOT_VERIFIED_ON_HOLD");
  });

  it("an onsite-inspection hold is Ops work, so the lock stays awaiting Ops verification", () => {
    expect(
      deriveLockVerification({
        firstVerifiedAt: null,
        operationalHold: hold("ONSITE_INSPECTION_REQUIRED", "Check deadbolt"),
      }).status,
    ).toBe("AWAITING_OPS");
  });
});

describe("deriveLockCondition — current condition, separate from verification", () => {
  it("no flags → Healthy", () => {
    expect(deriveLockCondition({ flags: [], operationalHold: null })).toEqual({
      status: "HEALTHY",
      reasons: [],
    });
  });

  it("Verified + degraded health coexist (Royal Palms: calibration needed; Moroccan Moon: unknown state)", () => {
    const royalPalms = deriveLockCondition({
      flags: flagsFor({ metadata: healthyMetadata({ doorState: "init" }) }),
      operationalHold: null,
    });
    expect(royalPalms.status).toBe("NEEDS_ATTENTION");
    expect(royalPalms.reasons).toContain("⚠ Calibration needed");

    const moroccanMoon = deriveLockCondition({
      flags: flagsFor({
        connectivity: "UNKNOWN",
        metadata: healthyMetadata({
          lockState: "unknown",
          lockStatusValid: false,
          connectivity: "UNKNOWN",
          consecutiveUnknownRefreshes: 3,
          unknownSince: "2026-09-28T12:00:00.000Z",
        }),
      }),
      operationalHold: null,
    });
    expect(moroccanMoon.status).toBe("NEEDS_ATTENTION");
    expect(moroccanMoon.reasons.length).toBeGreaterThan(0);

    // Verification comes from history alone — the degraded condition above
    // doesn't touch it.
    expect(
      deriveLockVerification({
        firstVerifiedAt: "2026-09-25T21:22:32.000Z",
        operationalHold: null,
      }).status,
    ).toBe("VERIFIED");
  });

  it("a command block (Coco Vista / Orion AMBIGUOUS, MJ Front FAILED) is its own condition with the reset requirement", () => {
    for (const outcome of ["AMBIGUOUS", "FAILED"]) {
      const condition = deriveLockCondition({
        flags: flagsFor({ lastCommandOutcome: outcome }),
        operationalHold: null,
        lastCommandOutcome: outcome,
      });
      expect(condition.status).toBe("COMMAND_BLOCKED");
      expect(condition.reasons[0]).toBe(
        `Last remote command ${outcome} — needs an in-person check and an admin reset before any remote command`,
      );
    }
  });

  it("a hold outranks everything and shows its kind and the admin's note (Florisun out of service / Lucky Charm excluded)", () => {
    const florisunHold = hold(
      "OUT_OF_SERVICE",
      "Lock replacement required (Kenny inspected 09-26)",
    );
    const florisun = deriveLockCondition({
      flags: flagsFor({
        operationalHold: florisunHold,
        lastCommandOutcome: "FAILED",
      }),
      operationalHold: florisunHold,
    });
    expect(florisun.status).toBe("ON_HOLD");
    expect(florisun.reasons[0]).toBe(
      "Out of service: Lock replacement required (Kenny inspected 09-26)",
    );

    const luckyHold = hold("EXCLUDED_FROM_TESTING", "Connect error on 09-25");
    expect(
      deriveLockCondition({
        flags: flagsFor({ operationalHold: luckyHold }),
        operationalHold: luckyHold,
      }).reasons[0],
    ).toBe("Excluded from testing: Connect error on 09-25");
  });
});

describe("describeDoorCondition", () => {
  it("only 'init' means calibration needed; missing/unrecognized is never guessed", () => {
    expect(describeDoorCondition("init")).toBe("Calibration needed");
    expect(describeDoorCondition("closed")).toBe("Closed");
    expect(describeDoorCondition("open")).toBe("Open");
    expect(describeDoorCondition(null)).toBe("Not reported");
    expect(describeDoorCondition("unknown")).toBe("Not reported");
  });
});

describe("Ops verification checklist", () => {
  const row = (
    overrides: Partial<LockVerificationRow> & { propertyName: string },
  ): LockVerificationRow => ({
    smartDeviceId: `id-${overrides.propertyName}`,
    lockName: "Front Door",
    verification: { status: "AWAITING_OPS", verifiedAt: null },
    condition: { status: "HEALTHY", reasons: [] },
    connectivity: "ONLINE",
    batteryLevel: 70,
    doorCondition: "Closed",
    ...overrides,
  });

  const verified = {
    status: "VERIFIED" as const,
    verifiedAt: "2026-09-25T18:09:00.000Z",
  };
  const rows = [
    row({ propertyName: "Driftwood", verification: verified }),
    row({
      propertyName: "Royal Palms",
      verification: verified,
      condition: {
        status: "NEEDS_ATTENTION",
        reasons: ["⚠ Calibration needed"],
      },
      batteryLevel: 28,
      doorCondition: "Calibration needed",
    }),
    row({ propertyName: "Mahalo" }),
    row({
      propertyName: "Orion's Landing",
      condition: {
        status: "COMMAND_BLOCKED",
        reasons: [
          "Last remote command AMBIGUOUS — needs an in-person check and an admin reset before any remote command",
        ],
      },
      connectivity: "UNKNOWN",
      batteryLevel: null,
      doorCondition: "Not reported",
    }),
    row({
      propertyName: "Florisun",
      verification: { status: "NOT_VERIFIED_ON_HOLD", verifiedAt: null },
      condition: {
        status: "ON_HOLD",
        reasons: ["Out of service: Lock replacement required"],
      },
    }),
  ];

  it("excludes verified locks unless their current condition needs attention", () => {
    expect(rows.filter(needsOpsFollowUp).map((r) => r.propertyName)).toEqual([
      "Royal Palms",
      "Mahalo",
      "Orion's Landing",
      "Florisun",
    ]);
    const text = buildOpsVerificationChecklist(rows, {
      generatedAt: "Sep 29, 7:00 AM",
    });
    expect(text).not.toContain("Driftwood");
    expect(text).toContain("Locks needing Ops verification or attention: 4");
  });

  it("lists awaiting-Ops locks first, then on-hold, then verified-needing-attention, each with only operational fields", () => {
    const text = buildOpsVerificationChecklist(rows, {
      generatedAt: "Sep 29, 7:00 AM",
    });
    expect(text).toBe(
      [
        "StayWhile — August lock Ops verification checklist",
        "Generated Sep 29, 7:00 AM",
        "Locks needing Ops verification or attention: 4",
        "",
        "1. Mahalo — Front Door",
        "   Verification: Awaiting Ops verification",
        "   Status: Online · Battery: 70% · Door: Closed",
        "   Condition: Healthy",
        "",
        "2. Orion's Landing — Front Door",
        "   Verification: Awaiting Ops verification",
        "   Status: Unknown · Battery: not reported · Door: Not reported",
        "   Condition: Command blocked — Last remote command AMBIGUOUS — needs an in-person check and an admin reset before any remote command",
        "",
        "3. Florisun — Front Door",
        "   Verification: Not verified (on hold)",
        "   Status: Online · Battery: 70% · Door: Closed",
        "   Condition: On hold — Out of service: Lock replacement required",
        "",
        "4. Royal Palms — Front Door",
        "   Verification: Verified (current condition needs attention)",
        "   Status: Online · Battery: 28% · Door: Calibration needed",
        "   Condition: Needs attention — ⚠ Calibration needed",
      ].join("\n"),
    );
  });

  it("never includes ids or anything beyond the operational fields", () => {
    const text = buildOpsVerificationChecklist(rows, {
      generatedAt: "Sep 29, 7:00 AM",
    });
    for (const r of rows) expect(text).not.toContain(r.smartDeviceId);
    expect(text).not.toMatch(/pin|access code|guest|token|password/i);
  });
});
