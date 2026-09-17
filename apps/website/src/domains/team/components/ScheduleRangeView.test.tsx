// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScheduleRangeView } from "./ScheduleRangeView";

afterEach(cleanup);

describe("ScheduleRangeView", () => {
  it("renders each day's date label and its shift entries", () => {
    render(
      <ScheduleRangeView
        days={[
          {
            dateLabel: "Mon, Jan 5",
            entries: [
              {
                sourceKey: "Taylor",
                mapped: false,
                role: "Operations",
                timeLabel: "6:00 AM – 2:00 PM",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Mon, Jan 5")).toBeTruthy();
    expect(screen.getByText("Taylor")).toBeTruthy();
    expect(screen.getByText("Operations")).toBeTruthy();
    expect(screen.getByText("6:00 AM – 2:00 PM")).toBeTruthy();
  });

  it("shows 'Nobody scheduled' for a day with zero entries when at least one other day has entries", () => {
    render(
      <ScheduleRangeView
        days={[
          { dateLabel: "Mon, Jan 5", entries: [] },
          {
            dateLabel: "Tue, Jan 6",
            entries: [
              {
                sourceKey: "Jordan",
                mapped: true,
                role: "MOD",
                timeLabel: "9:00 AM – 5:00 PM",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Nobody scheduled.")).toBeTruthy();
    expect(screen.getByText("Jordan")).toBeTruthy();
  });

  it("shows a single empty state, not per-day noise, when every day has zero entries", () => {
    render(
      <ScheduleRangeView
        days={[
          { dateLabel: "Mon, Jan 5", entries: [] },
          { dateLabel: "Tue, Jan 6", entries: [] },
        ]}
      />,
    );

    expect(screen.getByText("No shifts in this range")).toBeTruthy();
    expect(screen.queryByText("Nobody scheduled.")).toBeNull();
  });

  it("contains no write/mutation affordance anywhere in the rendered output", () => {
    const { container } = render(
      <ScheduleRangeView
        days={[
          {
            dateLabel: "Mon, Jan 5",
            entries: [
              {
                sourceKey: "Taylor",
                mapped: false,
                role: "Operations",
                timeLabel: "6:00 AM – 2:00 PM",
              },
            ],
          },
        ]}
      />,
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
