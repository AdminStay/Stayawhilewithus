import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatStoredPropertyAddress,
  type StoredPropertyAddress,
} from "./property-address";

// FABRICATED TEST FIXTURES — not real StayWhile addresses.
const fabricated = (
  overrides: Partial<StoredPropertyAddress> = {},
): StoredPropertyAddress => ({
  addressLine1: "100 Example Street",
  addressLine2: "Unit 2",
  city: "Testville",
  state: "FL",
  postalCode: "00001",
  ...overrides,
});

describe("formatStoredPropertyAddress", () => {
  it("formats a complete address with a second line", () => {
    expect(formatStoredPropertyAddress(fabricated())).toEqual({
      lines: ["100 Example Street", "Unit 2", "Testville, FL 00001"],
      missing: [],
    });
  });

  it.each([null, "", "   "])(
    "omits a missing optional second line (%j) without an empty line",
    (addressLine2) => {
      expect(formatStoredPropertyAddress(fabricated({ addressLine2 }))).toEqual(
        {
          lines: ["100 Example Street", "Testville, FL 00001"],
          missing: [],
        },
      );
    },
  );

  it("never reports the optional second line as missing", () => {
    expect(
      formatStoredPropertyAddress(fabricated({ addressLine2: null })).missing,
    ).toEqual([]);
  });

  it("trims surrounding whitespace only", () => {
    expect(
      formatStoredPropertyAddress(
        fabricated({
          addressLine1: "  100 Example Street ",
          addressLine2: null,
          city: " Testville",
          postalCode: "00001 ",
        }),
      ).lines,
    ).toEqual(["100 Example Street", "Testville, FL 00001"]);
  });

  it("keeps state and postal code exactly as stored (no normalization)", () => {
    expect(
      formatStoredPropertyAddress(
        fabricated({
          addressLine2: null,
          state: "Florida",
          postalCode: "00001-0002",
        }),
      ).lines,
    ).toEqual(["100 Example Street", "Testville, Florida 00001-0002"]);
    expect(
      formatStoredPropertyAddress(fabricated({ state: "fl" })).lines.at(-1),
    ).toBe("Testville, fl 00001");
  });

  it("reports a missing street and shows the rest, inventing nothing", () => {
    expect(
      formatStoredPropertyAddress(
        fabricated({ addressLine1: " ", addressLine2: null }),
      ),
    ).toEqual({ lines: ["Testville, FL 00001"], missing: ["street"] });
  });

  it.each([
    [{ city: "" }, ["100 Example Street", "FL 00001"], ["city"]],
    [{ state: "" }, ["100 Example Street", "Testville, 00001"], ["state"]],
    [
      { postalCode: "" },
      ["100 Example Street", "Testville, FL"],
      ["postalCode"],
    ],
    [
      { city: "", state: "" },
      ["100 Example Street", "00001"],
      ["city", "state"],
    ],
    [
      { state: null, postalCode: null },
      ["100 Example Street", "Testville"],
      ["state", "postalCode"],
    ],
  ] as const)(
    "incomplete locality %j leaves no stray comma or space",
    (overrides, lines, missing) => {
      expect(
        formatStoredPropertyAddress(
          fabricated({ addressLine2: null, ...overrides }),
        ),
      ).toEqual({ lines, missing });
    },
  );

  it("returns no lines and every required part when nothing is stored", () => {
    expect(
      formatStoredPropertyAddress({
        addressLine1: "",
        addressLine2: null,
        city: " ",
        state: "",
        postalCode: null,
      }),
    ).toEqual({
      lines: [],
      missing: ["street", "city", "state", "postalCode"],
    });
  });

  it("never outputs placeholder text such as undefined or null", () => {
    const { lines } = formatStoredPropertyAddress({
      addressLine1: null,
      addressLine2: null,
      city: "Testville",
      state: null,
      postalCode: null,
    });
    expect(lines).toEqual(["Testville"]);
    expect(lines.join(" ")).not.toMatch(/undefined|null/);
  });
});

describe("source-level display-only proof", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  it.each([
    path.join(__dirname, "property-address.ts"),
    path.join(__dirname, "../components/PropertyList.tsx"),
  ])("%s adds no OwnerRez client import or database access", (file) => {
    const code = readFileSync(file, "utf8");
    expect(code).not.toMatch(/@stayw\/integrations|OwnerrezClient/);
    expect(code).not.toMatch(/@stayw\/database"|prisma\./);
  });
});
