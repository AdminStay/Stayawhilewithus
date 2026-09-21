// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same rationale as NotionFieldEditor.test.tsx — NotionFieldEditor (mounted
// here only when a field is editable) uses useActionState/useRouter
// internally, neither of which behaves correctly against jsdom without
// this mocking.
const { mockUseActionState } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
}));
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return { ...actual, useActionState: mockUseActionState };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import type { NotionDetailSection } from "../services/notion-detail-sections";

import { NotionDetailView } from "./NotionDetailView";

afterEach(cleanup);

const noopDispatch = vi.fn();
const noopAction = vi.fn();
mockUseActionState.mockReturnValue([{ status: "idle" }, noopDispatch, false]);

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

  it("renders a real Edit control ONLY when a field is editable AND pageId/dataSourceId/updateFieldAction are all present", () => {
    const editableSection: NotionDetailSection = {
      title: "Booking & resources",
      layout: "actions",
      fields: [
        {
          key: "guidebookUrl",
          label: "Guidebook",
          value: "https://guide.example",
          rawValue: "https://guide.example",
          editable: true,
          edit: { fieldType: "url" },
        },
      ],
    };

    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[editableSection]}
        lastEditedTime="2026-09-01T00:00:00.000Z"
        notionUrl={null}
        propertyContext={null}
        pageId="page-1"
        dataSourceId="ds-1"
        updateFieldAction={noopAction}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    // The plain "Open" action for this field must not also render —
    // editable replaces the static display entirely, never sits beside it.
    expect(screen.queryByRole("link", { name: /Open/i })).toBeNull();
  });

  it("stays plain/read-only for a field marked editable when pageId/dataSourceId/updateFieldAction are missing (e.g. a generic search-result preview)", () => {
    const editableSection: NotionDetailSection = {
      title: "Booking & resources",
      layout: "actions",
      fields: [
        {
          key: "guidebookUrl",
          label: "Guidebook",
          value: "https://guide.example",
          rawValue: "https://guide.example",
          editable: true,
          edit: { fieldType: "url" },
        },
      ],
    };

    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[editableSection]}
        lastEditedTime="2026-09-01T00:00:00.000Z"
        notionUrl={null}
        propertyContext={null}
        // pageId/dataSourceId/updateFieldAction all omitted on purpose.
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("link", { name: /Open/i })).toBeTruthy();
  });

  it("stays plain/read-only for a non-editable field even when full edit context IS available for the view as a whole", () => {
    const mixedSection: NotionDetailSection = {
      title: "Booking & resources",
      layout: "actions",
      fields: [
        {
          key: "guidebookUrl",
          label: "Guidebook",
          value: "https://guide.example",
          rawValue: "https://guide.example",
          editable: false,
        },
      ],
    };

    render(
      <NotionDetailView
        open
        onClose={() => {}}
        title="Moonlit Cove"
        sections={[mixedSection]}
        lastEditedTime="2026-09-01T00:00:00.000Z"
        notionUrl={null}
        propertyContext={null}
        pageId="page-1"
        dataSourceId="ds-1"
        updateFieldAction={noopAction}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("link", { name: /Open/i })).toBeTruthy();
  });
});
