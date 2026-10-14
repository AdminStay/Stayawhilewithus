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
  receivedAt: null,
  restricted: false,
  notionUrl: null,
  earlierValueUnknown: false,
  ...overrides,
});

describe("NotionRecentActivity (2026-09-30)", () => {
  it("shows an honest empty state when nothing has been recorded", () => {
    render(<NotionRecentActivity items={[]} now={NOW} />);
    expect(
      screen.getByText("No Notion changes have been recorded yet."),
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

describe("NotionRecentActivity — exact received timestamp (2026-10-11)", () => {
  it("shows the stored received_at on its own line, with seconds, in America/Chicago — and keeps the relative label", () => {
    render(
      <NotionRecentActivity
        items={[
          view({
            occurredAt: new Date("2026-09-30T11:57:00.000Z"),
            receivedAt: new Date("2026-09-30T11:57:03.000Z"),
          }),
        ]}
        now={NOW}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("3 minutes ago")).toBeTruthy();
    // 11:57:03Z -> 6:57:03 AM CDT (UTC-5).
    expect(
      within(item).getByText("Received September 30, 2026 · 6:57:03 AM CDT"),
    ).toBeTruthy();
    // Unchanged: who / what / where / change.
    expect(item.textContent).toContain("Michelle updated");
    expect(within(item).getByText("Changed: Router location")).toBeTruthy();
  });

  it("uses received_at, not the render time", () => {
    render(
      <NotionRecentActivity
        items={[view({ receivedAt: new Date("2026-09-30T11:57:03.000Z") })]}
        now={new Date("2026-10-05T00:00:00.000Z")}
      />,
    );
    expect(
      screen.getByText("Received September 30, 2026 · 6:57:03 AM CDT"),
    ).toBeTruthy();
  });

  it.each([
    ["missing", null],
    ["invalid", new Date("not a date")],
  ])("omits the line safely when received_at is %s", (_label, receivedAt) => {
    render(<NotionRecentActivity items={[view({ receivedAt })]} now={NOW} />);
    const item = screen.getByRole("listitem");
    expect(within(item).queryByText(/^Received /)).toBeNull();
    expect(item.textContent).not.toContain("Invalid Date");
    expect(within(item).getByText("3 minutes ago")).toBeTruthy();
  });

  it("keeps the order it was given (newest first from the service)", () => {
    render(
      <NotionRecentActivity
        items={[
          view({
            id: "a",
            who: "First",
            receivedAt: new Date("2026-09-30T11:59:09.000Z"),
          }),
          view({
            id: "b",
            who: "Second",
            receivedAt: new Date("2026-09-30T11:59:08.000Z"),
          }),
        ]}
        now={NOW}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("6:59:09 AM CDT");
    expect(items[1]!.textContent).toContain("6:59:08 AM CDT");
  });

  it("a restricted item still shows its timestamp but no title or change", () => {
    render(
      <NotionRecentActivity
        items={[
          view({
            restricted: true,
            where: "a restricted Notion page",
            change: null,
            receivedAt: new Date("2026-09-30T11:57:03.000Z"),
          }),
        ]}
        now={NOW}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("a restricted Notion page");
    expect(item.textContent).not.toContain("Router location");
    expect(within(item).getByText(/^Received September 30, 2026/)).toBeTruthy();
  });
});

describe("NotionRecentActivity — Phase 0 (2026-10-15)", () => {
  const URL = "https://notion.so/3e26058db989803da1d7f06f8adc27a6";

  it("renders Open in Notion as a new-tab link with noopener noreferrer", () => {
    render(
      <NotionRecentActivity items={[view({ notionUrl: URL })]} now={NOW} />,
    );
    const link = screen.getByRole("link", { name: "Open in Notion" });
    expect(link.getAttribute("href")).toBe(URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders no link when the item has none", () => {
    render(<NotionRecentActivity items={[view()]} now={NOW} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never renders a non-http(s) URL as a link", () => {
    render(
      <NotionRecentActivity
        items={[view({ notionUrl: "javascript:alert(1)" })]}
        now={NOW}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a restricted item shows the badge and no link", () => {
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
    expect(within(item).queryByRole("link")).toBeNull();
  });

  it("says the earlier value is unknown only when flagged", () => {
    render(
      <NotionRecentActivity
        now={NOW}
        items={[
          view({ id: "edit", earlierValueUnknown: true }),
          view({ id: "create", action: "created", earlierValueUnknown: false }),
        ]}
      />,
    );
    expect(screen.getAllByText("Earlier value unknown")).toHaveLength(1);
  });

  it("renders the Unknown editor label it is given", () => {
    render(
      <NotionRecentActivity
        items={[view({ who: "Unknown editor" })]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("listitem").textContent).toContain(
      "Unknown editor updated",
    );
  });
});
