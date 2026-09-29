// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LockHealthPanel } from "./LockHealthPanel";

afterEach(cleanup);

const NOW = "2026-09-29T17:00:00.000Z";

const ROWS = [
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
        code: "STALE_BATTERY_TELEMETRY" as const,
        severity: "yellow" as const,
        label: "Battery reading stale",
        detail: "Battery last reported 17 days ago.",
        since: "2026-09-12T17:00:00.000Z",
      },
    ],
  },
  {
    smartDeviceId: "c",
    propertyName: "Bonjour",
    lockName: "Front Door",
    flags: [
      {
        code: "DOOR_OPEN_UNLOCKED" as const,
        severity: "red" as const,
        label: "Door open and unlocked",
        detail: "Unlocked for 5 h.",
        since: "2026-09-29T12:00:00.000Z",
      },
    ],
  },
];

describe("LockHealthPanel — daily lock report (2026-09-29)", () => {
  it("lists every problem worst first with severity, problem, detail, since/duration, New and the Ops action", () => {
    render(<LockHealthPanel rows={ROWS} now={NOW} />);

    expect(
      screen.getByText("Daily lock report — needs attention (2)"),
    ).toBeTruthy();
    expect(screen.queryByText("Bahamas")).toBeNull();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const first = within(items[0]!);
    expect(first.getByText("Urgent")).toBeTruthy();
    expect(first.getByText("New")).toBeTruthy();
    expect(first.getByText("Bonjour")).toBeTruthy();
    expect(first.getByText("Door open and unlocked")).toBeTruthy();
    expect(first.getByText("Unlocked for 5 h.")).toBeTruthy();
    expect(first.getByText(/^Since .*\(for 5 h\)$/)).toBeTruthy();
    expect(
      first.getByText(
        "Confirm the door is closed and the property is secure onsite.",
      ),
    ).toBeTruthy();

    const second = within(items[1]!);
    expect(second.getByText("Routine")).toBeTruthy();
    expect(second.queryByText("New")).toBeNull();
    // A reading time is labelled as such — never as the problem's start.
    expect(second.getByText(/^Last reading /)).toBeTruthy();
    expect(second.queryByText(/^Since /)).toBeNull();
  });

  it("summary line: items by severity and New count", () => {
    render(<LockHealthPanel rows={ROWS} now={NOW} />);
    expect(
      screen.getByLabelText("Daily lock report summary").textContent,
    ).toContain("2 items · Urgent 1 · High 0 · Routine 1 · New in last 24 h 1");
  });

  it("Copy daily lock report copies the plain-text report (no ids)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LockHealthPanel rows={ROWS} now={NOW} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy daily lock report" }),
    );
    await waitFor(() => expect(screen.getByText("Copied.")).toBeTruthy());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("StayWhile — Daily lock report");
    expect(text).toContain(
      "1. [NEW] Bonjour — Front Door: Door open and unlocked",
    );
    expect(text).toContain(
      "Action: Check the battery level in the August app; replace batteries onsite if low.",
    );
    expect(text).not.toMatch(/\bid\b|smartDeviceId/);
  });

  it("says so when there are no exceptions", () => {
    render(<LockHealthPanel rows={[]} now={NOW} />);
    expect(
      screen.getByText("No lock health exceptions right now."),
    ).toBeTruthy();
    expect(
      screen.getByText("Daily lock report — needs attention (0)"),
    ).toBeTruthy();
  });

  it("is read-only: the only control is Copy", () => {
    render(<LockHealthPanel rows={ROWS} now={NOW} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Copy daily lock report",
    ]);
  });

  it("on-page detail uses the same presentation as Copy: formatted times and the hold full stop (2026-09-29)", () => {
    const { container } = render(
      <LockHealthPanel
        rows={[
          {
            smartDeviceId: "e",
            propertyName: "Royal Eden",
            lockName: "Front Door",
            flags: [
              {
                code: "UNKNOWN_STATE",
                severity: "orange",
                label: "State unknown (persistent)",
                detail:
                  "Reason: unknown_error_during_connect. Unknown for 6 h. Last valid state: locked at 2026-09-29T16:54:00.000Z.",
                since: "2026-09-29T11:00:00.000Z",
              },
            ],
          },
          {
            smartDeviceId: "f",
            propertyName: "Florisun",
            lockName: "Flor Sun - Front Door",
            flags: [
              {
                code: "OPERATIONAL_HOLD",
                severity: "red",
                label: "Out of service",
                detail:
                  "Lock replacement required (Kenny inspected 09-26) Remote commands and testing are blocked until an admin clears this.",
                since: "2026-09-29T14:00:00.000Z",
              },
            ],
          },
        ]}
        now={NOW}
      />,
    );
    expect(
      screen.getByText(
        "Reason: unknown_error_during_connect. Unknown for 6 h. Last valid state: locked at Sep 29, 2026, 11:54 AM CDT.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Lock replacement required (Kenny inspected 09-26). Remote commands and testing are blocked until an admin clears this.",
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("a calibration-needed lock shows its onsite August-app action and no New", () => {
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
        now={NOW}
      />,
    );
    expect(screen.getByText("⚠ Calibration needed")).toBeTruthy();
    expect(
      screen.getByText("Calibrate DoorSense in the August app onsite."),
    ).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
  });
});
