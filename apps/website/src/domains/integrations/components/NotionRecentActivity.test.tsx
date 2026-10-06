// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { NotionActivityView } from "../services/notion-activity.service";

import { NotionRecentActivity } from "./NotionRecentActivity";

afterEach(cleanup);

const NOW = new Date("2026-09-30T12:00:00.000Z");
const view = (
  overrides: Partial<NotionActivityView> = {},
): NotionActivityView => ({
  id: "row-1",
  action: "updated_properties",
  actionLabel: "Updated",
  who: "Michelle",
  verb: "updated",
  where:
    "Library › Property Directory › Palm Haven › Router and Thermostat Location",
  change: "Changed: Router location",
  occurredAt: new Date("2026-09-30T11:57:00.000Z"),
  restricted: false,
  ...overrides,
});

describe("NotionRecentActivity (2026-09-30)", () => {
  it("shows the honest empty state before monitoring is live", () => {
    render(<NotionRecentActivity items={[]} now={NOW} />);
    expect(
      screen.getByText(/monitoring isn.t active in Production yet/),
    ).toBeTruthy();
  });

  it("renders who / did what / where / what changed / when", () => {
    render(<NotionRecentActivity items={[view()]} now={NOW} />);
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain(
      "Michelle updated Library › Property Directory › Palm Haven › Router and Thermostat Location",
    );
    expect(within(item).getByText("Updated")).toBeTruthy();
    expect(within(item).getByText("Changed: Router location")).toBeTruthy();
    expect(within(item).getByText("3 minutes ago")).toBeTruthy();
  });

  it("covers the other actions with their labels", () => {
    render(
      <NotionRecentActivity
        now={NOW}
        items={[
          view({
            id: "a",
            action: "deleted",
            actionLabel: "Moved to trash",
            verb: "moved to trash",
            change: null,
          }),
          view({
            id: "b",
            action: "restored",
            actionLabel: "Restored",
            verb: "restored",
            change: null,
          }),
          view({
            id: "c",
            action: "moved",
            actionLabel: "Moved",
            verb: "moved",
            change: null,
          }),
          view({
            id: "d",
            action: "created",
            actionLabel: "Created",
            verb: "created",
            change: null,
          }),
        ]}
      />,
    );
    for (const label of ["Moved to trash", "Restored", "Moved", "Created"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("marks a restricted item and shows no change details for it", () => {
    render(
      <NotionRecentActivity
        now={NOW}
        items={[
          view({
            where: "a restricted Notion page",
            change: null,
            restricted: true,
          }),
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Restricted")).toBeTruthy();
    expect(item.textContent).toContain(
      "Michelle updated a restricted Notion page",
    );
    expect(item.textContent).not.toContain("Changed:");
  });
});
