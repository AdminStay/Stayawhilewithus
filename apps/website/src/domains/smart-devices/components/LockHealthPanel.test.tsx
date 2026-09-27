// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LockHealthPanel } from "./LockHealthPanel";

afterEach(cleanup);

describe("LockHealthPanel (2026-09-25)", () => {
  it("lists only locks with flags, worst severity first, with reason and timestamp", () => {
    render(
      <LockHealthPanel
        rows={[
          {
            smartDeviceId: "a",
            propertyName: "Bahamas",
            lockName: "Front Door",
            flags: [],
          },
          {
            smartDeviceId: "b",
            propertyName: "Palm Haven",
            lockName: "Front Door",
            flags: [
              {
                code: "STALE_BATTERY_TELEMETRY",
                severity: "yellow",
                label: "Battery reading stale",
                detail: "Battery last reported 17 days ago.",
                since: "2026-09-08T21:42:27.555Z",
              },
            ],
          },
          {
            smartDeviceId: "c",
            propertyName: "Florisun",
            lockName: "Flor Sun - Front Door",
            flags: [
              {
                code: "DOOR_OPEN_UNLOCKED",
                severity: "red",
                label: "Door open and unlocked",
                detail: "Unlocked since before monitoring began.",
                since: null,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText(/needs attention \(2\)/i)).toBeTruthy();
    expect(screen.queryByText("Bahamas")).toBeNull();
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.querySelector("p"));
    expect(within(items[0]!).getByText("Florisun")).toBeTruthy();
    expect(within(items[1]!).getByText("Palm Haven")).toBeTruthy();
    expect(screen.getByText("Battery last reported 17 days ago.")).toBeTruthy();
    expect(screen.getByText(/^since /)).toBeTruthy();
  });

  it("says so when there are no exceptions", () => {
    render(<LockHealthPanel rows={[]} />);
    expect(
      screen.getByText("No lock health exceptions right now."),
    ).toBeTruthy();
  });

  it("lists a calibration-needed lock in Needs attention with its instruction", () => {
    render(
      <LockHealthPanel
        rows={[
          {
            smartDeviceId: "d",
            propertyName: "Bahamas",
            lockName: "Front Door",
            flags: [
              {
                code: "DOOR_SENSOR_CALIBRATION_NEEDED",
                severity: "yellow",
                label: "⚠ Calibration needed",
                detail: "Door sensor needs calibration in the August app.",
                since: null,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/needs attention \(1\)/i)).toBeTruthy();
    expect(screen.getByText("Bahamas")).toBeTruthy();
    expect(screen.getByText("⚠ Calibration needed")).toBeTruthy();
    expect(
      screen.getByText("Door sensor needs calibration in the August app."),
    ).toBeTruthy();
  });
});
