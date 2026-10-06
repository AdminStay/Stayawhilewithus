import { describe, expect, it } from "vitest";

import {
  filterAndSortProperties,
  parsePropertyStatusFilter,
  propertyStatusFilterCounts,
  propertyStatusFilterHref,
  propertyStatusLabel,
} from "./property-status-filter";

const p = (name: string, status: string, deletedAt: Date | null = null) => ({
  name,
  status,
  deletedAt,
});

const PROPERTIES = [
  p("Sandy Nudes", "ACTIVE"),
  p("bonjour", "ONBOARDING"),
  p("Moonlit", "INACTIVE"),
  p("Coco Vista", "OFFBOARDED"),
  p("Gone", "ACTIVE", new Date("2026-09-01")),
];

describe("/properties status filter (2026-10-07)", () => {
  it("defaults to operational for a missing or unknown value", () => {
    expect(parsePropertyStatusFilter(undefined)).toBe("operational");
    expect(parsePropertyStatusFilter("bogus")).toBe("operational");
    expect(parsePropertyStatusFilter("inactive")).toBe("inactive");
    expect(parsePropertyStatusFilter(["all", "inactive"])).toBe("all");
  });

  it("operational = ACTIVE + ONBOARDING (the operational scope), name-sorted, case-insensitive", () => {
    expect(
      filterAndSortProperties(PROPERTIES, "operational").map((x) => x.name),
    ).toEqual(["bonjour", "Sandy Nudes"]);
  });

  it("inactive = INACTIVE + OFFBOARDED", () => {
    expect(
      filterAndSortProperties(PROPERTIES, "inactive").map((x) => x.name),
    ).toEqual(["Coco Vista", "Moonlit"]);
  });

  it("all = every non-deleted property; soft-deleted is in no tab", () => {
    expect(
      filterAndSortProperties(PROPERTIES, "all").map((x) => x.name),
    ).toEqual(["bonjour", "Coco Vista", "Moonlit", "Sandy Nudes"]);
    expect(propertyStatusFilterCounts(PROPERTIES)).toEqual({
      operational: 2,
      inactive: 2,
      all: 4,
    });
  });

  it("never changes a property's status (pure filter)", () => {
    const input = PROPERTIES.map((x) => ({ ...x }));
    filterAndSortProperties(input, "inactive");
    expect(input).toEqual(PROPERTIES);
  });

  it("builds links with the default filter as the bare page", () => {
    expect(propertyStatusFilterHref("operational")).toBe("/properties");
    expect(propertyStatusFilterHref("inactive")).toBe(
      "/properties?status=inactive",
    );
    expect(propertyStatusFilterHref("all")).toBe("/properties?status=all");
  });

  it("labels statuses for display; an unknown status falls back to itself", () => {
    expect(propertyStatusLabel("ONBOARDING")).toBe("Onboarding");
    expect(propertyStatusLabel("OFFBOARDED")).toBe("Offboarded");
    expect(propertyStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
