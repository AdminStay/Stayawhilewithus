// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnmatchedOwnerRezSummary } from "../services/ownerrez-onboarding.service";

import { CopyActiveOwnerRezCsvButton } from "./CopyActiveOwnerRezCsvButton";

afterEach(cleanup);

function makeSummary(
  overrides: Partial<UnmatchedOwnerRezSummary["ownerRezProperty"]> = {},
  detail: UnmatchedOwnerRezSummary["detail"] = null,
): UnmatchedOwnerRezSummary {
  return {
    ownerRezProperty: {
      id: 480307,
      name: "Camingo",
      key: "camingo",
      active: true,
      ...overrides,
    },
    detail,
  };
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

async function clickCopy() {
  fireEvent.click(screen.getByRole("button", { name: "Copy Active as CSV" }));
  // navigator.clipboard.writeText is awaited inside the click handler.
  await Promise.resolve();
  await Promise.resolve();
}

describe("CopyActiveOwnerRezCsvButton", () => {
  it("copies a CSV with the exact 5 required columns, in order, as the header row", async () => {
    render(<CopyActiveOwnerRezCsvButton active={[makeSummary()]} />);

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [header] = csv.split("\n");
    expect(header).toBe("OwnerRez ID,Name,Internal Code,Address,Active");
  });

  it("renders a data row with id, name, internal code, formatted address, and Yes for an active property with full detail", async () => {
    render(
      <CopyActiveOwnerRezCsvButton
        active={[
          makeSummary(
            { id: 431354, name: "Ocean Pearl", internal_code: "OCEAN-PEARL" },
            {
              id: 431354,
              name: "Ocean Pearl",
              key: "ocean-pearl",
              active: true,
              address: {
                street1: "2330 Kings Point Dr",
                city: "Largo",
                state: "FL",
                postal_code: "33774",
                country: "US",
              },
            },
          ),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [, row] = csv.split("\n");
    expect(row).toBe(
      '431354,Ocean Pearl,OCEAN-PEARL,"2330 Kings Point Dr, Largo, FL, 33774, US",Yes',
    );
  });

  it("renders an empty internal code and 'Address unavailable' when detail is null", async () => {
    render(
      <CopyActiveOwnerRezCsvButton
        active={[makeSummary({ internal_code: undefined }, null)]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [, row] = csv.split("\n");
    expect(row).toBe("480307,Camingo,,Address unavailable,Yes");
  });

  it("never includes latitude, longitude, bedrooms, or any other detail field beyond the address", async () => {
    render(
      <CopyActiveOwnerRezCsvButton
        active={[
          makeSummary(
            {},
            {
              id: 480307,
              name: "Camingo",
              key: "camingo",
              active: true,
              address: { city: "Largo" },
              latitude: 27.9095,
              longitude: -82.7873,
              bedrooms: 4,
              bathrooms_full: 3,
              max_guests: 8,
              time_zone: "America/New_York",
            },
          ),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).not.toContain("27.9095");
    expect(csv).not.toContain("-82.7873");
    expect(csv).not.toContain("America/New_York");
  });

  it("wraps a value containing a comma in quotes", async () => {
    render(
      <CopyActiveOwnerRezCsvButton
        active={[makeSummary({ name: "Camingo, Unit 2" })]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).toContain('"Camingo, Unit 2"');
  });

  it("wraps and doubles internal quotes for a value containing a double quote", async () => {
    render(
      <CopyActiveOwnerRezCsvButton
        active={[makeSummary({ name: 'Camingo "Villa"' })]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).toContain('"Camingo ""Villa"""');
  });

  it("shows a Copied confirmation after a successful copy", async () => {
    render(<CopyActiveOwnerRezCsvButton active={[makeSummary()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active as CSV" }));

    expect(await screen.findByText("Copied.")).toBeTruthy();
  });

  it("shows a failure message when the clipboard write rejects, without throwing", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<CopyActiveOwnerRezCsvButton active={[makeSummary()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Active as CSV" }));

    expect(
      await screen.findByText(
        "Couldn't copy — try selecting the table instead.",
      ),
    ).toBeTruthy();
  });

  it("produces a header-only CSV for an empty active list, without erroring", async () => {
    render(<CopyActiveOwnerRezCsvButton active={[]} />);

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv.split("\n")).toHaveLength(1);
  });
});
