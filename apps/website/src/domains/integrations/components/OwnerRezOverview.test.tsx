// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OwnerRezOverview } from "./OwnerRezOverview";

afterEach(cleanup);

const booking = (id: number, propertyId: number) => ({
  id,
  property_id: propertyId,
  guest_id: 1,
  status: "active",
  arrival: "2026-10-03",
  departure: "2026-10-06",
  adults: 2,
  children: 0,
  total_amount: 0,
  created_utc: "",
  updated_utc: "",
});

describe("OwnerRezOverview — property names, not numbers (2026-10-02)", () => {
  it("shows each booking's property by OwnerRez's own name, matched by id; unknown ids stay labelled by number", () => {
    render(
      <OwnerRezOverview
        properties={{
          configured: true,
          ok: true,
          items: [
            { id: 480401, name: "Miramar Bliss", key: "k", active: true },
          ],
        }}
        bookings={{
          configured: true,
          ok: true,
          items: [booking(16148058, 480401), booking(17031650, 389173)],
        }}
      />,
    );
    const linkedRow = screen.getByText("#16148058").closest("tr")!;
    expect(within(linkedRow).getByText("Miramar Bliss")).toBeTruthy();
    expect(within(linkedRow).queryByText("480401")).toBeNull();
    const unknownRow = screen.getByText("#17031650").closest("tr")!;
    expect(
      within(unknownRow).getByText("OwnerRez property #389173"),
    ).toBeTruthy();
  });

  it("links bookings and properties to OwnerRez with the real URL patterns (2026-10-03)", () => {
    render(
      <OwnerRezOverview
        properties={{
          configured: true,
          ok: true,
          items: [
            { id: 386471, name: "Miramar Bliss", key: "k", active: true },
          ],
        }}
        bookings={{
          configured: true,
          ok: true,
          items: [booking(19458918, 386471)],
        }}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Open booking #19458918 in OwnerRez" })
        .getAttribute("href"),
    ).toBe("https://secure.ownerreservations.com/bookings/19458918");
    expect(
      screen
        .getByRole("link", { name: "Open Miramar Bliss in OwnerRez" })
        .getAttribute("href"),
    ).toBe("https://app.ownerrez.com/properties/386471/info");
    expect(
      screen
        .getByRole("link", { name: "Open this property in OwnerRez" })
        .getAttribute("href"),
    ).toBe("https://app.ownerrez.com/properties/386471/info");
  });
});
