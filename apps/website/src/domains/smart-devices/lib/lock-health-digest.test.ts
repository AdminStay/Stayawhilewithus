import { describe, expect, it } from "vitest";

import type { LockHealthFlag } from "./lock-health";
import {
  buildLockHealthDigest,
  type DigestInputRow,
} from "./lock-health-digest";

const NOW = new Date("2026-09-27T04:15:00.000Z");

function flag(
  code: LockHealthFlag["code"],
  severity: LockHealthFlag["severity"],
  label: string = code,
): LockHealthFlag {
  return { code, severity, label, detail: `${code} detail.`, since: null };
}

const rows: DigestInputRow[] = [
  {
    smartDeviceId: "healthy",
    propertyName: "Driftwood",
    lockName: "Front Door",
    flags: [],
  },
  {
    smartDeviceId: "flor",
    propertyName: "Florisun",
    lockName: "Flor Sun - Front Door",
    flags: [flag("OPERATIONAL_HOLD", "red", "Out of service")],
  },
  {
    smartDeviceId: "coco",
    propertyName: "Coco Vista",
    lockName: "Front Door",
    flags: [flag("COMMAND_BLOCKED", "orange", "Command blocked (AMBIGUOUS)")],
  },
  {
    smartDeviceId: "palm",
    propertyName: "Palm Haven",
    lockName: "Front Door",
    flags: [
      flag("LOW_BATTERY", "orange", "Battery critical"),
      flag("STALE_BATTERY_TELEMETRY", "yellow"),
    ],
  },
];

describe("buildLockHealthDigest", () => {
  it("one summary with only exceptions, grouped by severity in the agreed order; healthy locks never appear", () => {
    const d = buildLockHealthDigest(rows, { now: NOW });
    expect(d.hasExceptions).toBe(true);
    expect(d.counts).toEqual({ red: 1, orange: 2, yellow: 1 });
    expect(d.sections.map((s) => s.heading)).toEqual([
      "🔴 Out of service / onsite inspection",
      "🟠 Command blocked (needs in-person check + reset)",
      "🟠 Low battery",
      "🟡 Stale telemetry",
    ]);
    expect(d.text).not.toContain("Driftwood");
    expect(d.title).toBe("🔐 Lock health — 2026-09-27 — 1 🔴 · 2 🟠 · 1 🟡");
    expect(d.text).toContain("No commands were sent.");
  });

  it("marks conditions NEW vs ONGOING against the previous digest and reports resolved ones — no duplicate alert for an unresolved condition", () => {
    const first = buildLockHealthDigest(rows, { now: NOW });
    expect(
      first.sections.flatMap((s) => s.items).every((i) => i.status === "NEW"),
    ).toBe(true);

    const nextDay = buildLockHealthDigest(
      rows.filter((r) => r.smartDeviceId !== "coco"),
      {
        now: new Date("2026-09-28T04:15:00.000Z"),
        previousConditionKeys: first.conditionKeys,
      },
    );
    expect(
      nextDay.sections.flatMap((s) => s.items).map((i) => i.status),
    ).toEqual(["ONGOING", "ONGOING", "ONGOING"]);
    expect(nextDay.resolvedConditionKeys).toEqual(["coco:COMMAND_BLOCKED"]);
    expect(nextDay.text).not.toContain("[NEW]");
  });

  it("fingerprint is stable for the same set of conditions and changes when the set changes", () => {
    const a = buildLockHealthDigest(rows, { now: NOW });
    const b = buildLockHealthDigest([...rows].reverse(), {
      now: new Date("2026-09-28T04:15:00.000Z"),
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    const c = buildLockHealthDigest(rows.slice(0, 2), { now: NOW });
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("an all-clear day produces no sections and says so", () => {
    const d = buildLockHealthDigest([rows[0]!], { now: NOW });
    expect(d.hasExceptions).toBe(false);
    expect(d.sections).toEqual([]);
    expect(d.text).toContain("No lock health exceptions");
  });
});
