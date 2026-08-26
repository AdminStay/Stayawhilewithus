// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  confirmOwnerRezLinkAction: vi.fn(),
}));

import type { OwnerRezMatchReport } from "../services/ownerrez-match-report.service";
import { OwnerRezConfirmLinkPanel } from "./OwnerRezConfirmLinkPanel";

afterEach(cleanup);

function makeReport(
  overrides: Partial<OwnerRezMatchReport> = {},
): OwnerRezMatchReport {
  return {
    alreadyLinked: [],
    proposedMatches: [],
    unmatchedOwnerRez: [],
    unmatchedStayWhile: [],
    ...overrides,
  };
}

const AQUA_PALM_SW = {
  id: "aqua-palm-uuid",
  name: "Aqua Palm",
  internalCode: "AQUA-PALM",
  ownerRezPropertyId: null,
};
const AQUA_PALM_OR = {
  id: 386471,
  name: "Aqua Palm",
  key: "aqua-palm",
  active: true,
  internal_code: "Aqua Palm",
};

describe("OwnerRezConfirmLinkPanel", () => {
  it("renders exactly one Confirm control per approved, unlinked, live-visible property — one confirmation per submission, never a bulk control", () => {
    render(
      <OwnerRezConfirmLinkPanel
        report={makeReport({
          proposedMatches: [
            { property: AQUA_PALM_SW, ownerRezProperty: AQUA_PALM_OR },
          ],
        })}
      />,
    );

    // Exactly one form, one button — not six, not zero, and no
    // select-multiple/checkbox control of any kind.
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Confirm Link" }),
    ).toHaveLength(1);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

    const form = document.querySelector("form") as HTMLFormElement;
    const propertyIdInput = form.querySelector(
      'input[name="propertyId"]',
    ) as HTMLInputElement;
    const ownerRezIdInput = form.querySelector(
      'input[name="ownerRezPropertyId"]',
    ) as HTMLInputElement;

    // Exactly one propertyId/ownerRezPropertyId pair — no array-shaped or
    // repeated hidden fields that could smuggle a second link into one
    // submission.
    expect(form.querySelectorAll('input[name="propertyId"]')).toHaveLength(1);
    expect(
      form.querySelectorAll('input[name="ownerRezPropertyId"]'),
    ).toHaveLength(1);
    expect(propertyIdInput.value).toBe("aqua-palm-uuid");
    expect(ownerRezIdInput.value).toBe("386471");
  });

  it("shows the exact StayWhile name/internalCode and OwnerRez name/ID/status before any confirmation", () => {
    render(
      <OwnerRezConfirmLinkPanel
        report={makeReport({
          proposedMatches: [
            { property: AQUA_PALM_SW, ownerRezProperty: AQUA_PALM_OR },
          ],
        })}
      />,
    );

    const card = screen
      .getByRole("button", { name: "Confirm Link" })
      .closest("div.rounded-card") as HTMLElement;

    // StayWhile name + internal code: the code renders in its own <span>,
    // so check it via getByText and confirm its containing line also shows
    // the StayWhile name (plain DOM check — avoids ambiguity with the
    // OwnerRez line below, which can show the same property name).
    const codeSpan = within(card).getByText("(AQUA-PALM)");
    expect(codeSpan.parentElement?.textContent).toContain("Aqua Palm");

    expect(within(card).getByText(/→ OwnerRez: Aqua Palm/)).toBeTruthy();
    expect(within(card).getByText(/ID 386471/)).toBeTruthy();
    expect(within(card).getByText("Active")).toBeTruthy();
  });

  it("shows Inactive status when the live OwnerRez record is inactive", () => {
    render(
      <OwnerRezConfirmLinkPanel
        report={makeReport({
          proposedMatches: [
            {
              property: AQUA_PALM_SW,
              ownerRezProperty: { ...AQUA_PALM_OR, active: false },
            },
          ],
        })}
      />,
    );

    const card = screen
      .getByRole("button", { name: "Confirm Link" })
      .closest("div.rounded-card") as HTMLElement;
    expect(within(card).getByText("Inactive")).toBeTruthy();
  });

  it("renders no confirmation control at all for Miramar Bliss, even when it appears in the live report with real OwnerRez candidates", () => {
    render(
      <OwnerRezConfirmLinkPanel
        report={makeReport({
          unmatchedStayWhile: [
            {
              id: "miramar-bliss-uuid",
              name: "Miramar Bliss",
              internalCode: "MIRAMAR-BLISS",
              ownerRezPropertyId: null,
            },
          ],
          unmatchedOwnerRez: [
            { id: 389173, name: "Miramar Bliss", key: "mb-1", active: false },
            {
              id: 410682,
              name: "Miramar Bliss II",
              key: "mb-2",
              active: false,
            },
            {
              id: 480401,
              name: "Miramar-Bliss",
              key: "mb-3",
              active: true,
            },
          ],
        })}
      />,
    );

    expect(screen.queryByText(/Miramar/)).toBeNull();
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders 'Linked' with no Confirm control for an approved property already linked", () => {
    render(
      <OwnerRezConfirmLinkPanel
        report={makeReport({
          alreadyLinked: [
            {
              property: { ...AQUA_PALM_SW, ownerRezPropertyId: "386471" },
              ownerRezProperty: AQUA_PALM_OR,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Linked")).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  });

  it("renders 'Not available' with no Confirm control for an approved property the live report doesn't currently surface on either side", () => {
    render(<OwnerRezConfirmLinkPanel report={makeReport()} />);

    // All six approved entries render, none linkable without live data for
    // both sides.
    expect(screen.getAllByText("Not available")).toHaveLength(6);
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders one row for each of the six approved properties, and only six", () => {
    render(<OwnerRezConfirmLinkPanel report={makeReport()} />);

    for (const code of [
      "AQUA-PALM",
      "BAHAMAS",
      "BONJOUR-AMI",
      "ISLAND-TIDES",
      "OCEAN-PEARL",
      "SANDY-NUDES",
    ]) {
      expect(screen.getAllByText(new RegExp(code)).length).toBeGreaterThan(0);
    }
    expect(document.querySelectorAll("div.rounded-card")).toHaveLength(6);
  });
});
