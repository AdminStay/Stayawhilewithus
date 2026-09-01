import { describe, expect, it } from "vitest";

import { matchesListingQuery } from "./notion-listing-match";

function listing(overrides: {
  name?: string;
  address?: string | null;
  directBooking?: string | null;
}) {
  return {
    name: overrides.name ?? "Aqua Palm",
    address: overrides.address ?? null,
    directBooking: overrides.directBooking ?? null,
  };
}

describe("matchesListingQuery", () => {
  it("matches on name, case/whitespace-insensitively", () => {
    expect(
      matchesListingQuery(listing({ name: "Aqua Palm" }), "  AQUA  "),
    ).toBe(true);
    expect(matchesListingQuery(listing({ name: "Aqua Palm" }), "aqua")).toBe(
      true,
    );
    expect(matchesListingQuery(listing({ name: "Aqua Palm" }), "AQUA")).toBe(
      true,
    );
  });

  it("matches on address", () => {
    const item = listing({ name: "Ocean Pearl", address: "123 Bay St" });
    expect(matchesListingQuery(item, "bay")).toBe(true);
    expect(matchesListingQuery(item, "elm")).toBe(false);
  });

  it("matches on non-URL direct-booking text", () => {
    const item = listing({ directBooking: "Book direct via text message" });
    expect(matchesListingQuery(item, "text message")).toBe(true);
  });

  it("does not match direct-booking content when it's a real URL — not searchable keyword text", () => {
    const item = listing({ directBooking: "https://example.com/book" });
    expect(matchesListingQuery(item, "example")).toBe(false);
  });

  it("returns false for an empty or whitespace-only query", () => {
    const item = listing({ name: "Aqua Palm" });
    expect(matchesListingQuery(item, "")).toBe(false);
    expect(matchesListingQuery(item, "   ")).toBe(false);
  });

  it("returns false when no field contains the query", () => {
    const item = listing({ name: "Aqua Palm", address: "123 Bay St" });
    expect(matchesListingQuery(item, "nonexistent")).toBe(false);
  });

  it("handles a null address without throwing", () => {
    const item = listing({ name: "Aqua Palm", address: null });
    expect(matchesListingQuery(item, "bay")).toBe(false);
  });
});
