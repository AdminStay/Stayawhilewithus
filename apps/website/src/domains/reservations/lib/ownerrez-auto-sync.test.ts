import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  countConsecutiveOwnerRezFailures,
  decideOwnerRezSyncAlert,
  isOwnerRezAutoSyncEnabled,
  isOwnerRezReservationUnchanged,
  isOwnerRezSyncStale,
  nextOwnerRezAutoSyncRun,
  OWNERREZ_AUTO_SYNC_SCHEDULE,
  type OwnerRezReservationComparable,
} from "./ownerrez-auto-sync";

const MARKER = "OWNERREZ_DEFERRED";

describe("OWNERREZ_AUTO_SYNC_ENABLED kill switch", () => {
  it("is on only for the exact string 'true'", () => {
    expect(
      isOwnerRezAutoSyncEnabled({ OWNERREZ_AUTO_SYNC_ENABLED: "true" }),
    ).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      expect(
        isOwnerRezAutoSyncEnabled({ OWNERREZ_AUTO_SYNC_ENABLED: value }),
      ).toBe(false);
    }
    expect(isOwnerRezAutoSyncEnabled({})).toBe(false);
  });
});

describe("vercel.json cron entry", () => {
  const vercelJson = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../vercel.json",
      ),
      "utf8",
    ),
  ) as { crons: Array<{ path: string; schedule: string }> };

  it("has exactly one cron: the OwnerRez route, hourly at the shared minute", () => {
    expect(vercelJson.crons).toEqual([
      {
        path: "/api/cron/ownerrez-reservation-sync",
        schedule: OWNERREZ_AUTO_SYNC_SCHEDULE,
      },
    ]);
    expect(OWNERREZ_AUTO_SYNC_SCHEDULE).toBe("17 * * * *");
  });
});

describe("nextOwnerRezAutoSyncRun (UTC, :17 past each hour)", () => {
  it("later in the same hour", () => {
    expect(
      nextOwnerRezAutoSyncRun(new Date("2026-09-30T09:05:00Z")).toISOString(),
    ).toBe("2026-09-30T09:17:00.000Z");
  });
  it("the next hour once :17 has passed (or is exactly now)", () => {
    expect(
      nextOwnerRezAutoSyncRun(new Date("2026-09-30T09:17:00Z")).toISOString(),
    ).toBe("2026-09-30T10:17:00.000Z");
    expect(
      nextOwnerRezAutoSyncRun(new Date("2026-09-30T23:40:00Z")).toISOString(),
    ).toBe("2026-10-01T00:17:00.000Z");
  });
});

describe("isOwnerRezSyncStale (> 3 hours)", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("never synced is stale", () => {
    expect(isOwnerRezSyncStale(null, now)).toBe(true);
  });
  it("exactly 3 hours is not stale; just over is", () => {
    expect(isOwnerRezSyncStale(new Date("2026-09-30T09:00:00Z"), now)).toBe(
      false,
    );
    expect(isOwnerRezSyncStale(new Date("2026-09-30T08:59:59Z"), now)).toBe(
      true,
    );
  });
});

describe("countConsecutiveOwnerRezFailures", () => {
  const log = (
    status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL",
    errorMessage: string | null = null,
  ) => ({
    status,
    errorMessage,
  });

  it("counts FAILED rows until the first SUCCEEDED or PARTIAL", () => {
    expect(
      countConsecutiveOwnerRezFailures(
        [
          log("FAILED", "boom"),
          log("FAILED", "boom"),
          log("SUCCEEDED"),
          log("FAILED"),
        ],
        MARKER,
      ),
    ).toBe(2);
    expect(
      countConsecutiveOwnerRezFailures(
        [log("PARTIAL", `${MARKER}: 3`), log("FAILED")],
        MARKER,
      ),
    ).toBe(0);
  });

  it("ignores RUNNING rows and rate-limit stops (not failures)", () => {
    expect(
      countConsecutiveOwnerRezFailures(
        [
          log("RUNNING"),
          log("FAILED", "x"),
          log("FAILED", `${MARKER}: budget used. Nothing was written`),
          log("FAILED", "y"),
          log("FAILED", "z"),
        ],
        MARKER,
      ),
    ).toBe(3);
  });

  it("no rows = 0", () => {
    expect(countConsecutiveOwnerRezFailures([], MARKER)).toBe(0);
  });
});

describe("decideOwnerRezSyncAlert", () => {
  it("alerts at 3 consecutive failures, or when stale", () => {
    expect(
      decideOwnerRezSyncAlert({
        consecutiveFailures: 3,
        stale: false,
        alreadyAlerted: false,
      }),
    ).toBe("consecutive_failures");
    expect(
      decideOwnerRezSyncAlert({
        consecutiveFailures: 0,
        stale: true,
        alreadyAlerted: false,
      }),
    ).toBe("stale");
  });
  it("no alert for fewer than 3 failures on a fresh sync", () => {
    expect(
      decideOwnerRezSyncAlert({
        consecutiveFailures: 2,
        stale: false,
        alreadyAlerted: false,
      }),
    ).toBeNull();
  });
  it("only once per incident", () => {
    expect(
      decideOwnerRezSyncAlert({
        consecutiveFailures: 5,
        stale: true,
        alreadyAlerted: true,
      }),
    ).toBeNull();
  });
});

describe("isOwnerRezReservationUnchanged", () => {
  const next: OwnerRezReservationComparable = {
    propertyId: "prop-1",
    primaryGuestId: "guest-1",
    status: "CONFIRMED",
    checkInDate: new Date("2026-10-01"),
    checkOutDate: new Date("2026-10-05"),
    adults: 2,
    children: 0,
    pets: 0,
    totalAmount: 1200.5,
    cancelledAt: null,
  };
  // What Prisma returns: @db.Date as UTC midnight, Decimal as an object.
  const decimal = (v: string) => ({ toString: () => v });
  const stored = {
    ...next,
    checkInDate: new Date("2026-10-01T00:00:00.000Z"),
    checkOutDate: new Date("2026-10-05T00:00:00.000Z"),
    totalAmount: decimal("1200.50"),
    hasPrimaryGuestLink: true,
  };

  it("identical stored row → unchanged", () => {
    expect(isOwnerRezReservationUnchanged(stored, next)).toBe(true);
  });

  it.each([
    ["propertyId", { propertyId: "prop-2" }],
    ["primaryGuestId", { primaryGuestId: "guest-2" }],
    ["status", { status: "CANCELLED" }],
    ["checkInDate", { checkInDate: new Date("2026-10-02") }],
    ["checkOutDate", { checkOutDate: new Date("2026-10-06") }],
    ["adults", { adults: 3 }],
    ["children", { children: 1 }],
    ["pets", { pets: 1 }],
    ["totalAmount", { totalAmount: decimal("1200.49") }],
    ["cancelledAt", { cancelledAt: new Date("2026-09-10T08:00:00Z") }],
  ])("a different %s → changed", (_field, change) => {
    expect(isOwnerRezReservationUnchanged({ ...stored, ...change }, next)).toBe(
      false,
    );
  });

  it("a cancellation time that moved → changed", () => {
    const at = new Date("2026-09-10T08:00:00Z");
    expect(
      isOwnerRezReservationUnchanged(
        { ...stored, status: "CANCELLED", cancelledAt: at },
        {
          ...next,
          status: "CANCELLED",
          cancelledAt: new Date("2026-09-11T08:00:00Z"),
        },
      ),
    ).toBe(false);
    expect(
      isOwnerRezReservationUnchanged(
        { ...stored, status: "CANCELLED", cancelledAt: at },
        { ...next, status: "CANCELLED", cancelledAt: new Date(at) },
      ),
    ).toBe(true);
  });

  it("missing primary-guest link or unknown fields → changed (falls back to the proven update)", () => {
    expect(
      isOwnerRezReservationUnchanged(
        { ...stored, hasPrimaryGuestLink: false },
        next,
      ),
    ).toBe(false);
    expect(
      isOwnerRezReservationUnchanged({ hasPrimaryGuestLink: true }, next),
    ).toBe(false);
    expect(
      isOwnerRezReservationUnchanged(
        { ...stored, totalAmount: undefined },
        next,
      ),
    ).toBe(false);
    expect(
      isOwnerRezReservationUnchanged(
        { ...stored, cancelledAt: undefined },
        next,
      ),
    ).toBe(false);
  });
});
