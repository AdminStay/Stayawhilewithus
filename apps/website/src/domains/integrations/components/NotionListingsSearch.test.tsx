// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  IntegrationHighlights,
  NotionListingWithRegion,
} from "../services/integrations.service";
import { NotionListingsSearch } from "./NotionListingsSearch";

afterEach(cleanup);

function listing(
  overrides: Partial<NotionListingWithRegion>,
): NotionListingWithRegion {
  return {
    id: "1",
    url: "https://notion.so/1",
    name: "Moonlit Cove",
    address: "123 Main St",
    bedrooms: 3,
    bathrooms: 2,
    guests: 6,
    directBooking: null,
    airbnbLink: null,
    vrboLink: null,
    googleDrivePhotosUrl: null,
    guidebookUrl: null,
    region: "SRQ",
    ...overrides,
  };
}

function highlights(
  items: NotionListingWithRegion[],
): IntegrationHighlights<NotionListingWithRegion> {
  return { configured: true, ok: true, items };
}

describe("NotionListingsSearch", () => {
  it("shows the full listing set immediately with all filters blank", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", name: "Moonlit Cove" }),
          listing({ id: "2", name: "Bird of Paradise", region: "Destin" }),
        ])}
      />,
    );

    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.getByText("Bird of Paradise")).toBeTruthy();
    expect(screen.getByText("2 of 2 listings")).toBeTruthy();
  });

  it("filters by name", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", name: "Moonlit Cove" }),
          listing({ id: "2", name: "Bird of Paradise", region: "Destin" }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search by property name"), {
      target: { value: "moonlit" },
    });

    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.queryByText("Bird of Paradise")).toBeNull();
    expect(screen.getByText("1 of 2 listings")).toBeTruthy();
  });

  it("filters by keyword against Address, not against link fields", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", name: "Moonlit Cove", address: "42 Ocean Ave" }),
          listing({
            id: "2",
            name: "Bird of Paradise",
            region: "Destin",
            address: "9 Palm Rd",
            airbnbLink: "https://airbnb.com/ocean-listing",
          }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Keyword search"), {
      target: { value: "ocean" },
    });

    // Matches listing 1 via its Address ("42 Ocean Ave"); must not match
    // listing 2 just because its Airbnb link contains "ocean".
    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.queryByText("Bird of Paradise")).toBeNull();
  });

  it("includes non-URL Direct booking text in keyword matching, but not a URL value", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({
            id: "1",
            name: "Moonlit Cove",
            directBooking: "Text the owner directly",
          }),
          listing({
            id: "2",
            name: "Bird of Paradise",
            region: "Destin",
            directBooking: "https://directbooking.example/owner",
          }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Keyword search"), {
      target: { value: "directly" },
    });

    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.queryByText("Bird of Paradise")).toBeNull();
  });

  it("filters by region, including Unknown / Unassigned", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", name: "Moonlit Cove", region: "SRQ" }),
          listing({
            id: "2",
            name: "Some Unmapped Property",
            region: "Unknown / Unassigned",
          }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter by region"), {
      target: { value: "Unknown / Unassigned" },
    });

    expect(screen.getByText("Some Unmapped Property")).toBeTruthy();
    expect(screen.queryByText("Moonlit Cove")).toBeNull();
  });

  it("combines name, keyword, and region filters with AND semantics", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({
            id: "1",
            name: "Moonlit Cove",
            region: "SRQ",
            address: "1 Ocean Ave",
          }),
          listing({
            id: "2",
            name: "Moonlit Bay",
            region: "Destin",
            address: "2 Ocean Ave",
          }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search by property name"), {
      target: { value: "moonlit" },
    });
    fireEvent.change(screen.getByLabelText("Keyword search"), {
      target: { value: "ocean" },
    });
    fireEvent.change(screen.getByLabelText("Filter by region"), {
      target: { value: "SRQ" },
    });

    expect(screen.getByText("Moonlit Cove")).toBeTruthy();
    expect(screen.queryByText("Moonlit Bay")).toBeNull();
    expect(screen.getByText("1 of 2 listings")).toBeTruthy();
  });

  it("reset restores the full unfiltered list", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", name: "Moonlit Cove" }),
          listing({ id: "2", name: "Bird of Paradise", region: "Destin" }),
        ])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search by property name"), {
      target: { value: "moonlit" },
    });
    expect(screen.getByText("1 of 2 listings")).toBeTruthy();

    fireEvent.click(screen.getByText("Reset"));

    expect(screen.getByText("2 of 2 listings")).toBeTruthy();
    expect(screen.getByText("Bird of Paradise")).toBeTruthy();
  });

  it("shows an empty state when no listing matches the current filters", () => {
    render(
      <NotionListingsSearch listings={highlights([listing({ id: "1" })])} />,
    );

    fireEvent.change(screen.getByLabelText("Search by property name"), {
      target: { value: "no such listing" },
    });

    expect(screen.getByText("No listings match your filters")).toBeTruthy();
  });

  it("renders a valid URL as a link with target=_blank and rel=noopener noreferrer", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", airbnbLink: "https://airbnb.com/rooms/123" }),
        ])}
      />,
    );

    const link = screen.getByRole("link", { name: "Airbnb" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://airbnb.com/rooms/123");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a non-URL value as plain text, never as a link", () => {
    render(
      <NotionListingsSearch
        listings={highlights([
          listing({ id: "1", directBooking: "Call the owner at 555-0100" }),
        ])}
      />,
    );

    expect(screen.getByText("Call the owner at 555-0100")).toBeTruthy();
    expect(screen.queryByText("Book")).toBeNull();
  });

  it("shows the not-connected message when Notion isn't configured", () => {
    render(<NotionListingsSearch listings={{ configured: false }} />);

    expect(screen.getByText(/Not connected/)).toBeTruthy();
  });

  it("shows a failed read-access status, never a stale success message, when the live query fails", () => {
    render(
      <NotionListingsSearch
        listings={{ configured: true, ok: false, error: "network error" }}
      />,
    );

    expect(screen.getByText(/Read access failed — network error/)).toBeTruthy();
    expect(screen.queryByText("Read access verified")).toBeNull();
  });

  it("renders zero listings without crashing", () => {
    render(<NotionListingsSearch listings={highlights([])} />);

    expect(screen.getByText("0 of 0 listings")).toBeTruthy();
  });

  it("contains no write/mutation affordance anywhere in the rendered output", () => {
    const { container } = render(
      <NotionListingsSearch listings={highlights([listing({ id: "1" })])} />,
    );

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1); // Reset only
    expect(screen.getByText("Reset")).toBeTruthy();
    expect(screen.queryByText(/edit/i)).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByText(/save/i)).toBeNull();
  });
});
