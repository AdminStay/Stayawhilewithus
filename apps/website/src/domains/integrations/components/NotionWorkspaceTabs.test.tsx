// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotionWorkspaceTabs } from "./NotionWorkspaceTabs";

afterEach(cleanup);

describe("NotionWorkspaceTabs", () => {
  it("shows only the SOPs section by default", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );

    expect(screen.getByText("SOPs content")).toBeTruthy();
    expect(screen.queryByText("Library content")).toBeNull();
    expect(screen.queryByText("Listings content")).toBeNull();
  });

  it("switching to Library shows only Library content — SOPs and Property Listings disappear entirely, not just visually", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Library" }));

    expect(screen.getByText("Library content")).toBeTruthy();
    expect(screen.queryByText("SOPs content")).toBeNull();
    expect(screen.queryByText("Listings content")).toBeNull();
  });

  it("switching to Property Listings shows only that section", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Property Listings" }));

    expect(screen.getByText("Listings content")).toBeTruthy();
    expect(screen.queryByText("SOPs content")).toBeNull();
    expect(screen.queryByText("Library content")).toBeNull();
  });

  it("marks the active tab via aria-selected, for exactly one tab at a time", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Library" }));

    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe("Library");
  });

  it("switching back to SOPs after visiting other tabs shows SOPs again, unaffected by having been hidden", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    fireEvent.click(screen.getByRole("tab", { name: "SOPs" }));

    expect(screen.getByText("SOPs content")).toBeTruthy();
    expect(screen.queryByText("Library content")).toBeNull();
  });
});

describe("NotionWorkspaceTabs — Recent Activity tab (2026-10-16)", () => {
  const renderWithActivity = () =>
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
        activityContent={<p>Activity content</p>}
      />,
    );

  it("lists the four tabs in order: SOPs, Library, Property Listings, Recent Activity", () => {
    renderWithActivity();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "SOPs",
      "Library",
      "Property Listings",
      "Recent Activity",
    ]);
  });

  it("starts on SOPs; the activity feed isn't rendered until its tab is chosen", () => {
    renderWithActivity();
    expect(screen.getByText("SOPs content")).toBeTruthy();
    expect(screen.queryByText("Activity content")).toBeNull();
  });

  it("switching to Recent Activity shows only the activity feed", () => {
    renderWithActivity();
    fireEvent.click(screen.getByRole("tab", { name: "Recent Activity" }));
    expect(screen.getByText("Activity content")).toBeTruthy();
    expect(screen.queryByText("SOPs content")).toBeNull();
    expect(screen.queryByText("Library content")).toBeNull();
    expect(screen.queryByText("Listings content")).toBeNull();
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected.map((t) => t.textContent)).toEqual(["Recent Activity"]);
  });

  it("switching away from Recent Activity hides it again", () => {
    renderWithActivity();
    fireEvent.click(screen.getByRole("tab", { name: "Recent Activity" }));
    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    expect(screen.getByText("Library content")).toBeTruthy();
    expect(screen.queryByText("Activity content")).toBeNull();
  });

  it("has no Recent Activity tab at all when no activity content is passed (no access)", () => {
    render(
      <NotionWorkspaceTabs
        sopsContent={<p>SOPs content</p>}
        libraryContent={<p>Library content</p>}
        listingsContent={<p>Listings content</p>}
      />,
    );
    expect(screen.queryByRole("tab", { name: "Recent Activity" })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
