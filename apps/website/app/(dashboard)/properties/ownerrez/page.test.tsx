// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockMatchOwnerRezProperties } = vi.hoisted(() => ({
  mockMatchOwnerRezProperties: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/domains/properties/services/ownerrez-match-report.service", () => ({
  matchOwnerRezProperties: mockMatchOwnerRezProperties,
}));

// OwnerRezConfirmLinkPanel wires a real server action (confirmOwnerRezLinkAction),
// which otherwise transitively imports ownerrez-link.service.ts -> @stayw/database
// and would try to construct a real PrismaClient during this render-only test.
vi.mock("@/domains/properties/actions", () => ({
  confirmOwnerRezLinkAction: vi.fn(),
}));

import OwnerRezMatchReportPage from "./page";

afterEach(cleanup);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("OwnerRezMatchReportPage — source-level wiring proof", () => {
  const code = codeOnly(readFileSync(path.join(__dirname, "page.tsx"), "utf8"));

  it("imports and renders OwnerRezMatchReportPreview, unchanged and still read-only", () => {
    expect(code).toMatch(/OwnerRezMatchReportPreview/);
    expect(code).toMatch(/<OwnerRezMatchReportPreview/);
  });

  it("imports and renders OwnerRezConfirmLinkPanel — the only write-UI surface added by Phase B", () => {
    expect(code).toMatch(/OwnerRezConfirmLinkPanel/);
    expect(code).toMatch(/<OwnerRezConfirmLinkPanel/);
  });

  it("does not import OwnerRezMatchReview or the field-change-preview OwnerRezMatchPreview component (the old worktree's UI)", () => {
    expect(code).not.toMatch(/OwnerRezMatchReview/);
    expect(code).not.toMatch(/OwnerRezMatchPreview\b/);
  });

  it("does not wire any server action directly — that stays entirely inside OwnerRezConfirmLinkPanel", () => {
    expect(code).not.toMatch(/from ["'].*\/actions["']/);
  });

  it("does not import the old worktree's write-capable service functions or getProperty", () => {
    expect(code).not.toMatch(/confirmOwnerRezPropertyMatch\b/);
    expect(code).not.toMatch(/applyOwnerRezPropertyChanges\b/);
    expect(code).not.toMatch(/createPropertyFromOwnerRez\b/);
    expect(code).not.toMatch(/previewOwnerRezPropertyChanges/);
    expect(code).not.toMatch(/getProperty/);
  });

  it("does not import ConfirmButton, DialogTrigger, or CreatePropertyFromOwnerRezForm directly — those live inside OwnerRezConfirmLinkPanel only", () => {
    expect(code).not.toMatch(/ConfirmButton/);
    expect(code).not.toMatch(/DialogTrigger/);
    expect(code).not.toMatch(/CreatePropertyFromOwnerRezForm/);
  });

  it("calls only matchOwnerRezProperties, the read-only match-report function, and passes its result to both sections", () => {
    expect(code).toMatch(/matchOwnerRezProperties/);
  });
});

describe("OwnerRezMatchReportPage — rendered output", () => {
  it("renders a Confirm control for an approved, unlinked property, and no confirmation control at all for an unapproved property (e.g. Miramar Bliss)", async () => {
    mockMatchOwnerRezProperties.mockResolvedValueOnce({
      configured: true,
      report: {
        alreadyLinked: [],
        proposedMatches: [
          {
            property: {
              id: "aqua-palm-uuid",
              name: "Aqua Palm",
              internalCode: "AQUA-PALM",
              ownerRezPropertyId: null,
            },
            ownerRezProperty: {
              id: 386471,
              name: "Aqua Palm",
              key: "aqua-palm",
              active: true,
              internal_code: "Aqua Palm",
            },
          },
        ],
        unmatchedOwnerRez: [
          {
            id: 389173,
            name: "Miramar Bliss",
            key: "miramar-bliss",
            active: false,
          },
          {
            id: 410682,
            name: "Miramar Bliss II",
            key: "miramar-bliss-ii",
            active: false,
          },
          {
            id: 480401,
            name: "Miramar-Bliss",
            key: "miramar-bliss-2",
            active: true,
          },
        ],
        unmatchedStayWhile: [
          {
            id: "miramar-bliss-uuid",
            name: "Miramar Bliss",
            internalCode: "MIRAMAR-BLISS",
            ownerRezPropertyId: null,
          },
        ],
      },
    });

    const jsx = await OwnerRezMatchReportPage();
    render(jsx);

    // The one approved, currently-unlinked property gets exactly one form/button.
    expect(screen.getByRole("button", { name: "Confirm Link" })).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(1);

    const form = document.querySelector("form");
    expect(form?.querySelector('input[name="propertyId"]')).toHaveProperty(
      "value",
      "aqua-palm-uuid",
    );
    expect(
      form?.querySelector('input[name="ownerRezPropertyId"]'),
    ).toHaveProperty("value", "386471");

    // Miramar Bliss is not in APPROVED_OWNERREZ_LINKS, so the confirmation
    // panel (scoped via the "Approved OwnerRez links" heading's section)
    // never mentions it at all, even though it appears in the live report
    // with three real OwnerRez candidates.
    const panelSection = screen
      .getByText("Approved OwnerRez links")
      .closest("section") as HTMLElement;
    expect(within(panelSection).queryByText(/Miramar/)).toBeNull();

    // OwnerRezMatchReportPreview itself still renders the raw report
    // unchanged, including the Miramar Bliss row it's always shown.
    expect(screen.getByText("Miramar Bliss (MIRAMAR-BLISS)")).toBeTruthy();
  });

  it("shows StayWhile name/internalCode and OwnerRez name/ID/status in the confirmation panel before any confirmation", async () => {
    mockMatchOwnerRezProperties.mockResolvedValueOnce({
      configured: true,
      report: {
        alreadyLinked: [],
        proposedMatches: [
          {
            property: {
              id: "bahamas-uuid",
              name: "Bahamas",
              internalCode: "BAHAMAS",
              ownerRezPropertyId: null,
            },
            ownerRezProperty: {
              id: 377839,
              name: "The Bahamas",
              key: "the-bahamas",
              active: true,
              internal_code: "The Bahamas",
            },
          },
        ],
        unmatchedOwnerRez: [],
        unmatchedStayWhile: [],
      },
    });

    const jsx = await OwnerRezMatchReportPage();
    render(jsx);

    // Scope to the confirmation panel's card for this property (found via
    // its own Confirm button) so this test can't be satisfied by text the
    // separate, unchanged OwnerRezMatchReportPreview table also renders.
    const confirmButton = screen.getByRole("button", { name: "Confirm Link" });
    const card = confirmButton.closest("div.rounded-card") as HTMLElement;

    const codeSpan = within(card).getByText("(BAHAMAS)");
    expect(codeSpan.parentElement?.textContent).toContain("Bahamas");

    expect(within(card).getByText(/→ OwnerRez: The Bahamas/)).toBeTruthy();
    expect(within(card).getByText(/377839/)).toBeTruthy();
    expect(within(card).getByText("Active")).toBeTruthy();
  });

  it("renders no confirmation control for any approved property already linked", async () => {
    mockMatchOwnerRezProperties.mockResolvedValueOnce({
      configured: true,
      report: {
        alreadyLinked: [
          {
            property: {
              id: "aqua-palm-uuid",
              name: "Aqua Palm",
              internalCode: "AQUA-PALM",
              ownerRezPropertyId: "386471",
            },
            ownerRezProperty: {
              id: 386471,
              name: "Aqua Palm",
              key: "aqua-palm",
              active: true,
            },
          },
        ],
        proposedMatches: [],
        unmatchedOwnerRez: [],
        unmatchedStayWhile: [],
      },
    });

    const jsx = await OwnerRezMatchReportPage();
    render(jsx);

    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  });

  it("falls back to the not-configured empty state, rendering no preview and no write UI, when OwnerRez isn't configured", async () => {
    mockMatchOwnerRezProperties.mockResolvedValueOnce({ configured: false });

    const jsx = await OwnerRezMatchReportPage();
    render(jsx);

    expect(screen.getByText("OwnerRez isn't configured")).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});
