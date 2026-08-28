// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  createPropertyFromOwnerRezAction: vi.fn(),
}));

import type { OwnerRezOnboardingReport } from "../services/ownerrez-onboarding.service";
import { OwnerRezOnboardingPanel } from "./OwnerRezOnboardingPanel";

afterEach(cleanup);

function makeReport(
  overrides: Partial<OwnerRezOnboardingReport> = {},
): OwnerRezOnboardingReport {
  return { active: [], inactive: [], ...overrides };
}

const OCEAN_PEARL_OR = {
  id: 431354,
  name: "Ocean Pearl",
  key: "ocean-pearl",
  active: true,
  internal_code: "OCEAN-PEARL",
};

const OCEAN_PEARL_DETAIL = {
  ...OCEAN_PEARL_OR,
  address: {
    street1: "2330 Kings Point Dr",
    city: "Largo",
    state: "FL",
    postal_code: "33774",
    country: "US",
  },
  bedrooms: 6,
  bathrooms_full: 4,
  bathrooms_half: 1,
  max_guests: 14,
  time_zone: "America/New_York",
};

describe("OwnerRezOnboardingPanel", () => {
  it("renders a Create control for an active property whose detail loaded, with the OwnerRez id as the only hidden field", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [
            { ownerRezProperty: OCEAN_PEARL_OR, detail: OCEAN_PEARL_DETAIL },
          ],
        })}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Create StayWhile Property",
    });
    expect(button).toBeTruthy();
    const form = button.closest("form")!;
    expect(form.querySelectorAll("input")).toHaveLength(1);
    expect(
      form.querySelector('input[name="ownerRezPropertyId"]'),
    ).toHaveProperty("value", "431354");
  });

  it("shows the real address for a property whose detail loaded", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [
            { ownerRezProperty: OCEAN_PEARL_OR, detail: OCEAN_PEARL_DETAIL },
          ],
        })}
      />,
    );

    expect(
      screen.getByText(/2330 Kings Point Dr, Largo, FL, 33774, US/),
    ).toBeTruthy();
  });

  it("renders no Create control, only a 'Detail unavailable' badge, for an active property whose detail fetch failed", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [{ ownerRezProperty: OCEAN_PEARL_OR, detail: null }],
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Create StayWhile Property" }),
    ).toBeNull();
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getByText("Detail unavailable")).toBeTruthy();
  });

  it("renders inactive properties read-only, with no Create control at all", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          inactive: [
            {
              ownerRezProperty: { ...OCEAN_PEARL_OR, id: 999, active: false },
              detail: null,
            },
          ],
        })}
      />,
    );

    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getByText("Inactive")).toBeTruthy();
  });

  it("never renders more than one form per active row — one confirmation per submission, no bulk control anywhere", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [
            { ownerRezProperty: OCEAN_PEARL_OR, detail: OCEAN_PEARL_DETAIL },
            {
              ownerRezProperty: {
                ...OCEAN_PEARL_OR,
                id: 377839,
                name: "Bahamas",
              },
              detail: { ...OCEAN_PEARL_DETAIL, id: 377839, name: "Bahamas" },
            },
          ],
        })}
      />,
    );

    expect(document.querySelectorAll("form")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Create StayWhile Property" }),
    ).toHaveLength(2);
  });

  it("gates the click behind window.confirm(), naming the specific OwnerRez property, before the form can submit", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [
            { ownerRezProperty: OCEAN_PEARL_OR, detail: OCEAN_PEARL_DETAIL },
          ],
        })}
      />,
    );

    screen.getByRole("button", { name: "Create StayWhile Property" }).click();

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ocean Pearl"),
    );
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("431354"));
    confirmSpy.mockRestore();
  });

  it("shows counts and empty-state text when both lists are empty", () => {
    render(<OwnerRezOnboardingPanel report={makeReport()} />);

    expect(screen.getByText("Active (0)")).toBeTruthy();
    expect(screen.getByText("Inactive (0)")).toBeTruthy();
    expect(
      screen.getByText("No unmatched active OwnerRez properties."),
    ).toBeTruthy();
    expect(
      screen.getByText("No unmatched inactive OwnerRez properties."),
    ).toBeTruthy();
  });

  it("renders the Copy Active as CSV control next to the Active heading, independent of Create controls", () => {
    render(
      <OwnerRezOnboardingPanel
        report={makeReport({
          active: [
            { ownerRezProperty: OCEAN_PEARL_OR, detail: OCEAN_PEARL_DETAIL },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Copy Active as CSV" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create StayWhile Property" }),
    ).toBeTruthy();
  });
});
