// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { OwnerRezSyncStatus } from "../services/ownerrez-sync-status.service";

import { OwnerRezSyncStatusLine } from "./OwnerRezSyncStatusLine";

afterEach(cleanup);

const base: OwnerRezSyncStatus = {
  autoSyncEnabled: true,
  lastCompleteSyncAt: new Date("2026-09-30T17:18:00Z"),
  lastAttempt: {
    status: "SUCCEEDED",
    rateLimited: false,
    startedAt: new Date("2026-09-30T17:17:00Z"),
    finishedAt: new Date("2026-09-30T17:18:00Z"),
    recordsProcessed: 3,
    exceptions: {
      unmatchedProperty: 0,
      guestErrors: 0,
      unrecognizedStatus: 0,
      deferred: 0,
    },
    failureReason: null,
  },
  lastAutomaticRunAt: new Date("2026-09-30T17:18:00Z"),
  nextExpectedRunAt: new Date("2026-09-30T18:17:00Z"),
  stale: false,
  consecutiveFailures: 0,
};

const text = () => screen.getByTestId("ownerrez-sync-status").textContent ?? "";
const withAttempt = (
  attempt: Partial<NonNullable<OwnerRezSyncStatus["lastAttempt"]>>,
): OwnerRezSyncStatus => ({
  ...base,
  lastAttempt: { ...base.lastAttempt!, ...attempt },
});
const zero = base.lastAttempt!.exceptions!;
/** The "Last attempt" paragraph on its own (label + description). */
const lastAttemptLine = () =>
  screen.getByText("Last attempt:").closest("p")?.textContent ?? "";
const exceptionsLine = () =>
  screen.queryByTestId("ownerrez-sync-exceptions")?.textContent ?? null;

describe("OwnerRezSyncStatusLine", () => {
  it("on + healthy: hourly, next run, last complete sync, last attempt, last automatic run (CT)", () => {
    render(<OwnerRezSyncStatusLine status={base} />);
    expect(text()).toContain(
      "Automatic sync: on — hourly, next expected Sep 30, 1:17 PM CT",
    );
    expect(text()).toContain("Last complete sync: Sep 30, 12:18 PM CT");
    expect(text()).toContain(
      "Last attempt: Sep 30, 12:18 PM CT — complete, nothing skipped (3 created or changed)",
    );
    expect(text()).toContain("Last automatic run: Sep 30, 12:18 PM CT");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("off: says manual Sync is needed; no stale warning, no automatic-run line", () => {
    render(
      <OwnerRezSyncStatusLine
        status={{
          ...base,
          autoSyncEnabled: false,
          nextExpectedRunAt: null,
          stale: true,
        }}
      />,
    );
    expect(text()).toContain("Automatic sync: off");
    expect(text()).not.toContain("Last automatic run");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("on + stale: warning with the failure count", () => {
    render(
      <OwnerRezSyncStatusLine
        status={{
          ...base,
          stale: true,
          consecutiveFailures: 3,
          lastAttempt: { ...base.lastAttempt!, status: "FAILED" },
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "No complete OwnerRez sync in over 3 hours",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "The last 3 runs failed.",
    );
    expect(text()).toContain("— failed");
  });

  it("partial and rate-limited attempts are described as safe, not failures", () => {
    const { unmount } = render(
      <OwnerRezSyncStatusLine
        status={{
          ...base,
          lastAttempt: { ...base.lastAttempt!, status: "PARTIAL" },
        }}
      />,
    );
    expect(text()).toContain("partial (OwnerRez request limit");
    unmount();
    render(
      <OwnerRezSyncStatusLine
        status={{
          ...base,
          lastAttempt: {
            ...base.lastAttempt!,
            status: "FAILED",
            rateLimited: true,
          },
        }}
      />,
    );
    expect(text()).toContain(
      "stopped by the OwnerRez request limit (nothing written",
    );
  });

  describe("saved run results (2026-10-28)", () => {
    it("clean success: says nothing was skipped; no exceptions line", () => {
      render(<OwnerRezSyncStatusLine status={base} />);
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — complete, nothing skipped (3 created or changed)",
      );
      expect(exceptionsLine()).toBeNull();
    });

    it("success with unmatched properties: complete with exceptions + bookings not synced", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            exceptions: { ...zero, unmatchedProperty: 1 },
          })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — complete with exceptions (3 created or changed)",
      );
      expect(exceptionsLine()).toBe(
        "Not synced: 1 booking on an OwnerRez property not linked in StayWhile.",
      );
    });

    it("success with guest errors: reported as errors, not as a booking count", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({ exceptions: { ...zero, guestErrors: 2 } })}
        />,
      );
      expect(lastAttemptLine()).toContain("complete with exceptions");
      expect(exceptionsLine()).toBe(
        "2 guest errors — bookings for the affected guests weren't synced.",
      );
    });

    it("success with unrecognized statuses", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            exceptions: { ...zero, unrecognizedStatus: 1 },
          })}
        />,
      );
      expect(lastAttemptLine()).toContain("complete with exceptions");
      expect(exceptionsLine()).toBe(
        "Not synced: 1 booking with an unrecognized OwnerRez status.",
      );
    });

    it("all three together", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            exceptions: {
              unmatchedProperty: 2,
              guestErrors: 1,
              unrecognizedStatus: 3,
              deferred: 0,
            },
          })}
        />,
      );
      expect(exceptionsLine()).toBe(
        "Not synced: 2 bookings on an OwnerRez property not linked in StayWhile, 3 bookings with an unrecognized OwnerRez status. 1 guest error — bookings for the affected guests weren't synced.",
      );
    });

    it("failure with a safe reason", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            status: "FAILED",
            exceptions: null,
            failureReason: "OwnerRez had a server error (HTTP 503).",
          })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — failed: OwnerRez had a server error (HTTP 503).",
      );
      expect(exceptionsLine()).toBeNull();
    });

    it("partial: deferred count and anything not synced", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            status: "PARTIAL",
            rateLimited: true,
            exceptions: { ...zero, deferred: 12, unmatchedProperty: 1 },
          })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — partial: 12 deferred (OwnerRez request limit; the rest is picked up by the next run)",
      );
      expect(exceptionsLine()).toBe(
        "Not synced: 1 booking on an OwnerRez property not linked in StayWhile.",
      );
    });

    it("no saved counts (older record or no match): previous wording + 'not recorded', never clean", () => {
      render(
        <OwnerRezSyncStatusLine status={withAttempt({ exceptions: null })} />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — complete (3 created or changed; skipped bookings not recorded)",
      );
      expect(lastAttemptLine()).not.toContain("nothing skipped");
      expect(lastAttemptLine()).not.toContain("with exceptions");
      expect(exceptionsLine()).toBeNull();
    });

    it("older PARTIAL and FAILED records read exactly as before", () => {
      const { unmount } = render(
        <OwnerRezSyncStatusLine
          status={withAttempt({ status: "PARTIAL", exceptions: null })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — partial (OwnerRez request limit; the rest is picked up by the next run)",
      );
      unmount();
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            status: "FAILED",
            exceptions: null,
            failureReason: null,
          })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — failed",
      );
    });

    it("partly recorded counts that are all zero: not clean, not exceptions — 'not recorded'", () => {
      render(
        <OwnerRezSyncStatusLine
          status={withAttempt({
            exceptions: {
              unmatchedProperty: 0,
              guestErrors: null,
              unrecognizedStatus: null,
              deferred: null,
            },
          })}
        />,
      );
      expect(lastAttemptLine()).toBe(
        "Last attempt: Sep 30, 12:18 PM CT — complete (3 created or changed; skipped bookings not recorded)",
      );
      expect(exceptionsLine()).toBeNull();
    });
  });
});
