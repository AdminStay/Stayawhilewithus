import type { AugustLockDetail } from "@stayw/integrations/august";
import { describe, expect, it } from "vitest";

import {
  buildLockHealthUpdate,
  classifyLockHealth,
  getLockHealthSnapshot,
  isDoorSensorCalibrationNeeded,
  type LockHealthSnapshot,
} from "./lock-health";

const T0 = new Date("2026-09-25T20:00:00.000Z");
const T1 = new Date("2026-09-26T02:00:00.000Z");

function detail(
  overrides: Partial<AugustLockDetail> = {},
  health: Partial<NonNullable<AugustLockDetail["health"]>> = {},
): AugustLockDetail {
  return {
    id: "lock-1",
    name: "Front Door",
    houseId: "house-1",
    batteryLevel: 80,
    connectivity: "ONLINE",
    lockState: "locked",
    telemetryUpdatedAt: "2026-09-25T19:00:00.000Z",
    seenAt: "2026-09-25T19:59:00.000Z",
    serialNumber: "S1",
    ...overrides,
    health: {
      lockStatus: "locked",
      lockStatusValid: true,
      lockStatusAt: "2026-09-25T19:59:00.000Z",
      unknownReason: null,
      doorState: "closed",
      bridgePresent: true,
      bridgeLastOnline: "2026-09-25T19:59:00.000Z",
      bridgeLastOffline: "2026-09-20T00:00:00.000Z",
      wifiConnectionIssueCount: 0,
      batteryWarningState: "lock_state_battery_warning_none",
      ...health,
    },
  };
}

describe("buildLockHealthUpdate", () => {
  it("first capture: stores the snapshot, keeps other metadata keys, records NO events", () => {
    const { metadata, events } = buildLockHealthUpdate(
      { retiredAt: null, custom: "keep" },
      detail(),
      T0,
    );
    expect(events).toEqual([]);
    expect(metadata).toMatchObject({
      custom: "keep",
      lockState: "locked",
      batteryLevel: 80,
      telemetryUpdatedAt: "2026-09-25T19:00:00.000Z",
    });
    const s = getLockHealthSnapshot(metadata)!;
    expect(s).toMatchObject({
      observedAt: T0.toISOString(),
      lockState: "locked",
      lastValidLockState: "locked",
      lastValidLockStateAt: "2026-09-25T19:59:00.000Z",
      lockStateSince: null,
      consecutiveUnknownRefreshes: 0,
      doorState: "closed",
      bridgePresent: true,
    });
  });

  it("an invalid/unknown reading NEVER keeps an old locked/unlocked value: current becomes unknown, last valid is kept separately", () => {
    const first = buildLockHealthUpdate({}, detail(), T0).metadata;
    const { metadata, events } = buildLockHealthUpdate(
      first,
      detail(
        { lockState: "unknown" },
        {
          lockStatus: "unknown",
          lockStatusAt: "2026-09-26T01:59:00.000Z",
          unknownReason: "unknown_error_during_connect",
        },
      ),
      T1,
    );
    expect(metadata.lockState).toBe("unknown");
    const s = getLockHealthSnapshot(metadata)!;
    expect(s.lockState).toBe("unknown");
    expect(s.lastValidLockState).toBe("locked");
    expect(s.lastValidLockStateAt).toBe("2026-09-25T19:59:00.000Z");
    expect(s.unknownReason).toBe("unknown_error_during_connect");
    expect(s.consecutiveUnknownRefreshes).toBe(1);
    expect(events).toEqual([
      {
        eventType: "LOCK_STATE_CHANGED",
        payload: {
          from: "locked",
          to: "unknown",
          unknownReason: "unknown_error_during_connect",
          providerStatusAt: "2026-09-26T01:59:00.000Z",
        },
        occurredAt: T1,
      },
    ]);
  });

  it("valid=false (even with a raw 'locked') is treated as unknown", () => {
    const { metadata } = buildLockHealthUpdate(
      {},
      detail(
        { lockState: null },
        { lockStatus: "locked", lockStatusValid: false },
      ),
      T0,
    );
    expect(metadata.lockState).toBe("unknown");
    expect(getLockHealthSnapshot(metadata)!.lastValidLockState).toBeNull();
  });

  it("records each meaningful transition once, and nothing when nothing changed", () => {
    const first = buildLockHealthUpdate({}, detail(), T0).metadata;
    const same = buildLockHealthUpdate(first, detail(), T1);
    expect(same.events).toEqual([]);

    const changed = buildLockHealthUpdate(
      first,
      detail(
        { lockState: "unlocked", connectivity: "OFFLINE" },
        {
          lockStatus: "unlocked",
          doorState: "open",
          batteryWarningState: "lock_state_battery_warning_low",
          wifiConnectionIssueCount: 2,
          lockStatusAt: "2026-09-26T01:00:00.000Z",
        },
      ),
      T1,
    );
    expect(
      changed.events.map((e) => [e.eventType, e.payload.from, e.payload.to]),
    ).toEqual([
      ["LOCK_STATE_CHANGED", "locked", "unlocked"],
      ["CONNECTIVITY_CHANGED", "ONLINE", "OFFLINE"],
      ["DOOR_STATE_CHANGED", "closed", "open"],
      [
        "BATTERY_WARNING_CHANGED",
        "lock_state_battery_warning_none",
        "lock_state_battery_warning_low",
      ],
      ["WIFI_ISSUE_COUNT_INCREASED", 0, 2],
    ]);
    const s = getLockHealthSnapshot(changed.metadata)!;
    expect(s.lockStateSince).toBe("2026-09-26T01:00:00.000Z");
    expect(s.lastValidLockState).toBe("unlocked");
  });

  it("unknown → known recovery is a transition and resets the consecutive-unknown counter", () => {
    const a = buildLockHealthUpdate({}, detail(), T0).metadata;
    const b = buildLockHealthUpdate(
      a,
      detail({}, { lockStatus: "unknown" }),
      T1,
    ).metadata;
    const c = buildLockHealthUpdate(
      b,
      detail(),
      new Date("2026-09-26T08:00:00.000Z"),
    );
    expect(c.events.map((e) => [e.payload.from, e.payload.to])).toEqual([
      ["unknown", "locked"],
    ]);
    expect(getLockHealthSnapshot(c.metadata)!.consecutiveUnknownRefreshes).toBe(
      0,
    );
  });

  it("a reading without a health block (older callers/fixtures) falls back to the previous merge and records nothing", () => {
    const d = detail();
    delete d.health;
    const { metadata, events } = buildLockHealthUpdate({ keep: 1 }, d, T0);
    expect(events).toEqual([]);
    expect(metadata).toEqual({
      keep: 1,
      batteryLevel: 80,
      telemetryUpdatedAt: "2026-09-25T19:00:00.000Z",
      lockState: "locked",
    });
  });
});

function snapshot(overrides: Partial<LockHealthSnapshot> = {}): {
  lockHealth: LockHealthSnapshot;
} {
  return {
    lockHealth: {
      observedAt: "2026-09-25T19:55:00.000Z",
      lockState: "locked",
      lockStatusValid: true,
      lockStatusAt: "2026-09-25T19:55:00.000Z",
      unknownReason: null,
      doorState: "closed",
      connectivity: "ONLINE",
      bridgePresent: true,
      bridgeLastOnline: "2026-09-25T19:55:00.000Z",
      bridgeLastOffline: null,
      wifiConnectionIssueCount: 0,
      batteryLevel: 80,
      batteryWarningState: "lock_state_battery_warning_none",
      batteryReadingAt: "2026-09-25T10:00:00.000Z",
      lastValidLockState: "locked",
      lastValidLockStateAt: "2026-09-25T19:55:00.000Z",
      lockStateSince: null,
      consecutiveUnknownRefreshes: 0,
      ...overrides,
    },
  };
}

function flagsFor(
  overrides: Partial<LockHealthSnapshot>,
  extra: Partial<Parameters<typeof classifyLockHealth>[0]> = {},
) {
  return classifyLockHealth({
    metadata: snapshot(overrides),
    connectivity: overrides.connectivity ?? "ONLINE",
    now: T0,
    recentUnknownTransitions: 0,
    ...extra,
  }).map((f) => f.code);
}

describe("classifyLockHealth", () => {
  it("a healthy, locked, online lock with fresh readings has no flags", () => {
    expect(flagsFor({})).toEqual([]);
  });

  it("door open + unlocked is red and replaces the plain unlocked flag", () => {
    expect(flagsFor({ lockState: "unlocked", doorState: "open" })).toEqual([
      "DOOR_OPEN_UNLOCKED",
    ]);
  });

  it("any valid unlocked lock is flagged (no duration threshold yet), with occupancy called out", () => {
    const [flag] = classifyLockHealth({
      metadata: snapshot({
        lockState: "unlocked",
        lockStateSince: "2026-09-25T17:00:00.000Z",
      }),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
    });
    expect(flag).toMatchObject({ code: "UNLOCKED", severity: "red" });
    expect(flag!.detail).toContain("3 h");
    expect(flag!.detail).toContain("Occupancy is not considered");
  });

  it("no bridge / offline bridge are red; offline says how long since last online", () => {
    expect(
      flagsFor({
        bridgePresent: false,
        lockState: "unknown",
        lockStatusAt: null,
      }),
    ).toContain("NO_BRIDGE");
    const offline = classifyLockHealth({
      metadata: snapshot({
        connectivity: "OFFLINE",
        bridgeLastOnline: "2026-09-21T16:00:00.000Z",
      }),
      connectivity: "OFFLINE",
      now: T0,
      recentUnknownTransitions: 0,
    }).find((f) => f.code === "OFFLINE");
    expect(offline).toMatchObject({ severity: "red" });
    expect(offline!.detail).toContain("over 12 h");
  });

  it("unknown state: one refresh is orange; a reason or persistence also raises 'possible lock problem' (never 'jammed')", () => {
    expect(
      flagsFor({ lockState: "unknown", consecutiveUnknownRefreshes: 1 }),
    ).toEqual(["UNKNOWN_STATE"]);
    const flags = classifyLockHealth({
      metadata: snapshot({
        lockState: "unknown",
        consecutiveUnknownRefreshes: 2,
        unknownReason: "unknown_error_during_connect",
      }),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
    });
    expect(flags.map((f) => f.code)).toEqual([
      "UNKNOWN_STATE",
      "POSSIBLE_LOCK_PROBLEM",
    ]);
    const problem = flags.find((f) => f.code === "POSSIBLE_LOCK_PROBLEM")!;
    expect(problem.label).toBe(
      "Possible lock problem — check August app or inspect onsite",
    );
    expect(JSON.stringify(flags).toLowerCase()).not.toContain("jammed");
  });

  it("frequent unknown (3 in 24 h) raises 'possible lock problem'", () => {
    expect(flagsFor({}, { recentUnknownTransitions: 3 })).toEqual([
      "POSSIBLE_LOCK_PROBLEM",
    ]);
    expect(flagsFor({}, { lastCommandOutcome: "SUCCEEDED" })).toEqual([]);
  });

  it("FAILED/AMBIGUOUS history is its own 'Command blocked' flag, shown whatever the telemetry says", () => {
    const [blocked] = classifyLockHealth({
      metadata: snapshot(),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
      lastCommandOutcome: "AMBIGUOUS",
    });
    expect(blocked).toMatchObject({
      code: "COMMAND_BLOCKED",
      severity: "orange",
      label: "Command blocked (AMBIGUOUS)",
    });
    expect(blocked!.detail).toContain("in-person check");
  });

  it("an admin operational hold is always red and first — healthy telemetry can't clear it (Florisun)", () => {
    const flags = classifyLockHealth({
      metadata: snapshot(),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
      operationalHold: {
        kind: "OUT_OF_SERVICE",
        note: "Lock replacement required.",
        setAt: "2026-09-26T00:00:00.000Z",
        setByUserId: "admin-1",
      },
    });
    expect(flags).toEqual([
      expect.objectContaining({
        code: "OPERATIONAL_HOLD",
        severity: "red",
        label: "Out of service",
        since: "2026-09-26T00:00:00.000Z",
      }),
    ]);
  });

  it("holds and command blocks still show for a lock with no health snapshot yet", () => {
    const codes = classifyLockHealth({
      metadata: {},
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
      lastCommandOutcome: "FAILED",
      operationalHold: {
        kind: "EXCLUDED_FROM_TESTING",
        note: "Connection instability.",
        setAt: "2026-09-26T00:00:00.000Z",
        setByUserId: "a",
      },
    }).map((f) => f.code);
    expect(codes).toEqual([
      "OPERATIONAL_HOLD",
      "COMMAND_BLOCKED",
      "STALE_LOCK_TELEMETRY",
    ]);
  });

  it("door OPEN is only claimed from a real 'open' reading: init/unknown door sensors never produce a door-open flag", () => {
    // init is reported as calibration needed (below), never as door open.
    expect(flagsFor({ lockState: "unlocked", doorState: "init" })).toEqual([
      "UNLOCKED",
      "DOOR_SENSOR_CALIBRATION_NEEDED",
    ]);
    expect(flagsFor({ lockState: "unlocked", doorState: "unknown" })).toEqual([
      "UNLOCKED",
    ]);
  });

  it("battery: under 30% yellow, under 20% or an August warning orange", () => {
    const low = classifyLockHealth({
      metadata: snapshot({ batteryLevel: 28 }),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
    });
    expect(low).toEqual([
      expect.objectContaining({
        code: "LOW_BATTERY",
        severity: "yellow",
        label: "Battery low",
      }),
    ]);
    const critical = classifyLockHealth({
      metadata: snapshot({ batteryLevel: 19 }),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
    });
    expect(critical).toEqual([
      expect.objectContaining({
        code: "LOW_BATTERY",
        severity: "orange",
        label: "Battery critical",
      }),
    ]);
    expect(
      flagsFor({ batteryWarningState: "lock_state_battery_warning_low" }),
    ).toEqual(["LOW_BATTERY"]);
  });

  it("stale lock telemetry after 12 h; stale battery reading after 7 days", () => {
    expect(flagsFor({ observedAt: "2026-09-25T06:00:00.000Z" })).toEqual([
      "STALE_LOCK_TELEMETRY",
    ]);
    expect(flagsFor({ lockStatusAt: "2026-09-25T06:00:00.000Z" })).toEqual([
      "STALE_LOCK_TELEMETRY",
    ]);
    expect(flagsFor({ batteryReadingAt: "2026-09-15T20:56:47.797Z" })).toEqual([
      "STALE_BATTERY_TELEMETRY",
    ]);
  });

  it("a lock with no snapshot yet is reported as waiting for its first health reading", () => {
    expect(
      classifyLockHealth({
        metadata: {},
        connectivity: "ONLINE",
        now: T0,
        recentUnknownTransitions: 0,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "STALE_LOCK_TELEMETRY",
        label: "No health reading yet",
      }),
    ]);
  });

  it("Florisun-like reading (unlocked, door open, battery reported 10 days ago) sorts red before yellow", () => {
    const flags = classifyLockHealth({
      metadata: snapshot({
        lockState: "unlocked",
        doorState: "open",
        batteryLevel: 77,
        batteryReadingAt: "2026-09-15T20:56:47.797Z",
      }),
      connectivity: "ONLINE",
      now: T0,
      recentUnknownTransitions: 0,
    });
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ["DOOR_OPEN_UNLOCKED", "red"],
      ["STALE_BATTERY_TELEMETRY", "yellow"],
    ]);
  });
});

describe("door-sensor calibration (2026-09-28, Kenny)", () => {
  it("only August's explicit 'init' reading means calibration needed", () => {
    expect(isDoorSensorCalibrationNeeded("init")).toBe(true);
    expect(isDoorSensorCalibrationNeeded(" INIT ")).toBe(true);
    for (const state of [
      "open",
      "closed",
      "unknown",
      "disabled",
      "kAugDoorState_Bogus",
      "",
      null,
      undefined,
    ]) {
      expect(isDoorSensorCalibrationNeeded(state)).toBe(false);
    }
  });

  it("init → '⚠ Calibration needed' with the August-app instruction", () => {
    expect(
      classifyLockHealth({
        metadata: snapshot({ doorState: "init" }),
        connectivity: "ONLINE",
        now: T0,
        recentUnknownTransitions: 0,
      }),
    ).toEqual([
      {
        code: "DOOR_SENSOR_CALIBRATION_NEEDED",
        severity: "yellow",
        label: "⚠ Calibration needed",
        detail: "Door sensor needs calibration in the August app.",
        since: null,
      },
    ]);
  });

  it("open / closed are calibrated readings: never calibration needed", () => {
    expect(flagsFor({ doorState: "closed" })).toEqual([]);
    expect(flagsFor({ lockState: "locked", doorState: "open" })).toEqual([]);
    expect(flagsFor({ lockState: "unlocked", doorState: "open" })).toEqual([
      "DOOR_OPEN_UNLOCKED",
    ]);
  });

  it("missing / unknown / unrecognized door data is NOT labeled calibration needed", () => {
    for (const doorState of [null, "unknown", "disabled", "something_new"]) {
      expect(flagsFor({ doorState })).not.toContain(
        "DOOR_SENSOR_CALIBRATION_NEEDED",
      );
    }
    // No snapshot at all: only the "waiting for first reading" flag.
    expect(
      classifyLockHealth({
        metadata: {},
        connectivity: "ONLINE",
        now: T0,
        recentUnknownTransitions: 0,
      }).map((f) => f.code),
    ).toEqual(["STALE_LOCK_TELEMETRY"]);
  });

  it("ONLINE + LOCKED + calibration needed coexist: not reported as door open/closed, offline, unknown or a lock problem", () => {
    expect(
      flagsFor({
        lockState: "locked",
        connectivity: "ONLINE",
        doorState: "init",
      }),
    ).toEqual(["DOOR_SENSOR_CALIBRATION_NEEDED"]);
  });

  it("is independent of other conditions (e.g. offline + low battery keep their own flags)", () => {
    expect(
      flagsFor({
        connectivity: "OFFLINE",
        batteryLevel: 28,
        doorState: "init",
      }),
    ).toEqual(["OFFLINE", "LOW_BATTERY", "DOOR_SENSOR_CALIBRATION_NEEDED"]);
  });

  it("an init → closed refresh records a door transition and the flag clears", () => {
    const first = buildLockHealthUpdate(
      {},
      detail({}, { doorState: "init" }),
      T0,
    ).metadata;
    const { metadata, events } = buildLockHealthUpdate(
      first,
      detail({}, { doorState: "closed" }),
      T1,
    );
    expect(events.map((e) => e.eventType)).toEqual(["DOOR_STATE_CHANGED"]);
    expect(events[0]!.payload).toMatchObject({ from: "init", to: "closed" });
    const codes = (m: Record<string, unknown>, now: Date) =>
      classifyLockHealth({
        metadata: m,
        connectivity: "ONLINE",
        now,
        recentUnknownTransitions: 0,
      }).map((f) => f.code);
    expect(codes(first, T0)).toContain("DOOR_SENSOR_CALIBRATION_NEEDED");
    expect(codes(metadata, T1)).not.toContain("DOOR_SENSOR_CALIBRATION_NEEDED");
  });
});
