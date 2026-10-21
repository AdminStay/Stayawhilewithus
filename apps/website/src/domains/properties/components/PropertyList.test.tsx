// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  deletePropertyAction: vi.fn(),
  updatePropertyOccupancyAction: vi.fn(),
  updatePropertyStatusAction: vi.fn(),
}));

import { PropertyList } from "./PropertyList";

afterEach(cleanup);

const property = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Miramar Bliss",
  internalCode: "MB",
  city: "Destin",
  state: "FL",
  status: "ONBOARDING",
  maxOccupancy: 8,
  ownerRezPropertyId: "386471",
  ...overrides,
});

describe("PropertyList — Open in OwnerRez (2026-10-03)", () => {
  it("a linked property links to its OwnerRez property page by its OwnerRez id", () => {
    render(<PropertyList properties={[property()] as never} />);
    expect(
      screen
        .getByRole("link", { name: "Open Miramar Bliss in OwnerRez" })
        .getAttribute("href"),
    ).toBe("https://app.ownerrez.com/properties/386471/info");
  });

  it("a property not linked to OwnerRez gets no OwnerRez link", () => {
    render(
      <PropertyList
        properties={
          [
            property({ ownerRezPropertyId: null, name: "Manual Place" }),
          ] as never
        }
      />,
    );
    expect(screen.queryByRole("link", { name: /in OwnerRez/ })).toBeNull();
  });
});

describe("PropertyList — display (2026-10-07)", () => {
  it("shows a readable status label; the status dropdown still submits the enum", () => {
    const { container } = render(
      <PropertyList properties={[property()] as never} />,
    );
    expect(
      screen.getAllByText("Onboarding").filter((el) => el.tagName !== "OPTION"),
    ).toHaveLength(1);
    expect(screen.queryByText("ONBOARDING")).toBeNull();
    const options = [
      ...container.querySelectorAll('select[name="status"] option'),
    ].map((o) => [(o as HTMLOptionElement).value, o.textContent]);
    expect(options).toEqual([
      ["ACTIVE", "Active"],
      ["INACTIVE", "Inactive"],
      ["ONBOARDING", "Onboarding"],
      ["OFFBOARDED", "Offboarded"],
    ]);
  });

  it("uses the filter-specific empty state it's given", () => {
    render(
      <PropertyList
        properties={[]}
        emptyTitle="No inactive properties"
        emptyDescription="Inactive and offboarded properties appear here."
      />,
    );
    expect(screen.getByText("No inactive properties")).toBeTruthy();
  });
});

describe("PropertyList — Cleaner column (Cleaner Assignments Phase 3)", () => {
  it("is hidden entirely when the viewer can't read cleaners (summaries null)", () => {
    render(<PropertyList properties={[property()] as never} />);
    expect(screen.queryByRole("columnheader", { name: "Cleaner" })).toBeNull();
  });

  it("shows the current cleaners, linking to that property on /cleaners", () => {
    render(
      <PropertyList
        properties={
          [property(), property({ id: "p2", name: "Dune Cottage" })] as never
        }
        cleanerSummaries={{ p1: { primary: "Alex", teamMembers: ["Sam"] } }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Cleaner" })).toBeTruthy();
    const link = screen.getByTitle("Manage cleaners for Miramar Bliss");
    expect(link.getAttribute("href")).toBe("/cleaners#property-p1");
    expect(link.textContent?.replace(/\s+/g, " ").trim()).toBe("Alex + Sam");
    const unassigned = screen.getByTitle("Manage cleaners for Dune Cottage");
    expect(unassigned.getAttribute("href")).toBe("/cleaners#property-p2");
    expect(unassigned.textContent).toBe("No cleaner");
  });
});

describe("PropertyList — full stored address (2026-10-20)", () => {
  // FABRICATED TEST FIXTURES — not real StayWhile addresses.
  const fabricatedAddress = {
    addressLine1: "100 Example Street",
    addressLine2: "Unit 2",
    city: "Testville",
    state: "FL",
    postalCode: "00001",
  };

  function addressCell(overrides: Record<string, unknown> = {}) {
    render(
      <PropertyList
        properties={
          [
            property({
              name: "FABRICATED Test Property",
              ...fabricatedAddress,
              ...overrides,
            }),
          ] as never
        }
      />,
    );
    const cells = screen.getAllByRole("row")[1]!.querySelectorAll("td");
    return cells[1]!;
  }

  function lineTexts(cell: HTMLElement) {
    return [...cell.querySelectorAll(":scope > div > div")].map(
      (d) => d.textContent,
    );
  }

  it("labels the column Address", () => {
    addressCell();
    expect(screen.getByRole("columnheader", { name: "Address" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Location" })).toBeNull();
  });

  it("shows the complete stored address, line by line", () => {
    const cell = addressCell();
    expect(lineTexts(cell)).toEqual([
      "100 Example Street",
      "Unit 2",
      "Testville, FL 00001",
    ]);
    expect(cell.textContent).not.toContain("Incomplete");
  });

  it.each([null, ""])(
    "omits a missing second line (%j) and doesn't flag it",
    (addressLine2) => {
      const cell = addressCell({ addressLine2 });
      expect(lineTexts(cell)).toEqual([
        "100 Example Street",
        "Testville, FL 00001",
      ]);
      expect(cell.textContent).not.toContain("Incomplete");
    },
  );

  it("shows state and postal code exactly as stored", () => {
    const cell = addressCell({ state: "Florida", postalCode: "00001-0002" });
    expect(cell.textContent).toContain("Testville, Florida 00001-0002");
  });

  it("names the blank parts of an incomplete address and fills nothing in", () => {
    const cell = addressCell({
      addressLine1: "",
      addressLine2: null,
      postalCode: " ",
    });
    expect(lineTexts(cell)).toEqual([
      "Testville, FL",
      "Incomplete address: missing street, postal code",
    ]);
    expect(cell.textContent).not.toMatch(/undefined|null/);
  });

  it("says no address is stored when every address field is blank", () => {
    const cell = addressCell({
      addressLine1: "",
      addressLine2: null,
      city: "",
      state: "",
      postalCode: "",
    });
    expect(cell.textContent).toBe("No address stored");
  });
});

describe("PropertyList — max guests from OwnerRez (2026-10-21)", () => {
  it("shows a linked property's value read-only, marked From OwnerRez, with no edit control", () => {
    const { container } = render(
      <PropertyList properties={[property({ maxOccupancy: 14 })] as never} />,
    );
    expect(screen.getByText("From OwnerRez")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
    expect(container.querySelector('input[name="maxOccupancy"]')).toBeNull();
  });

  it("keeps the manual control for a property not linked to OwnerRez", () => {
    const { container } = render(
      <PropertyList
        properties={
          [property({ ownerRezPropertyId: null, maxOccupancy: 6 })] as never
        }
      />,
    );
    const input = container.querySelector(
      'input[name="maxOccupancy"]',
    ) as HTMLInputElement | null;
    expect(input?.defaultValue).toBe("6");
    expect(screen.queryByText("From OwnerRez")).toBeNull();
  });
});
