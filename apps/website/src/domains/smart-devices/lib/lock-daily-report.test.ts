import { describe, expect, it } from "vitest";

import {
  buildDailyLockReport,
  countLocksNeedingAttention,
  formatDailyLockReportText,
  getLockFlagAction,
  NEW_WITHIN_MS,
  type LockReportRow,
} from "./lock-daily-report";
import {
  classifyLockHealth,
  type LockHealthFlag,
  type LockHealthFlagCode,
  type LockHealthSnapshot,
  type OperationalHold,
} from "./lock-health";
import {
  deriveLockCondition,
  deriveLockVerification,
} from "./lock-verification";

const NOW = new Date("2026-09-29T17:00:00.000Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

function snapshot(overrides: Partial<LockHealthSnapshot> = {}) {
  return {
    lockHealth: {
      observedAt: hoursAgo(0.1),
      lockState: "locked",
      lockStatusValid: true,
      lockStatusAt: hoursAgo(0.1),
      unknownReason: null,
      doorState: "closed",
      connectivity: "ONLINE",
      bridgePresent: true,
      bridgeLastOnline: hoursAgo(0.1),
      bridgeLastOffline: null,
      wifiConnectionIssueCount: 0,
      batteryLevel: 80,
      batteryWarningState: "lock_state_battery_warning_none",
      batteryReadingAt: hoursAgo(2),
      lastValidLockState: "locked",
      lastValidLockStateAt: hoursAgo(0.1),
      lockStateSince: null,
      consecutiveUnknownRefreshes: 0,
      ...overrides,
    } satisfies LockHealthSnapshot,
  };
}

const hold = (
  kind: OperationalHold["kind"],
  note: string,
  setAt = hoursAgo(3),
): OperationalHold => ({ kind, note, setAt, setByUserId: "admin" });

function row(
  propertyName: string,
  input: {
    metadata?: unknown;
    connectivity?: string;
    lastCommandOutcome?: string | null;
    operationalHold?: OperationalHold | null;
    recentUnknownTransitions?: number;
  } = {},
): LockReportRow & {
  hold: OperationalHold | null;
  outcome: string | null;
} {
  return {
    smartDeviceId: `id-${propertyName}`,
    propertyName,
    lockName: "Front Door",
    flags: classifyLockHealth({
      metadata: input.metadata ?? snapshot(),
      connectivity: input.connectivity ?? "ONLINE",
      now: NOW,
      recentUnknownTransitions: input.recentUnknownTransitions ?? 0,
      lastCommandOutcome: input.lastCommandOutcome ?? null,
      operationalHold: input.operationalHold ?? null,
    }),
    hold: input.operationalHold ?? null,
    outcome: input.lastCommandOutcome ?? null,
  };
}

const codes = (r: LockReportRow) => r.flags.map((f) => f.code);

describe("each health flag's Ops action (display-only)", () => {
  const cases: Array<[string, LockReportRow, LockHealthFlagCode, string]> = [
    [
      "low battery",
      row("A", { metadata: snapshot({ batteryLevel: 25 }) }),
      "LOW_BATTERY",
      "Replace batteries onsite.",
    ],
    [
      "bridge offline",
      row("B", {
        connectivity: "OFFLINE",
        metadata: snapshot({
          connectivity: "OFFLINE",
          bridgeLastOnline: hoursAgo(30),
        }),
      }),
      "OFFLINE",
      "Check bridge power and Wi-Fi onsite.",
    ],
    [
      "no bridge",
      row("C", { metadata: snapshot({ bridgePresent: false }) }),
      "NO_BRIDGE",
      "Confirm the bridge setup/assignment with Ops/admin.",
    ],
    [
      "calibration needed",
      row("D", { metadata: snapshot({ doorState: "init" }) }),
      "DOOR_SENSOR_CALIBRATION_NEEDED",
      "Calibrate DoorSense in the August app onsite.",
    ],
    [
      "persistent unknown",
      row("E", {
        metadata: snapshot({
          lockState: "unknown",
          lockStatusValid: false,
          lockStateSince: hoursAgo(5),
          unknownSince: hoursAgo(5),
          consecutiveUnknownRefreshes: 3,
        }),
      }),
      "UNKNOWN_STATE",
      "Check lock/bridge connectivity onsite; do not remote-test until the state is stable.",
    ],
    [
      "unlocked",
      row("F", {
        metadata: snapshot({
          lockState: "unlocked",
          lockStateSince: hoursAgo(2),
        }),
      }),
      "UNLOCKED",
      "Confirm the lock should be unlocked; secure it onsite if needed.",
    ],
    [
      "door open + unlocked",
      row("G", {
        metadata: snapshot({
          lockState: "unlocked",
          doorState: "open",
          lockStateSince: hoursAgo(2),
        }),
      }),
      "DOOR_OPEN_UNLOCKED",
      "Confirm the door is closed and the property is secure onsite.",
    ],
    [
      "command blocked",
      row("H", { lastCommandOutcome: "AMBIGUOUS" }),
      "COMMAND_BLOCKED",
      "Perform the required in-person check and provide evidence before any admin reset.",
    ],
    [
      "stale lock status",
      row("I", {
        metadata: snapshot({
          observedAt: hoursAgo(20),
          lockStatusAt: hoursAgo(20),
        }),
      }),
      "STALE_LOCK_TELEMETRY",
      "Check in the August app that the lock and bridge are online; tell an admin if the status stays stale.",
    ],
    [
      "stale battery reading",
      row("J", { metadata: snapshot({ batteryReadingAt: hoursAgo(24 * 10) }) }),
      "STALE_BATTERY_TELEMETRY",
      "Check the battery level in the August app; replace batteries onsite if low.",
    ],
    [
      "possible lock problem",
      row("K", { recentUnknownTransitions: 4 }),
      "POSSIBLE_LOCK_PROBLEM",
      "Check the lock in the August app and inspect it onsite; do not remote-test.",
    ],
  ];

  it.each(cases)("%s → its action", (_name, r, code, action) => {
    const flag = r.flags.find((f) => f.code === code);
    expect(flag, `${code} not raised`).toBeTruthy();
    expect(getLockFlagAction(flag!)).toBe(action);
  });

  it("holds: out of service / excluded / onsite inspection", () => {
    const action = (kind: OperationalHold["kind"]) =>
      getLockFlagAction(
        row("X", { operationalHold: hold(kind, "note") }).flags.find(
          (f) => f.code === "OPERATIONAL_HOLD",
        )!,
      );
    expect(action("OUT_OF_SERVICE")).toBe(
      "Leave out of service until the lock is repaired or replaced. No remote commands or testing.",
    );
    expect(action("EXCLUDED_FROM_TESTING")).toBe(
      "No physical testing until an admin decides otherwise.",
    );
    expect(action("ONSITE_INSPECTION_REQUIRED")).toBe(
      "Inspect onsite and report what you find to an admin.",
    );
  });

  it("a non-persistent unknown and 'no health reading yet' get their own wording", () => {
    const blip = row("Y", {
      metadata: snapshot({
        lockState: "unknown",
        lockStatusValid: false,
        lockStateSince: hoursAgo(0.1),
        unknownSince: hoursAgo(0.1),
        consecutiveUnknownRefreshes: 1,
      }),
    }).flags.find((f) => f.code === "UNKNOWN_STATE")!;
    expect(blip.label).toBe("State unknown");
    expect(getLockFlagAction(blip)).toMatch(/^Watch the next refresh/);
    const noReading = row("Z", { metadata: {} }).flags[0]!;
    expect(noReading.label).toBe("No health reading yet");
    expect(getLockFlagAction(noReading)).toBe(
      "Wait for the next refresh; tell an admin if no reading appears.",
    );
  });

  it("no action ever tells Ops to use the dashboard's remote Lock/Unlock, reset, or calibrate remotely", () => {
    const all = cases.flatMap(([, r]) => r.flags);
    for (const kind of [
      "OUT_OF_SERVICE",
      "EXCLUDED_FROM_TESTING",
      "ONSITE_INSPECTION_REQUIRED",
    ] as const) {
      all.push(...row("H", { operationalHold: hold(kind, "n") }).flags);
    }
    for (const flag of all) {
      const action = getLockFlagAction(flag);
      expect(action).not.toMatch(
        /dashboard|remote(ly)? (lock|unlock)|lock\/unlock|press (lock|unlock)|reset the lock|calibrate remotely/i,
      );
    }
  });
});

describe("report items: severity ordering, detail, start/duration, New", () => {
  it("worst first: Urgent (red) before High (orange) before Routine (yellow); security before maintenance within a severity", () => {
    const report = buildDailyLockReport(
      [
        row("Calib", { metadata: snapshot({ doorState: "init" }) }),
        row("Blocked", { lastCommandOutcome: "FAILED" }),
        row("Offline", {
          connectivity: "OFFLINE",
          metadata: snapshot({
            connectivity: "OFFLINE",
            bridgeLastOnline: hoursAgo(40),
          }),
        }),
        row("Open", {
          metadata: snapshot({
            lockState: "unlocked",
            doorState: "open",
            lockStateSince: hoursAgo(1),
          }),
        }),
      ],
      NOW,
    );
    expect(report.items.map((i) => [i.severity, i.code])).toEqual([
      ["red", "DOOR_OPEN_UNLOCKED"],
      ["red", "OFFLINE"],
      ["orange", "COMMAND_BLOCKED"],
      ["yellow", "DOOR_SENSOR_CALIBRATION_NEEDED"],
    ]);
  });

  it("carries the classifier's detail (battery %, last online, unknown reason)", () => {
    const report = buildDailyLockReport(
      [
        row("Battery", { metadata: snapshot({ batteryLevel: 17 }) }),
        row("Offline", {
          connectivity: "OFFLINE",
          metadata: snapshot({
            connectivity: "OFFLINE",
            bridgeLastOnline: hoursAgo(72),
          }),
        }),
      ],
      NOW,
    );
    expect(report.items.find((i) => i.code === "LOW_BATTERY")!.detail).toBe(
      "17%.",
    );
    expect(report.items.find((i) => i.code === "OFFLINE")!.detail).toBe(
      "Last online 3 days ago (over 12 h).",
    );
  });

  it("start + duration only from trusted start times; New only if it began < 24 h ago", () => {
    const report = buildDailyLockReport(
      [
        row("Fresh", {
          metadata: snapshot({
            lockState: "unlocked",
            lockStateSince: hoursAgo(23.9),
          }),
        }),
        row("Old", {
          metadata: snapshot({
            lockState: "unlocked",
            lockStateSince: hoursAgo(24),
          }),
        }),
      ],
      NOW,
    );
    const fresh = report.items.find((i) => i.propertyName === "Fresh")!;
    const old = report.items.find((i) => i.propertyName === "Old")!;
    expect(fresh).toMatchObject({
      startedAt: hoursAgo(23.9),
      duration: "for 23 h",
      isNew: true,
    });
    expect(old).toMatchObject({
      startedAt: hoursAgo(24),
      duration: "for 24 h",
      isNew: false,
    });
    expect(NEW_WITHIN_MS).toBe(24 * 3_600_000);
    expect(report.newCount).toBe(1);
  });

  it("no false New: a reading time (battery report) is shown as 'last reading', never a start, never New", () => {
    const report = buildDailyLockReport(
      [
        row("Battery", {
          metadata: snapshot({
            batteryLevel: 25,
            batteryReadingAt: hoursAgo(1),
          }),
        }),
      ],
      NOW,
    );
    expect(report.items[0]).toMatchObject({
      code: "LOW_BATTERY",
      startedAt: null,
      lastReadingAt: hoursAgo(1),
      duration: null,
      isNew: false,
    });
  });

  it("no false New without any timestamp (command block, calibration, unlocked since before monitoring)", () => {
    const report = buildDailyLockReport(
      [
        row("Blocked", { lastCommandOutcome: "AMBIGUOUS" }),
        row("Calib", { metadata: snapshot({ doorState: "init" }) }),
        row("Unlocked", {
          metadata: snapshot({ lockState: "unlocked", lockStateSince: null }),
        }),
      ],
      NOW,
    );
    for (const item of report.items) {
      expect(item).toMatchObject({
        startedAt: null,
        isNew: false,
        duration: null,
      });
    }
  });

  it("a hold set today is New with its set time as the start", () => {
    const report = buildDailyLockReport(
      [
        row("Florisun", {
          operationalHold: hold(
            "OUT_OF_SERVICE",
            "Lock replacement required (Kenny inspected 09-26)",
            hoursAgo(3),
          ),
        }),
      ],
      NOW,
    );
    expect(report.items[0]).toMatchObject({
      code: "OPERATIONAL_HOLD",
      startedAt: hoursAgo(3),
      isNew: true,
      duration: "for 3 h",
    });
  });

  it("empty fleet → no items", () => {
    const report = buildDailyLockReport([row("Healthy")], NOW);
    expect(report).toMatchObject({
      items: [],
      locksNeedingAttention: 0,
      newCount: 0,
    });
  });
});

describe("Copy text", () => {
  const fmt = (iso: string) => `T(${iso.slice(11, 16)})`;

  it("plain text grouped by severity with New, detail, since/last reading and action", () => {
    const report = buildDailyLockReport(
      [
        row("Palm Haven", {
          metadata: snapshot({
            batteryLevel: 25,
            batteryReadingAt: hoursAgo(2),
          }),
        }),
        row("Orion's Landing", { lastCommandOutcome: "AMBIGUOUS" }),
        row("Bonjour", {
          metadata: snapshot({
            lockState: "unlocked",
            doorState: "open",
            lockStateSince: hoursAgo(5),
          }),
        }),
      ],
      NOW,
    );
    const text = formatDailyLockReportText(report, {
      generatedAt: "Sep 29, 12:00 PM",
      formatTime: fmt,
    });
    expect(text).toBe(
      [
        "StayWhile — Daily lock report",
        "Generated Sep 29, 12:00 PM",
        "Locks needing attention: 3 · Items: 3 (Urgent 1, High 1, Routine 1) · New in last 24 h: 1",
        "",
        "== URGENT ==",
        "1. [NEW] Bonjour — Front Door: Door open and unlocked",
        "   Detail: Unlocked for 5 h.",
        "   Since T(12:00) (for 5 h)",
        "   Action: Confirm the door is closed and the property is secure onsite.",
        "",
        "== HIGH ==",
        "2. Orion's Landing — Front Door: Command blocked (AMBIGUOUS)",
        "   Detail: Last remote command was AMBIGUOUS. Needs a truthful in-person check and an admin Reset after physical check before any further remote command.",
        "   Action: Perform the required in-person check and provide evidence before any admin reset.",
        "",
        "== ROUTINE ==",
        "3. Palm Haven — Front Door: Battery low",
        "   Detail: 25%.",
        "   Last reading T(15:00)",
        "   Action: Replace batteries onsite.",
      ].join("\n"),
    );
  });

  it("never contains ids, PINs, access codes, guest data or credentials", () => {
    const rows = [
      row("Aqua Palm", { metadata: snapshot({ batteryLevel: 10 }) }),
      row("Florisun", {
        operationalHold: hold("OUT_OF_SERVICE", "Lock replacement required"),
      }),
    ];
    const text = formatDailyLockReportText(buildDailyLockReport(rows, NOW), {
      generatedAt: "now",
      formatTime: fmt,
    });
    for (const r of rows) expect(text).not.toContain(r.smartDeviceId);
    expect(text).not.toMatch(
      /\bpin\b|access code|guest|token|password|secret|[0-9a-f]{32}/i,
    );
  });

  it("an all-clear report says so", () => {
    expect(
      formatDailyLockReportText(buildDailyLockReport([row("Ok")], NOW), {
        generatedAt: "now",
        formatTime: fmt,
      }),
    ).toContain("No lock health problems right now.");
  });
});

describe("canonical Needs attention + safety truth preserved", () => {
  // The current fleet's special states, as fixtures (no ids from Production).
  const fleet = [
    { ...row("Aqua Palm"), verifiedAt: hoursAgo(240) },
    { ...row("Driftwood"), verifiedAt: hoursAgo(100) },
    {
      ...row("Royal Palms", {
        metadata: snapshot({ doorState: "init", batteryLevel: 28 }),
      }),
      verifiedAt: hoursAgo(99),
    },
    { ...row("Once Upon a Pond"), verifiedAt: hoursAgo(97) },
    {
      ...row("Moroccan Moon", {
        metadata: snapshot({
          lockState: "unknown",
          lockStatusValid: false,
          lockStateSince: hoursAgo(2),
          unknownSince: hoursAgo(2),
          consecutiveUnknownRefreshes: 3,
        }),
      }),
      verifiedAt: hoursAgo(96),
    },
    {
      ...row("Coco Vista", { lastCommandOutcome: "AMBIGUOUS" }),
      verifiedAt: null,
    },
    {
      ...row("Orion's Landing", { lastCommandOutcome: "AMBIGUOUS" }),
      verifiedAt: null,
    },
    {
      ...row("Majestic Isla", { lastCommandOutcome: "FAILED" }),
      verifiedAt: null,
    },
    {
      ...row("Florisun", {
        operationalHold: hold(
          "OUT_OF_SERVICE",
          "Lock replacement required (Kenny inspected 09-26)",
        ),
      }),
      verifiedAt: null,
    },
    {
      ...row("Lucky Charm", {
        operationalHold: hold(
          "EXCLUDED_FROM_TESTING",
          "unknown_error_during_connect on 09-25",
        ),
      }),
      verifiedAt: null,
    },
    { ...row("Mahalo"), verifiedAt: null },
    { ...row("Picasa"), verifiedAt: null },
  ];

  it("Needs attention = locks with ≥1 classifier flag; equals the report's count and the verification panel's non-Healthy total", () => {
    const report = buildDailyLockReport(fleet, NOW);
    const conditions = fleet.map((r) =>
      deriveLockCondition({
        flags: r.flags,
        operationalHold: r.hold,
        lastCommandOutcome: r.outcome,
      }),
    );
    const nonHealthy = conditions.filter((c) => c.status !== "HEALTHY").length;
    expect(countLocksNeedingAttention(fleet)).toBe(7);
    expect(report.locksNeedingAttention).toBe(7);
    expect(nonHealthy).toBe(7);
  });

  it("holds, blocks and verification stay truthful; Verified + Needs attention coexist; ONLINE ≠ Verified", () => {
    const view = (name: string) => {
      const r = fleet.find((f) => f.propertyName === name)!;
      return {
        codes: codes(r),
        verification: deriveLockVerification({
          firstVerifiedAt: r.verifiedAt,
          operationalHold: r.hold,
        }).status,
        condition: deriveLockCondition({
          flags: r.flags,
          operationalHold: r.hold,
          lastCommandOutcome: r.outcome,
        }).status,
      };
    };
    const verified = fleet.filter(
      (r) =>
        deriveLockVerification({
          firstVerifiedAt: r.verifiedAt,
          operationalHold: r.hold,
        }).status === "VERIFIED",
    );
    expect(verified.map((r) => r.propertyName)).toEqual([
      "Aqua Palm",
      "Driftwood",
      "Royal Palms",
      "Once Upon a Pond",
      "Moroccan Moon",
    ]);
    expect(view("Florisun")).toMatchObject({
      verification: "NOT_VERIFIED_ON_HOLD",
      condition: "ON_HOLD",
    });
    expect(view("Lucky Charm")).toMatchObject({
      verification: "NOT_VERIFIED_ON_HOLD",
      condition: "ON_HOLD",
    });
    for (const name of ["Coco Vista", "Orion's Landing", "Majestic Isla"]) {
      expect(view(name)).toMatchObject({
        verification: "AWAITING_OPS",
        condition: "COMMAND_BLOCKED",
      });
      expect(view(name).codes).toContain("COMMAND_BLOCKED");
    }
    expect(view("Royal Palms")).toMatchObject({
      verification: "VERIFIED",
      condition: "NEEDS_ATTENTION",
    });
    expect(view("Moroccan Moon")).toMatchObject({
      verification: "VERIFIED",
      condition: "NEEDS_ATTENTION",
    });
    expect(view("Mahalo")).toMatchObject({
      verification: "AWAITING_OPS",
      condition: "HEALTHY",
      codes: [],
    });
  });

  it("the report lists the hold/block items with their truthful actions — never an instruction to clear or bypass them", () => {
    const report = buildDailyLockReport(fleet, NOW);
    const item = (name: string) =>
      report.items.find((i) => i.propertyName === name)!;
    expect(item("Florisun").action).toMatch(/^Leave out of service/);
    expect(item("Lucky Charm").action).toBe(
      "No physical testing until an admin decides otherwise.",
    );
    expect(item("Orion's Landing").action).toMatch(
      /provide evidence before any admin reset/,
    );
    for (const i of report.items) {
      expect(i.action).not.toMatch(/clear (the )?hold|test controllability/i);
    }
  });
});

// Flags used only for type completeness checks below.
const _exhaustive: Record<LockHealthFlagCode, true> = {
  OPERATIONAL_HOLD: true,
  COMMAND_BLOCKED: true,
  DOOR_OPEN_UNLOCKED: true,
  UNLOCKED: true,
  NO_BRIDGE: true,
  OFFLINE: true,
  UNKNOWN_STATE: true,
  POSSIBLE_LOCK_PROBLEM: true,
  LOW_BATTERY: true,
  DOOR_SENSOR_CALIBRATION_NEEDED: true,
  STALE_LOCK_TELEMETRY: true,
  STALE_BATTERY_TELEMETRY: true,
};

describe("coverage", () => {
  it("every flag code has a non-empty action", () => {
    for (const code of Object.keys(_exhaustive) as LockHealthFlagCode[]) {
      const flag: LockHealthFlag = {
        code,
        severity: "yellow",
        label: code === "OPERATIONAL_HOLD" ? "Out of service" : "x",
        detail: "",
        since: null,
      };
      expect(getLockFlagAction(flag).length).toBeGreaterThan(10);
    }
  });
});
