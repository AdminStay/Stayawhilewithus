// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { parseLocksTab } from "./LocksTabs";
import { UnmappedAugustDevicesPanel } from "./UnmappedAugustDevicesPanel";

afterEach(cleanup);

describe("UnmappedAugustDevicesPanel (2026-09-30)", () => {
  it("lists unmapped devices read-only — no buttons, no mapping controls", () => {
    render(
      <UnmappedAugustDevicesPanel
        devices={[
          {
            providerDeviceId: "pd-1",
            name: "Side Door",
            connectivity: "UNKNOWN",
            batteryLevel: 8,
            batteryReadingAt: "2026-09-29T10:00:00.000Z",
            statusReportedAt: null,
            lastSeenAt: "2026-09-29T12:00:00.000Z",
            mappingStatus: "NOT_MAPPED",
          },
        ]}
        retiredCount={2}
      />,
    );
    expect(screen.getByText("Unmapped August devices (1)")).toBeTruthy();
    expect(screen.getByText("Side Door")).toBeTruthy();
    expect(screen.getByText("Not mapped")).toBeTruthy();
    expect(screen.getByText("8%")).toBeTruthy();
    expect(screen.getByText("Connectivity unknown")).toBeTruthy();
    expect(screen.getByText(/2 retired devices are not shown/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector("form, select, input")).toBeNull();
  });

  it("says so when every discovered lock is on Fleet Status", () => {
    render(<UnmappedAugustDevicesPanel devices={[]} retiredCount={0} />);
    expect(
      screen.getByText("Every discovered August lock is on Fleet Status."),
    ).toBeTruthy();
  });
});

describe("parseLocksTab", () => {
  it("defaults to Fleet Status for missing or unknown values", () => {
    expect(parseLocksTab(undefined)).toBe("fleet");
    expect(parseLocksTab("bogus")).toBe("fleet");
    expect(parseLocksTab("report")).toBe("report");
    expect(parseLocksTab(["verification", "report"])).toBe("verification");
  });
});
