import { describe, expect, it } from "vitest";

import type { NotionVisibleField } from "../config/notion-field-visibility";

import { buildNotionDetailSections } from "./notion-detail-sections";

const ALL_STANDARD_FIELDS: NotionVisibleField[] = [
  { field: "name", label: "Property", value: "Moonlit Cove" },
  { field: "address", label: "Address", value: "123 Main St" },
  { field: "bedrooms", label: "Bedrooms", value: 3 },
  { field: "bathrooms", label: "Bathrooms", value: 2 },
  { field: "guests", label: "Max guests", value: 6 },
  { field: "directBooking", label: "Direct booking", value: null },
  {
    field: "airbnbLink",
    label: "Airbnb listing",
    value: "https://airbnb.com/rooms/1",
  },
  { field: "vrboLink", label: "VRBO listing", value: null },
  { field: "googleDrivePhotosUrl", label: "Photos", value: null },
  { field: "guidebookUrl", label: "Guidebook", value: null },
];

describe("buildNotionDetailSections", () => {
  it("groups bedrooms/bathrooms/guests into a single 'Property overview' grid section", () => {
    const sections = buildNotionDetailSections(ALL_STANDARD_FIELDS);
    const overview = sections.find((s) => s.title === "Property overview");
    expect(overview?.layout).toBe("grid");
    expect(overview?.fields.map((f) => f.key)).toEqual([
      "bedrooms",
      "bathrooms",
      "guests",
    ]);
  });

  it("groups every link/contact field into a single 'Booking & resources' actions section", () => {
    const sections = buildNotionDetailSections(ALL_STANDARD_FIELDS);
    const resources = sections.find((s) => s.title === "Booking & resources");
    expect(resources?.layout).toBe("actions");
    expect(resources?.fields.map((f) => f.key)).toEqual([
      "directBooking",
      "airbnbLink",
      "vrboLink",
      "googleDrivePhotosUrl",
      "guidebookUrl",
    ]);
  });

  it("never includes name or address in any body section — they belong in the caller's header/subtitle", () => {
    const sections = buildNotionDetailSections(ALL_STANDARD_FIELDS);
    const allKeys = sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(allKeys).not.toContain("name");
    expect(allKeys).not.toContain("address");
  });

  it("carries real field values through unchanged (grouping never rewrites data)", () => {
    const sections = buildNotionDetailSections(ALL_STANDARD_FIELDS);
    const bedrooms = sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === "bedrooms");
    const airbnb = sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === "airbnbLink");
    expect(bedrooms?.value).toBe(3);
    expect(airbnb?.value).toBe("https://airbnb.com/rooms/1");
  });

  it("places a field belonging to neither known bucket into a plain list fallback section, never dropping it", () => {
    // Simulates a future Kenny/Michelle-approved field not yet mapped to a
    // specific layout bucket (NOTION_VISIBILITY_ALLOWLIST's `field` type is
    // a closed keyof NotionListingRecord, so a genuinely new key is
    // type-widened here rather than added to the real allowlist) — proves
    // it still renders somewhere instead of silently disappearing.
    const unmapped = [
      { field: "unmappedFutureField", label: "Future field", value: "x" },
    ] as unknown as NotionVisibleField[];

    const sections = buildNotionDetailSections(unmapped);
    const fallback = sections.find((s) => s.layout === "list");
    expect(fallback?.fields.map((f) => f.key)).toContain("unmappedFutureField");
  });

  it("omits a section entirely when it would have zero fields, rather than rendering an empty group", () => {
    const onlyOverview: NotionVisibleField[] = [
      { field: "bedrooms", label: "Bedrooms", value: 3 },
    ];
    const sections = buildNotionDetailSections(onlyOverview);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe("Property overview");
  });

  it("returns no sections for an empty input", () => {
    expect(buildNotionDetailSections([])).toEqual([]);
  });
});
