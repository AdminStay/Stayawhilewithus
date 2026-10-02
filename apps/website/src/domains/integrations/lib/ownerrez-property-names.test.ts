import { describe, expect, it } from "vitest";

import {
  ownerRezPropertyLabel,
  ownerRezPropertyNameMap,
} from "./ownerrez-property-names";

describe("OwnerRez property names (2026-10-02)", () => {
  it("maps exact OwnerRez ids (string or number) to names; skips missing ids and blank names", () => {
    expect(
      ownerRezPropertyNameMap([
        { ownerRezPropertyId: "480401", name: "Miramar Bliss" },
        { ownerRezPropertyId: 477351, name: "Las Sirenas" },
        { ownerRezPropertyId: null, name: "Manual Only" },
        { ownerRezPropertyId: undefined, name: "No Id" },
        { ownerRezPropertyId: "999", name: "   " },
      ]),
    ).toEqual({ "480401": "Miramar Bliss", "477351": "Las Sirenas" });
  });

  it("labels by name, or keeps the number visible when there's no match — never guessed", () => {
    const names = { "480401": "Miramar Bliss" };
    expect(ownerRezPropertyLabel(480401, names)).toBe("Miramar Bliss");
    expect(ownerRezPropertyLabel(389173, names)).toBe(
      "Unlinked OwnerRez property #389173",
    );
    expect(ownerRezPropertyLabel("1", {}, "OwnerRez property")).toBe(
      "OwnerRez property #1",
    );
  });
});
