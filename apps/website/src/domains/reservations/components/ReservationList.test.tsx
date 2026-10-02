// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ updateReservationStatusAction: vi.fn() }));

import { ReservationList } from "./ReservationList";

afterEach(cleanup);

const row = (status: string, source = "DIRECT") => ({
  id: `r-${status}-${source}`,
  status,
  source,
  checkInDate: new Date("2026-09-29T00:00:00.000Z"),
  checkOutDate: new Date("2026-10-02T00:00:00.000Z"),
  property: { name: "Aqua Palm" },
  primaryGuest: { firstName: "Test", lastName: "Guest" },
});

describe("ReservationList", () => {
  it("keeps its original empty state by default", () => {
    render(<ReservationList reservations={[]} />);
    expect(screen.getByText("No reservations yet")).toBeTruthy();
    expect(
      screen.getByText("Create your first reservation to get started."),
    ).toBeTruthy();
  });

  it("uses view-specific empty-state copy when given (2026-09-29)", () => {
    render(
      <ReservationList
        reservations={[]}
        emptyTitle="Arrivals today"
        emptyDescription="No arrivals today."
      />,
    );
    expect(screen.getByText("Arrivals today")).toBeTruthy();
    expect(screen.getByText("No arrivals today.")).toBeTruthy();
  });

  it("existing rows are unchanged: cancelled shows a badge, others keep the status form", () => {
    render(
      <ReservationList
        reservations={[row("CONFIRMED"), row("CANCELLED")] as never}
      />,
    );
    expect(screen.getAllByText("Aqua Palm")).toHaveLength(2);
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(1);
  });

  it("OWNERREZ rows are read-only: 'Managed in OwnerRez' + status badge, no status form (2026-10-02)", () => {
    const { container } = render(
      <ReservationList
        reservations={[row("CONFIRMED", "OWNERREZ")] as never}
      />,
    );
    expect(screen.getByText("Managed in OwnerRez")).toBeTruthy();
    expect(screen.getByText("CONFIRMED")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('select[name="status"]')).toBeNull();
  });

  it("DIRECT (manual) rows keep the status form; a mixed list only has forms on DIRECT rows", () => {
    const { container } = render(
      <ReservationList
        reservations={
          [
            row("CONFIRMED", "DIRECT"),
            row("PENDING", "OWNERREZ"),
            row("CHECKED_IN", "DIRECT"),
          ] as never
        }
      />,
    );
    expect(screen.getAllByRole("button", { name: "Update" })).toHaveLength(2);
    expect(container.querySelectorAll("form")).toHaveLength(2);
    expect(screen.getAllByText("Managed in OwnerRez")).toHaveLength(1);
  });

  it("a cancelled OWNERREZ row still shows just the Cancelled badge", () => {
    render(
      <ReservationList
        reservations={[row("CANCELLED", "OWNERREZ")] as never}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Managed in OwnerRez")).toBeNull();
  });

  describe("Open in OwnerRez links (2026-10-03)", () => {
    const ownerRezRow = {
      ...row("CONFIRMED", "OWNERREZ"),
      externalReservationId: "19458918",
      property: { name: "Miramar Bliss", ownerRezPropertyId: "386471" },
    };

    it("an OwnerRez booking links to its booking in OwnerRez, and its property to the property", () => {
      render(<ReservationList reservations={[ownerRezRow] as never} />);
      const booking = screen.getByRole("link", {
        name: "Open this booking in OwnerRez",
      });
      expect(booking.getAttribute("href")).toBe(
        "https://secure.ownerreservations.com/bookings/19458918",
      );
      expect(booking.getAttribute("target")).toBe("_blank");
      expect(booking.getAttribute("rel")).toBe("noopener noreferrer");
      expect(
        screen
          .getByRole("link", { name: "Open Miramar Bliss in OwnerRez" })
          .getAttribute("href"),
      ).toBe("https://app.ownerrez.com/properties/386471/info");
    });

    it("a DIRECT reservation gets no booking link; an unlinked property gets no property link", () => {
      render(
        <ReservationList
          reservations={
            [
              {
                ...row("CONFIRMED", "DIRECT"),
                externalReservationId: "3f6c2b1e-8d4a-4c6e-9f2a-1b2c3d4e5f60",
                property: { name: "Manual Place", ownerRezPropertyId: null },
              },
            ] as never
          }
        />,
      );
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });
  });
});
