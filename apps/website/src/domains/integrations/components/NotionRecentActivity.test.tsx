// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { NotionActivityItem } from "../services/notion-activity.service";

import { NotionRecentActivity } from "./NotionRecentActivity";

afterEach(cleanup);

function activity(overrides: Partial<NotionActivityItem>): NotionActivityItem {
  return {
    id: "1",
    entityId: "page-1",
    entityType: "page",
    eventType: "page.properties_updated",
    changedFieldCount: 2,
    occurredAt: new Date("2026-09-16T12:00:00.000Z"),
    ...overrides,
  };
}

describe("NotionRecentActivity", () => {
  it("shows a small, unobtrusive status line — never the large empty-state card — when there is no activity yet", () => {
    const { container } = render(<NotionRecentActivity items={[]} />);
    expect(
      screen.getByText(
        "Notion change monitoring isn't active in Production yet.",
      ),
    ).toBeTruthy();
    // No big section header or card wrapper while empty — this must stay a
    // small status line, not a large empty-state block (Production
    // feedback, 2026-09-24: it took up a large amount of screen space).
    expect(screen.queryByText("Recent Notion Activity")).toBeNull();
    expect(container.querySelector(".divide-y")).toBeNull();
  });

  it("renders a human-readable label for a known event type", () => {
    render(
      <NotionRecentActivity
        items={[activity({ eventType: "page.properties_updated" })]}
      />,
    );
    expect(screen.getByText("Page properties changed")).toBeTruthy();
  });

  it("falls back to the raw event type string for an unrecognized type", () => {
    render(
      <NotionRecentActivity
        items={[activity({ eventType: "page.some_future_event" })]}
      />,
    );
    expect(screen.getByText("page.some_future_event")).toBeTruthy();
  });

  it("shows a changed-field count, never a field name or value", () => {
    render(
      <NotionRecentActivity items={[activity({ changedFieldCount: 3 })]} />,
    );
    expect(screen.getByText("3 fields changed")).toBeTruthy();
  });

  it("omits the changed-field badge entirely when the count is zero", () => {
    render(
      <NotionRecentActivity items={[activity({ changedFieldCount: 0 })]} />,
    );
    expect(screen.queryByText(/fields? changed/)).toBeNull();
  });

  it("contains no write/mutation affordance anywhere in the rendered output", () => {
    const { container } = render(
      <NotionRecentActivity items={[activity({})]} />,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByText(/^delete$/i)).toBeNull();
    expect(screen.queryByText(/^save$/i)).toBeNull();
  });

  // Requirement 7: Recent Activity still exposes no raw Notion content,
  // value, or entity id — never rendered anywhere in the DOM, even though
  // NotionActivityItem carries entityId on the object this component
  // receives.
  it("never renders the raw Notion entityId anywhere in the DOM", () => {
    const { container } = render(
      <NotionRecentActivity
        items={[activity({ entityId: "9f2c1a7e-raw-notion-page-id" })]}
      />,
    );
    expect(container.textContent).not.toContain("9f2c1a7e-raw-notion-page-id");
  });
});
