// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ updateReservationStatusAction: vi.fn() }));

import { ReservationList } from "./ReservationList";

afterEach(cleanup);

const row = (status: string) => ({
  id: `r-${status}`,
  status,
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
});
