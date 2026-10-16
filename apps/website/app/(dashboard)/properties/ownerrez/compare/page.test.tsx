// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCompare } = vi.hoisted(() => ({ mockCompare: vi.fn() }));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

// The real service imports Prisma and the OwnerRez client; neither may be
// constructed in a render-only test.
vi.mock(
  "@/domains/properties/services/ownerrez-property-comparison.service",
  () => ({ compareLinkedOwnerRezProperties: mockCompare }),
);

import OwnerRezPropertyComparePage from "./page";

import {
  compareOwnerRezProperty,
  countComparisonStatuses,
  type OwnerRezPropertyComparisonRow,
} from "@/domains/properties/lib/ownerrez-property-comparison";

afterEach(cleanup);
beforeEach(() => mockCompare.mockReset());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FABRICATED TEST FIXTURES — not real StayWhile or OwnerRez data.
function fabricatedRow(
  n: number,
  opts: {
    status?: string;
    stayWhile?: Partial<Parameters<typeof compareOwnerRezProperty>[0]>;
    detail?: Record<string, unknown> | null;
    unavailableReason?: OwnerRezPropertyComparisonRow["unavailableReason"];
  } = {},
): OwnerRezPropertyComparisonRow {
  const detail =
    opts.detail === null
      ? null
      : {
          id: 900000 + n,
          name: `FABRICATED OwnerRez Listing ${n}`,
          key: `fabricated-${n}`,
          active: true,
          address: {
            street1: "100 Example Street",
            city: "Testville",
            state: "FL",
            postal_code: "00001",
          },
          bedrooms: 3,
          bathrooms_full: 2,
          bathrooms_half: 1,
          max_guests: 8,
          time_zone: "America/New_York",
          ...opts.detail,
        };
  const fields = compareOwnerRezProperty(
    {
      addressLine1: "100 Example Street",
      addressLine2: null,
      city: "Testville",
      state: "FL",
      postalCode: "00001",
      bedroomCount: 3,
      bathroomCount: 2.5,
      maxOccupancy: 8,
      timezone: "America/New_York",
      ...opts.stayWhile,
    },
    detail,
  );
  return {
    property: {
      id: `00000000-0000-4000-8000-00000000000${n}`,
      name: `FABRICATED Test Property ${n}`,
      internalCode: `FAB-${n}`,
      status: opts.status ?? "ACTIVE",
      ownerRezPropertyId: String(900000 + n),
    },
    ownerRezName: detail ? (detail.name as string) : null,
    unavailableReason: opts.unavailableReason ?? null,
    fields,
    counts: countComparisonStatuses(fields),
  };
}

async function renderPage() {
  render(await OwnerRezPropertyComparePage());
}

function sectionFor(n: number) {
  return screen.getByRole("region", {
    name: `FABRICATED Test Property ${n} comparison`,
  });
}

function statusCellFor(section: HTMLElement, label: string) {
  const row = within(section)
    .getAllByRole("row")
    .find((r) => r.textContent?.startsWith(label))!;
  return within(row).getAllByRole("cell").at(-1)!.textContent;
}

describe("/properties/ownerrez/compare", () => {
  it("shows a not-configured state without OwnerRez credentials", async () => {
    mockCompare.mockResolvedValueOnce({ configured: false });
    await renderPage();
    expect(screen.getByText("OwnerRez isn't configured")).toBeTruthy();
  });

  it("shows an empty state when no property is linked", async () => {
    mockCompare.mockResolvedValueOnce({
      configured: true,
      rows: [],
      rateLimited: false,
    });
    await renderPage();
    expect(screen.getByText("No linked properties")).toBeTruthy();
  });

  it("identifies each comparison by StayWhile name, internal code, status and the OwnerRez id", async () => {
    mockCompare.mockResolvedValueOnce({
      configured: true,
      rows: [fabricatedRow(1, { status: "ONBOARDING" })],
      rateLimited: false,
    });
    await renderPage();
    const section = sectionFor(1);
    expect(section.textContent).toContain("FAB-1");
    expect(section.textContent).toContain("Onboarding");
    expect(section.textContent).toContain("OwnerRez #900001");
    expect(section.textContent).toContain("FABRICATED OwnerRez Listing 1");
    const link = within(section).getByRole("link", {
      name: "Open FABRICATED Test Property 1 in OwnerRez",
    });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows all six statuses as distinct text labels", async () => {
    mockCompare.mockResolvedValueOnce({
      configured: true,
      rows: [
        fabricatedRow(1, {
          stayWhile: {
            city: "TESTVILLE", // Formatting only
            state: "Florida", // Differs (no state normalization)
            addressLine2: null, // Missing in StayWhile (OwnerRez has street2)
          },
          detail: {
            time_zone: undefined, // Missing in OwnerRez
            address: {
              street1: "100 Example Street",
              street2: "Unit 2",
              city: "Testville",
              state: "FL",
              postal_code: "00001",
            },
          },
        }),
        fabricatedRow(2, { detail: null, unavailableReason: "rate_limited" }),
      ],
      rateLimited: true,
    });
    await renderPage();

    const one = sectionFor(1);
    expect(statusCellFor(one, "Street address (line 1)")).toBe("Match");
    expect(statusCellFor(one, "City")).toBe("Formatting only");
    expect(statusCellFor(one, "State")).toBe("Differs");
    expect(statusCellFor(one, "Timezone")).toBe("Missing in OwnerRez");
    expect(statusCellFor(one, "Street address (line 2)")).toBe(
      "Missing in StayWhile",
    );

    const two = sectionFor(2);
    expect(statusCellFor(two, "City")).toBe("OwnerRez data unavailable");
    expect(two.textContent).toContain("request limit");
    // StayWhile's values are still shown for an unavailable row.
    expect(two.textContent).toContain("Testville");

    expect(screen.getByRole("status").textContent).toContain("request limit");
    const totals = screen.getByRole("list", { name: "Comparison totals" });
    for (const label of [
      "Match",
      "Formatting only",
      "Differs",
      "Missing in OwnerRez",
      "Missing in StayWhile",
      "OwnerRez data unavailable",
    ]) {
      expect(totals.textContent).toContain(`${label}:`);
    }
  });

  it("has no write controls: no buttons and no forms", async () => {
    mockCompare.mockResolvedValueOnce({
      configured: true,
      rows: [fabricatedRow(1, { stayWhile: { bedroomCount: 4 } })],
      rateLimited: false,
    });
    const { container } = render(await OwnerRezPropertyComparePage());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector("form")).toBeNull();
  });

  it("renders valid table markup: no row nested inside another row", async () => {
    mockCompare.mockResolvedValueOnce({
      configured: true,
      rows: [fabricatedRow(1)],
      rateLimited: false,
    });
    const { container } = render(await OwnerRezPropertyComparePage());
    expect(container.querySelector("tr tr")).toBeNull();
    expect(container.querySelectorAll("thead th")).toHaveLength(4);
  });
});

describe("source-level read-only proof", () => {
  function codeOnly(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }
  const files = [
    path.join(__dirname, "page.tsx"),
    path.join(
      __dirname,
      "../../../../../src/domains/properties/components/OwnerRezPropertyComparison.tsx",
    ),
    path.join(
      __dirname,
      "../../../../../src/domains/properties/services/ownerrez-property-comparison.service.ts",
    ),
    path.join(
      __dirname,
      "../../../../../src/domains/properties/lib/ownerrez-property-comparison.ts",
    ),
  ];

  it.each(files)("%s has no write path, server action or logging", (file) => {
    const code = codeOnly(readFileSync(file, "utf8"));
    expect(code).not.toMatch(
      /\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\(/,
    );
    expect(code).not.toMatch(/\$executeRaw|\$transaction|recordAudit/);
    expect(code).not.toMatch(
      /beginDeviceSync|finishDeviceSync|integrationSyncLog/,
    );
    expect(code).not.toMatch(/"use server"|actions"/);
    expect(code).not.toMatch(/console\./);
  });
});
