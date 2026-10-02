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
