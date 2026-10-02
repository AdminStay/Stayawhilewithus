// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ReservationPagination,
  ReservationViewControls,
} from "./ReservationViewControls";

afterEach(cleanup);

const EAST = "11111111-1111-4111-8111-111111111111";
const counts = {
  today: 3,
  "in-house": 7,
  "this-week": 12,
  upcoming: 410,
  all: 852,
};
const base = {
  view: "today" as const,
  propertyId: null,
  includeCancelled: false,
  page: 1,
};

describe("ReservationViewControls (2026-09-29)", () => {
  it("shows the five Meeting #6 tabs with their counts, the current one marked — and no 'New bookings' view", () => {
    render(
      <ReservationViewControls params={base} counts={counts} properties={[]} />,
    );
    const nav = screen.getByRole("navigation", { name: "Reservation views" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Today (3)",
      "In-house (7)",
      "This week (12)",
      "Upcoming (410)",
      "All (852)",
    ]);
    expect(within(nav).getByRole("link", { name: "Today (3)" })).toHaveProperty(
      "ariaCurrent",
      "page",
    );
    expect(screen.queryByText(/new booking/i)).toBeNull();
  });

  it("view links keep the property and cancelled filters and reset to page 1", () => {
    render(
      <ReservationViewControls
        params={{ ...base, propertyId: EAST, includeCancelled: true, page: 4 }}
        counts={counts}
        properties={[{ id: EAST, name: "Aqua Palm" }]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "This week (12)" }).getAttribute("href"),
    ).toBe(`/reservations?view=this-week&property=${EAST}&cancelled=1`);
  });

  it("the filter form submits view, property and 'Show cancelled' (off by default) with GET", () => {
    const { container } = render(
      <ReservationViewControls
        params={base}
        counts={counts}
        properties={[{ id: EAST, name: "Aqua Palm" }]}
      />,
    );
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/reservations");
    expect(
      (form.querySelector('input[name="view"]') as HTMLInputElement).value,
    ).toBe("today");
    const select = screen.getByLabelText(
      "Filter by property",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "All properties",
      "Aqua Palm",
    ]);
    expect(select.value).toBe("");
    const cancelled = screen.getByLabelText(
      "Show cancelled",
    ) as HTMLInputElement;
    expect(cancelled.checked).toBe(false);
    expect(cancelled.value).toBe("1");
  });

  it("the form reflects active filters", () => {
    render(
      <ReservationViewControls
        params={{ ...base, propertyId: EAST, includeCancelled: true }}
        counts={counts}
        properties={[{ id: EAST, name: "Aqua Palm" }]}
      />,
    );
    expect(
      (screen.getByLabelText("Filter by property") as HTMLSelectElement).value,
    ).toBe(EAST);
    expect(
      (screen.getByLabelText("Show cancelled") as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("ReservationPagination", () => {
  const all = { ...base, view: "all" as const };

  it("renders nothing for a single page", () => {
    const { container } = render(
      <ReservationPagination
        params={all}
        page={1}
        pageCount={1}
        pageSize={50}
        total={12}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("first page: range, Next only", () => {
    render(
      <ReservationPagination
        params={all}
        page={1}
        pageCount={18}
        pageSize={50}
        total={852}
      />,
    );
    expect(screen.getByText("Showing 1–50 of 852")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href"),
    ).toBe("/reservations?view=all&page=2");
  });

  it("last page: partial range, Previous only", () => {
    render(
      <ReservationPagination
        params={{ ...all, page: 18 }}
        page={18}
        pageCount={18}
        pageSize={50}
        total={852}
      />,
    );
    expect(screen.getByText("Showing 851–852 of 852")).toBeTruthy();
    expect(screen.getByText("Page 18 of 18")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Previous" }).getAttribute("href"),
    ).toBe("/reservations?view=all&page=17");
  });
});
