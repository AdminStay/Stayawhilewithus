import { describe, expect, it } from "vitest";

import { REGION_PROPERTY_MAP } from "../config/notion-region-reference";
import { resolveRegion } from "./notion-region-matching";

describe("resolveRegion", () => {
  it("resolves every one of the 38 documented properties to its correct region", () => {
    for (const [region, properties] of Object.entries(REGION_PROPERTY_MAP)) {
      for (const property of properties) {
        expect(resolveRegion(property)).toBe(region);
      }
    }
  });

  it("resolves the documented BOP alias to Bird of Paradise's region (Destin)", () => {
    expect(resolveRegion("BOP")).toBe("Destin");
  });

  it("resolves the observed 'BOP (Birds of Paradise)' Notion display-name variant to Destin", () => {
    expect(resolveRegion("BOP (Birds of Paradise)")).toBe("Destin");
  });

  it("resolves the plain 'Birds of Paradise' variant to Destin", () => {
    expect(resolveRegion("Birds of Paradise")).toBe("Destin");
  });

  it("resolves the documented 'Miramar Bliss 2' alias to Miramar Bliss's region (Destin)", () => {
    expect(resolveRegion("Miramar Bliss 2")).toBe("Destin");
  });

  it("returns Unknown / Unassigned for a name absent from the table and its aliases — never a guess", () => {
    expect(resolveRegion("Some Property Not In The Reference")).toBe(
      "Unknown / Unassigned",
    );
  });

  it("does not infer a region from partial/substring similarity to a known name", () => {
    // "Moonlit" alone is not the documented name ("Moonlit Cove") — must not
    // match just because it looks similar.
    expect(resolveRegion("Moonlit")).toBe("Unknown / Unassigned");
  });

  it("is case-insensitive", () => {
    expect(resolveRegion("moonlit cove")).toBe("SRQ");
    expect(resolveRegion("MOONLIT COVE")).toBe("SRQ");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveRegion("  Moonlit Cove  ")).toBe("SRQ");
  });
});
