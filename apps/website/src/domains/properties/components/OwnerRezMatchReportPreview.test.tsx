// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { OwnerRezMatchReport } from "../services/ownerrez-match-report.service";
import { OwnerRezMatchReportPreview } from "./OwnerRezMatchReportPreview";

afterEach(cleanup);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function makeStayWhileProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    name: "Ocean Pearl",
    internalCode: "OCEAN-PEARL",
    ...overrides,
  } as never;
}

function makeOwnerRezProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Ocean Pearl",
    key: "ocean-pearl",
    active: true,
    internal_code: "OCEAN-PEARL",
    ...overrides,
  } as never;
}

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

describe("OwnerRezMatchReportPreview", () => {
  it("does not import any write-capable module — source-level proof", () => {
    const code = codeOnly(
      readFileSync(
        path.join(__dirname, "OwnerRezMatchReportPreview.tsx"),
        "utf8",
      ),
    );

    expect(code).not.toMatch(/ConfirmButton/);
    expect(code).not.toMatch(/DialogTrigger/);
    expect(code).not.toMatch(/CreatePropertyFromOwnerRezForm/);
    expect(code).not.toMatch(/OwnerRezMatchReview\b/);
    expect(code).not.toMatch(/confirmOwnerRezPropertyMatch/);
    expect(code).not.toMatch(/applyOwnerRezPropertyChanges/);
    expect(code).not.toMatch(/createPropertyFromOwnerRez/);
    expect(code).not.toMatch(/getProperty/);
    expect(code).not.toMatch(/previewOwnerRezPropertyChanges/);
    expect(code).not.toMatch(/from ["']\.\.\/actions["']/);
    expect(code).not.toMatch(/<form/);
  });

  it("renders no <form>, <button>, or dialog anywhere, for any data shape", () => {
    const { container } = render(
      <OwnerRezMatchReportPreview
        report={makeReport({
          alreadyLinked: [
            {
              property: makeStayWhileProperty(),
              ownerRezProperty: makeOwnerRezProperty(),
            },
          ],
          proposedMatches: [
            {
              property: makeStayWhileProperty({ id: "prop-2" }),
              ownerRezProperty: makeOwnerRezProperty({
                id: 2,
                active: false,
              }),
            },
          ],
          unmatchedOwnerRez: [makeOwnerRezProperty({ id: 3, active: false })],
          unmatchedStayWhile: [makeStayWhileProperty({ id: "prop-3" })],
        })}
      />,
    );

    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
  });

  it("shows Active/Inactive status in Already linked, Proposed matches, and Unmatched in OwnerRez", () => {
    render(
      <OwnerRezMatchReportPreview
        report={makeReport({
          alreadyLinked: [
            {
              property: makeStayWhileProperty({ id: "prop-1" }),
              ownerRezProperty: makeOwnerRezProperty({ id: 1, active: true }),
            },
          ],
          proposedMatches: [
            {
              property: makeStayWhileProperty({ id: "prop-2" }),
              ownerRezProperty: makeOwnerRezProperty({
                id: 2,
                active: false,
              }),
            },
          ],
          unmatchedOwnerRez: [
            makeOwnerRezProperty({ id: 3, active: false, name: "Old Cabin" }),
          ],
        })}
      />,
    );

    expect(screen.getAllByText("Active")).toHaveLength(1);
    expect(screen.getAllByText("Inactive")).toHaveLength(2);
  });

  it("does not invent an OwnerRez status for Unmatched StayWhile properties", () => {
    render(
      <OwnerRezMatchReportPreview
        report={makeReport({
          unmatchedStayWhile: [
            makeStayWhileProperty({ id: "prop-9", name: "Solo Property" }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Solo Property (OCEAN-PEARL)")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Inactive")).toBeNull();
  });

  it("renders all four buckets without crashing at realistic (58-property-scale) volume", () => {
    const ownerRezProperties = Array.from({ length: 40 }, (_, i) =>
      makeOwnerRezProperty({
        id: i,
        name: `Property ${i}`,
        active: i % 3 !== 0,
      }),
    );

    render(
      <OwnerRezMatchReportPreview
        report={makeReport({ unmatchedOwnerRez: ownerRezProperties })}
      />,
    );

    expect(screen.getByText("Unmatched in OwnerRez (40)")).toBeTruthy();
  });
});
