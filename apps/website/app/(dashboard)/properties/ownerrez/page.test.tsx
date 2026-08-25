// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
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

import OwnerRezMatchReportPage from "./page";

afterEach(cleanup);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("OwnerRezMatchReportPage (read-only Production preview) — source-level wiring proof", () => {
  const code = codeOnly(readFileSync(path.join(__dirname, "page.tsx"), "utf8"));

  it("imports and renders OwnerRezMatchReportPreview", () => {
    expect(code).toMatch(/OwnerRezMatchReportPreview/);
    expect(code).toMatch(/<OwnerRezMatchReportPreview/);
  });

  it("does not import OwnerRezMatchReview or the field-change-preview OwnerRezMatchPreview component", () => {
    expect(code).not.toMatch(/OwnerRezMatchReview/);
    expect(code).not.toMatch(/OwnerRezMatchPreview\b/);
  });

  it("does not import any property write actions or the actions module", () => {
    expect(code).not.toMatch(/confirmOwnerRezPropertyMatchAction/);
    expect(code).not.toMatch(/applyOwnerRezPropertyChangesAction/);
    expect(code).not.toMatch(/createPropertyFromOwnerRezAction/);
    expect(code).not.toMatch(/from ["'].*\/actions["']/);
  });

  it("does not import any write-capable service function", () => {
    expect(code).not.toMatch(/confirmOwnerRezPropertyMatch\b/);
    expect(code).not.toMatch(/applyOwnerRezPropertyChanges\b/);
    expect(code).not.toMatch(/createPropertyFromOwnerRez\b/);
    expect(code).not.toMatch(/previewOwnerRezPropertyChanges/);
  });

  it("does not import getProperty (the OwnerRez detail endpoint, not needed for the match report)", () => {
    expect(code).not.toMatch(/getProperty/);
  });

  it("does not import ConfirmButton, DialogTrigger, or CreatePropertyFromOwnerRezForm", () => {
    expect(code).not.toMatch(/ConfirmButton/);
    expect(code).not.toMatch(/DialogTrigger/);
    expect(code).not.toMatch(/CreatePropertyFromOwnerRezForm/);
  });

  it("calls only matchOwnerRezProperties, the read-only match-report function", () => {
    expect(code).toMatch(/matchOwnerRezProperties/);
  });
});

describe("OwnerRezMatchReportPage (read-only Production preview) — rendered output", () => {
  it("renders the real match report with active/inactive badges, no invented status on Unmatched StayWhile, and no write UI anywhere", async () => {
    mockMatchOwnerRezProperties.mockResolvedValueOnce({
      configured: true,
      report: {
        alreadyLinked: [
          {
            property: {
              id: "p1",
              name: "Ocean Pearl",
              internalCode: "OCEAN-PEARL",
            },
            ownerRezProperty: {
              id: 1,
              name: "Ocean Pearl",
              key: "ocean-pearl",
              active: true,
            },
          },
        ],
        proposedMatches: [
          {
            property: { id: "p2", name: "Bahamas", internalCode: "BAHAMAS" },
            ownerRezProperty: {
              id: 2,
              name: "Bahamas",
              key: "bahamas",
              active: false,
              internal_code: "BAHAMAS",
            },
          },
        ],
        unmatchedOwnerRez: [
          { id: 3, name: "Old Cabin", key: "old-cabin", active: false },
        ],
        unmatchedStayWhile: [
          { id: "p3", name: "Solo Property", internalCode: "SOLO" },
        ],
      },
    });

    const jsx = await OwnerRezMatchReportPage();
    render(jsx);

    expect(screen.getAllByText("Active")).toHaveLength(1);
    expect(screen.getAllByText("Inactive")).toHaveLength(2);
    expect(screen.getByText("Solo Property (SOLO)")).toBeTruthy();

    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
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
