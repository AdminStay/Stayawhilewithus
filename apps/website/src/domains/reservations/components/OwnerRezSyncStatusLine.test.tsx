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
  },
  lastAutomaticRunAt: new Date("2026-09-30T17:18:00Z"),
  nextExpectedRunAt: new Date("2026-09-30T18:17:00Z"),
  stale: false,
  consecutiveFailures: 0,
};

const text = () => screen.getByTestId("ownerrez-sync-status").textContent ?? "";

describe("OwnerRezSyncStatusLine", () => {
  it("on + healthy: hourly, next run, last complete sync, last attempt, last automatic run (CT)", () => {
    render(<OwnerRezSyncStatusLine status={base} />);
    expect(text()).toContain(
      "Automatic sync: on — hourly, next expected Sep 30, 1:17 PM CT",
    );
    expect(text()).toContain("Last complete sync: Sep 30, 12:18 PM CT");
    expect(text()).toContain(
      "Last attempt: Sep 30, 12:18 PM CT — complete (3 created or changed)",
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
});
