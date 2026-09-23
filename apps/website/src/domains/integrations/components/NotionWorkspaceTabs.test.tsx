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
