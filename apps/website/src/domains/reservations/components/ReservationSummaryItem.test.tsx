// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReservationSummaryItem } from "./ReservationSummaryItem";

afterEach(cleanup);

const base = {
  status: "CONFIRMED",
  source: "OWNERREZ",
  externalReservationId: "123456",
  checkInDate: new Date("2026-10-06T00:00:00.000Z"),
  checkOutDate: new Date("2026-10-09T00:00:00.000Z"),
  property: { name: "Harbor House" },
  primaryGuest: { firstName: "Jane", lastName: "Doe" },
};

function renderItem(overrides: Partial<typeof base> = {}) {
  return render(
    <ul>
      <ReservationSummaryItem reservation={{ ...base, ...overrides }} />
    </ul>,
  );
}

describe("ReservationSummaryItem (Phase 6)", () => {
  it("shows property, guest, nights and status", () => {
    renderItem();

    expect(screen.getByText("Harbor House")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("3 nights")).toBeTruthy();
    expect(screen.getByText("CONFIRMED")).toBeTruthy();
  });

  it("links an OwnerRez booking to OwnerRez, in a new tab", () => {
    renderItem();

    const link = screen.getByRole("link", {
      name: "Open this booking in OwnerRez",
    });
    expect(link.getAttribute("href")).toBe(
      "https://secure.ownerreservations.com/bookings/123456",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows no OwnerRez link for a non-OwnerRez (direct) booking", () => {
    renderItem({ source: "DIRECT", externalReservationId: "some-uuid" });

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is display only — no status control, form or button (OwnerRez stays read-only)", () => {
    const { container } = renderItem({ source: "DIRECT" });

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it.each(["CHECKED_IN", "PENDING"])("shows status %s", (status) => {
    renderItem({ status });
    expect(screen.getByText(status)).toBeTruthy();
  });

  it("falls back gracefully when guest or property is missing", () => {
    renderItem({ primaryGuest: null as never, property: null as never });

    expect(screen.getByText("Guest")).toBeTruthy();
    expect(screen.getByText("Property")).toBeTruthy();
  });
});
