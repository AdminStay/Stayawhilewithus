// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PropertyStatusFilterTabs } from "./PropertyStatusFilterTabs";

afterEach(cleanup);

describe("PropertyStatusFilterTabs (2026-10-07)", () => {
  it("shows Operational / Inactive / All with counts and links, the current one marked", () => {
    render(
      <PropertyStatusFilterTabs
        current="inactive"
        counts={{ operational: 38, inactive: 2, all: 40 }}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Operational (38)", "/properties"],
      ["Inactive (2)", "/properties?status=inactive"],
      ["All (40)", "/properties?status=all"],
    ]);
    expect(
      screen
        .getByRole("link", { name: "Inactive (2)" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Operational (38)" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});
