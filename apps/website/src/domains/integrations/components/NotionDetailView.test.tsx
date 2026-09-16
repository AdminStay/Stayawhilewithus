// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { NotionDetailSection } from "../services/notion-detail-sections";

import { NotionDetailView } from "./NotionDetailView";

afterEach(cleanup);

const OVERVIEW_SECTION: NotionDetailSection = {
  title: "Property overview",
  layout: "grid",
  fields: [
    { key: "bedrooms", label: "Bedrooms", value: 3 },
    { key: "bathrooms", label: "Bathrooms", value: 2 },
    { key: "guests", label: "Max guests", value: 6 },
  ],
};

const RESOURCES_SECTION: NotionDetailSection = {
  title: "Booking & resources",
  layout: "actions",
  fields: [
    {
      key: "airbnbLink",
      label: "Airbnb listing",
      value: "https://airbnb.com/rooms/123",
    },
    {
      key: "directBooking",
      label: "Direct booking",
      value: "Call the owner directly at 555-0100 to arrange early check-in",
    },
    { key: "vrboLink", label: "VRBO listing", value: null },
  ],
};

describe("NotionDetailView", () => {
  it("renders the property overview grid with real values, not placeholders", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[OVERVIEW_SECTION]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    expect(screen.getByText("Bedrooms")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("renders a URL resource field as a short 'Open' action, never the raw URL text", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[RESOURCES_SECTION]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    const link = screen.getByRole("link", { name: /Open/i });
    expect(link.getAttribute("href")).toBe("https://airbnb.com/rooms/123");
    expect(link.textContent).toBe("Open");
    expect(screen.queryByText("https://airbnb.com/rooms/123")).toBeNull();
  });

  it("renders a non-URL resource value as wrapped plain text (never a link), with the exact original text preserved", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[RESOURCES_SECTION]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    const text = screen.getByText(
      "Call the owner directly at 555-0100 to arrange early check-in",
    );
    expect(text.tagName).not.toBe("A");
    // break-words is the class that prevents a long non-URL value from
    // forcing horizontal overflow inside the (width-capped) dialog.
    expect(text.className).toContain("break-words");
  });

  it("renders '—' for a resource field with no value, not an empty/broken row", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[RESOURCES_SECTION]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    expect(screen.getByText("VRBO listing")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders the region badge and subtitle (e.g. address) in the header, not as a body section", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        subtitle="123 Main St, Bradenton, FL"
        region="SRQ"
        sections={[OVERVIEW_SECTION]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    expect(screen.getByText("SRQ")).toBeTruthy();
    expect(screen.getByText("123 Main St, Bradenton, FL")).toBeTruthy();
  });

  it("shows a clear 'no information' message when given zero sections, rather than an empty panel", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={null}
      />,
    );

    expect(
      screen.getByText(
        "No additional information is available to show here yet.",
      ),
    ).toBeTruthy();
  });

  it("shows the confirmed StayWhile property badge only when propertyContext is provided", () => {
    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[]}
        lastEditedTime={null}
        notionUrl={null}
        propertyContext={{ propertyId: "p1", propertyName: "Miramar Bliss" }}
      />,
    );

    expect(screen.getByText("Miramar Bliss")).toBeTruthy();
  });

  it("contains no write/mutation affordance anywhere in the rendered output", () => {
    const { container } = render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[OVERVIEW_SECTION, RESOURCES_SECTION]}
        lastEditedTime="2026-09-01T00:00:00.000Z"
        notionUrl="https://notion.so/moonlit-cove"
        propertyContext={null}
      />,
    );

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input, textarea, select")).toBeNull();
    expect(screen.queryByText(/^save$/i)).toBeNull();
    expect(screen.queryByText(/^delete$/i)).toBeNull();
    expect(screen.queryByText(/^edit$/i)).toBeNull();
  });
});
