import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordAudit } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));
vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { LOCK_VERIFICATION_EVIDENCE_ACTION } from "../lib/lock-verification-evidence";

import {
  getLockVerificationEvidence,
  recordLockVerificationEvidence,
} from "./lock-verification-evidence.service";

const actor = { userId: "admin-1" };
const LOCK = "11111111-1111-1111-1111-111111111111";
const input = {
  smartDeviceId: LOCK,
  step: "REMOTE_UNLOCK" as const,
  outcome: "PASSED" as const,
  method: "AUGUST_APP_ONSITE" as const,
  performedBy: " Ops tech ",
  performedAt: new Date("2026-09-30T14:00:00.000Z"),
  notes: "  ",
};

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T16:00:00.000Z"));
  vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.smartDevice.findUnique)
    .mockReset()
    .mockResolvedValue({
      id: LOCK,
      deviceType: "LOCK",
      provider: "AUGUST",
    } as never);
  vi.mocked(prisma.auditLog.findMany).mockReset().mockResolvedValue([]);
  mockRecordAudit.mockClear();
});

describe("recordLockVerificationEvidence — append-only, admin-only, no commands", () => {
  it("requires the existing locks:manage (no new permission)", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(recordLockVerificationEvidence(actor, input)).rejects.toThrow(
      "Forbidden",
    );
    expect(assertPermission).toHaveBeenCalledWith(actor, "locks:manage");
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("writes exactly one new audit row, marked commandSent: false", async () => {
    await expect(recordLockVerificationEvidence(actor, input)).resolves.toEqual(
      {
        status: "success",
      },
    );
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      actorType: "USER",
      action: LOCK_VERIFICATION_EVIDENCE_ACTION,
      entityType: "SmartDevice",
      entityId: LOCK,
      afterState: {
        evidence: {
          version: 1,
          step: "REMOTE_UNLOCK",
          outcome: "PASSED",
          method: "AUGUST_APP_ONSITE",
          performedBy: "Ops tech",
          performedAt: "2026-09-30T14:00:00.000Z",
          notes: null,
          commandSent: false,
        },
      },
    });
  });

  it("rejects a visual check for a remote step, a future time, a failure without a note, and non-August devices", async () => {
    expect(
      await recordLockVerificationEvidence(actor, {
        ...input,
        method: "ONSITE_VISUAL",
      }),
    ).toMatchObject({ status: "rejected" });
    expect(
      await recordLockVerificationEvidence(actor, {
        ...input,
        performedAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    ).toMatchObject({ status: "rejected" });
    expect(
      await recordLockVerificationEvidence(actor, {
        ...input,
        outcome: "FAILED",
      }),
    ).toMatchObject({ status: "rejected" });
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
      id: LOCK,
      deviceType: "THERMOSTAT",
      provider: "NEST",
    } as never);
    expect(await recordLockVerificationEvidence(actor, input)).toEqual({
      status: "rejected",
      reason: "Lock not found.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("rejects evidence for a retired lock (e.g. the retired Majestic Isla - Front Door record)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
      id: LOCK,
      deviceType: "LOCK",
      provider: "AUGUST",
      metadata: { retiredAt: "2026-09-23T22:14:47.836Z" },
    } as never);
    expect(await recordLockVerificationEvidence(actor, input)).toEqual({
      status: "rejected",
      reason: "This lock is retired.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("has no path to the August client or the command service", () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "./lock-verification-evidence.service.ts",
      ),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(
        /@stayw\/integrations|august-commands|smart-devices\.service/,
      );
    }
    expect(source).not.toMatch(/sendAugust/);
  });
});

describe("getLockVerificationEvidence — read-only", () => {
  it("splits command and Ops rows per lock with the recorder's display name", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        entityId: LOCK,
        action: "smart_device.august_lock_command",
        afterState: { operation: "LOCK", result: "SUCCEEDED" },
        metadata: null,
        occurredAt: new Date("2026-09-25T15:00:00.000Z"),
        actorUser: { firstName: "Kenny", lastName: null },
      },
      {
        entityId: LOCK,
        action: LOCK_VERIFICATION_EVIDENCE_ACTION,
        afterState: {
          evidence: {
            version: 1,
            step: "MAPPING",
            outcome: "PASSED",
            method: "ONSITE_VISUAL",
            performedBy: "Ops tech",
            performedAt: "2026-09-30T14:00:00.000Z",
            notes: null,
            commandSent: false,
          },
        },
        metadata: null,
        occurredAt: new Date("2026-09-30T15:00:00.000Z"),
        actorUser: null,
      },
    ] as never);
    const result = await getLockVerificationEvidence(actor, [LOCK, "other"]);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect(result.get(LOCK)?.commands).toEqual([
      expect.objectContaining({
        direction: "LOCK",
        result: "SUCCEEDED",
        actorName: "Kenny",
      }),
    ]);
    expect(result.get(LOCK)?.ops).toEqual([
      expect.objectContaining({
        step: "MAPPING",
        recordedAt: "2026-09-30T15:00:00.000Z",
        recordedByName: null,
      }),
    ]);
    expect(result.get("other")).toEqual({ commands: [], ops: [] });
  });
});
