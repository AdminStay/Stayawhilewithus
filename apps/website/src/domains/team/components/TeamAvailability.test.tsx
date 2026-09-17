// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TeamAvailability } from "./TeamAvailability";

afterEach(cleanup);

const BASE_PROPS = {
  lastSyncedAt: new Date("2026-09-16T12:00:00.000Z"),
  isStale: false,
  lastFetchError: null,
  workingNow: [],
  comingUp: [],
  off: [],
  unmappedCount: 0,
};

describe("TeamAvailability", () => {
  it("renders each person exactly once, in the correct group, by their real source name", () => {
    render(
      <TeamAvailability
        {...BASE_PROPS}
        workingNow={[
          { sourceKey: "Taylor", mapped: false, timeLabel: "until 5:00 PM" },
        ]}
        comingUp={[
          {
            sourceKey: "Jordan",
            mapped: false,
            timeLabel: "2:00 PM – 6:00 PM",
          },
        ]}
        off={[{ sourceKey: "Casey", mapped: false }]}
      />,
    );

    expect(screen.getByText("Taylor")).toBeTruthy();
    expect(screen.getByText("until 5:00 PM")).toBeTruthy();
    expect(screen.getByText("Jordan")).toBeTruthy();
    expect(screen.getByText("2:00 PM – 6:00 PM")).toBeTruthy();
    expect(screen.getByText("Casey")).toBeTruthy();
  });

  it("shows the role label under a person's name when present", () => {
    render(
      <TeamAvailability
        {...BASE_PROPS}
        workingNow={[{ sourceKey: "Taylor", mapped: true, role: "Operations" }]}
      />,
    );
    expect(screen.getByText("Operations")).toBeTruthy();
  });

  it("shows a stale-data indicator, including the last-synced time, when isStale is true", () => {
    render(<TeamAvailability {...BASE_PROPS} isStale />);
    expect(screen.getByText("Possibly stale")).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
  });

  it("shows 'Central Time' with no synced-time claim when lastSyncedAt is null and not stale via a failure", () => {
    render(<TeamAvailability {...BASE_PROPS} isStale lastSyncedAt={null} />);
    expect(screen.getByText("Central Time")).toBeTruthy();
  });

  it("shows a source-unavailable indicator and the last-known data note when the most recent fetch failed", () => {
    render(
      <TeamAvailability
        {...BASE_PROPS}
        lastFetchError="TIMEOUT: No response within 15s."
      />,
    );
    expect(screen.getByText("Schedule source unavailable")).toBeTruthy();
    expect(screen.getByText(/Couldn't refresh the schedule/)).toBeTruthy();
  });

  it("never replaces previously-known entries with an empty state just because the latest fetch failed", () => {
    render(
      <TeamAvailability
        {...BASE_PROPS}
        lastFetchError="TIMEOUT: No response within 15s."
        workingNow={[{ sourceKey: "Taylor", mapped: false }]}
      />,
    );
    expect(screen.getByText("Taylor")).toBeTruthy();
    expect(screen.queryByText("No team schedule yet")).toBeNull();
  });

  it("shows an unmapped-entries note, still naming that it's about StayWhile login linkage, without hiding any entry", () => {
    render(
      <TeamAvailability
        {...BASE_PROPS}
        workingNow={[{ sourceKey: "Taylor", mapped: false }]}
        unmappedCount={1}
      />,
    );
    expect(screen.getByText("Taylor")).toBeTruthy();
    expect(screen.getByText(/yet linked to a StayWhile login/)).toBeTruthy();
  });

  it("omits the unmapped notice entirely when the count is zero", () => {
    render(<TeamAvailability {...BASE_PROPS} unmappedCount={0} />);
    expect(screen.queryByText(/linked to a StayWhile login/)).toBeNull();
  });

  it("shows a clean empty state when nobody is in any group and there's no fetch error", () => {
    render(<TeamAvailability {...BASE_PROPS} />);
    expect(screen.getByText("No team schedule yet")).toBeTruthy();
  });

  it("contains no write/mutation affordance anywhere in the rendered output", () => {
    const { container } = render(
      <TeamAvailability
        {...BASE_PROPS}
        workingNow={[{ sourceKey: "Taylor", mapped: false }]}
      />,
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });
});
