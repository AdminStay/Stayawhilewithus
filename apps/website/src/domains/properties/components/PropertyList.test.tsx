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
