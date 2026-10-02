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
});
