import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({ prisma: {} }));
vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

import { isLockVisible } from "../services/smart-devices.service";

import {
  buildCommandEvidence,
  type CommandAuditRow,
} from "./lock-verification-evidence";
import { buildVerificationTrackerRow } from "./lock-verification-tracker";
import { buildUnmappedAugustDevices } from "./unmapped-august-devices";

/**
 * Fixture shaped exactly like the Production read-only fleet check
 * (2026-09-30, Q1–Q5): record ids, retirement, and the 13 command rows.
 * No Production access — this only proves the candidate's logic on that
 * shape.
 */
const RETIRED_MAJESTIC = "bdecce4d-0e46-4469-957a-97fa333c86be";
const MJ_FRONT = "31b37c39-53a1-4261-b805-7423a30b2020";

type Cmd = [string, string | null, string, string];
const COMMANDS: Record<string, Cmd[]> = {
  "Aqua Palm": [
    ["2026-09-18T14:16:00.970Z", "UNLOCK", "SUCCEEDED", "Kris Rys"],
    ["2026-09-18T14:42:40.056Z", "LOCK", "SUCCEEDED", "Kris Rys"],
  ],
  "Coco Vista": [["2026-09-25T17:14:42.745Z", "LOCK", "AMBIGUOUS", "Kris Rys"]],
  "Driftwood Cottage": [
    ["2026-09-25T18:09:52.446Z", "LOCK", "SUCCEEDED", "Kris Rys"],
  ],
  [MJ_FRONT]: [["2026-09-18T15:36:42.732Z", "LOCK", "FAILED", "Kris Rys"]],
  "Moroccan Moon": [
    ["2026-09-25T21:22:32.495Z", "UNLOCK", "SUCCEEDED", "Kris Rys"],
  ],
  "Once Upon a Pond": [
    ["2026-09-25T20:49:11.427Z", "UNLOCK", "SUCCEEDED", "Kris Rys"],
    ["2026-09-25T20:53:51.650Z", "LOCK", "SUCCEEDED", "Kris Rys"],
  ],
  "Orion's Landing": [
    ["2026-09-24T16:19:49.831Z", "LOCK", "FAILED", "Kris Rys"],
    ["2026-09-24T18:05:39.424Z", "LOCK", "AMBIGUOUS", "Admin Tech"],
  ],
  "Royal Palms": [
    ["2026-09-25T18:48:32.875Z", "LOCK", "AMBIGUOUS", "Kris Rys"],
    ["2026-09-25T19:27:24.080Z", null, "ADMIN_RESET", "Kris Rys"],
    ["2026-09-25T19:28:21.993Z", "UNLOCK", "SUCCEEDED", "Kris Rys"],
  ],
};

const toRows = (cmds: Cmd[]): CommandAuditRow[] =>
  cmds.map(([at, operation, result, actorName]) => ({
    occurredAt: new Date(at),
    afterState: operation ? { operation, result } : { result },
    metadata: null,
    actorName,
  }));

// SmartDevice rows: every lock with history, the two Majestic Isla records,
// and 36 other active locks with no command history (44 active in total).
const devices = [
  ...Object.keys(COMMANDS).map((key) => ({
    id: key,
    provider: "AUGUST" as const,
    metadata: {},
  })),
  {
    id: RETIRED_MAJESTIC,
    provider: "AUGUST" as const,
    metadata: { retiredAt: "2026-09-23T22:14:47.836Z" },
  },
  ...Array.from({ length: 36 }, (_, i) => ({
    id: `other-${i}`,
    provider: "AUGUST" as const,
    metadata: {},
  })),
];

function trackerRows() {
  const visible = devices.filter((d) => isLockVisible(d as never));
  return visible.map((d) => {
    const commands = buildCommandEvidence(toRows(COMMANDS[d.id] ?? []));
    const recorded = commands.filter((c) => c.result !== "ADMIN_RESET");
    const latest = commands.at(-1)?.result ?? null;
    return buildVerificationTrackerRow({
      base: {
        smartDeviceId: d.id,
        propertyName: d.id,
        lockName: "Front Door",
        verification: { status: "AWAITING_OPS", verifiedAt: null },
        condition: { status: "HEALTHY", reasons: [] },
        connectivity: "ONLINE",
        batteryLevel: 80,
        doorCondition: "Closed",
      },
      firstVerifiedAt:
        recorded.find((c) => c.result === "SUCCEEDED")?.at ?? null,
      operationalHold: null,
      lastCommandOutcome: latest,
      mapped: true,
      lockState: "locked",
      commands,
      ops: [], // Q4: zero Ops evidence rows in Production
      availability: "NOT_VERIFIED",
    });
  });
}

describe("candidate vs Production fleet check (2026-09-30)", () => {
  it("1–2: 44 active locks; the retired Majestic Isla record is excluded", () => {
    const rows = trackerRows();
    expect(rows).toHaveLength(44);
    expect(rows.map((r) => r.smartDeviceId)).not.toContain(RETIRED_MAJESTIC);
  });

  it("3: the separate, active MJ - Front Door record stays listed and needs attention", () => {
    const mj = trackerRows().find((r) => r.smartDeviceId === MJ_FRONT)!;
    expect(mj).toBeDefined();
    expect(mj.verification.status).toBe("NOT_VERIFIED_NEEDS_ATTENTION");
    expect(mj.remoteLock.status).toBe("FAILED");
  });

  it("5–6: exactly the five approved locks are Verified; Coco Vista, Orion and MJ Front are not", () => {
    const rows = trackerRows();
    const verified = rows
      .filter((r) => r.verification.status === "VERIFIED")
      .map((r) => r.smartDeviceId)
      .sort();
    expect(verified).toEqual([
      "Aqua Palm",
      "Driftwood Cottage",
      "Moroccan Moon",
      "Once Upon a Pond",
      "Royal Palms",
    ]);
    for (const id of ["Coco Vista", "Orion's Landing", MJ_FRONT]) {
      expect(
        rows.find((r) => r.smartDeviceId === id)!.verification.status,
      ).toBe("NOT_VERIFIED_NEEDS_ATTENTION");
    }
    expect(
      rows.filter((r) => r.verification.status === "AWAITING_OPS"),
    ).toHaveLength(36);
  });

  it("7: Royal Palms keeps ambiguous LOCK → admin reset → successful UNLOCK", () => {
    const rp = trackerRows().find((r) => r.smartDeviceId === "Royal Palms")!;
    expect([...rp.history].reverse().map((h) => [h.step, h.outcome])).toEqual([
      ["REMOTE_LOCK", "Ambiguous"],
      ["REMOTE_LOCK", "Reset after physical check"],
      ["REMOTE_UNLOCK", "Passed"],
    ]);
    expect(rp.remoteLock.status).toBe("RESET_AFTER_CHECK");
    expect(rp.remoteUnlock.status).toBe("PASSED");
  });

  it("8: Orion keeps FAILED → AMBIGUOUS", () => {
    const orion = trackerRows().find(
      (r) => r.smartDeviceId === "Orion's Landing",
    )!;
    expect([...orion.history].reverse().map((h) => h.outcome)).toEqual([
      "Failed",
      "Ambiguous",
    ]);
  });

  it("9: no Ops evidence is derived from command history", () => {
    for (const r of trackerRows()) {
      expect(r.opsConfirmedViaAugustApp).toBe(false);
      expect(r.history.every((h) => h.source === "STAYWHILE_COMMAND")).toBe(
        true,
      );
      expect(r.mapping.ops).toBeNull();
      expect(r.deviceStatus.ops).toBeNull();
    }
  });

  it("4: MJ Side Door is the only unmapped device — OFFLINE, 8%, not mapped; the retired record (no device record) isn't in it", () => {
    const mapped = Array.from({ length: 44 }, (_, i) => ({
      id: `pd-${i}`,
      discoveredName: `Lock ${i}`,
      connectivityStatus: "ONLINE",
      rawMetadata: {},
      lastSeenAt: new Date("2026-09-30T00:00:00.000Z"),
      propertyId: "p",
      enabled: true,
      smartDeviceId: `sd-${i}`,
      smartDeviceMetadata: {},
    }));
    const result = buildUnmappedAugustDevices([
      ...mapped,
      {
        id: "pd-side",
        discoveredName: "MJ Side Door",
        connectivityStatus: "OFFLINE",
        rawMetadata: {
          batteryLevel: 8,
          telemetryUpdatedAt: "2026-09-20T16:28:49.316Z",
        },
        lastSeenAt: new Date("2026-09-25T00:00:00.000Z"),
        propertyId: null,
        enabled: false,
        smartDeviceId: null,
        smartDeviceMetadata: null,
      },
    ]);
    expect(result.retiredCount).toBe(0);
    expect(result.devices).toEqual([
      expect.objectContaining({
        name: "MJ Side Door",
        connectivity: "OFFLINE",
        batteryLevel: 8,
        mappingStatus: "NOT_MAPPED",
      }),
    ]);
  });
});
