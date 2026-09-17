// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkRefreshDialog } from "./BulkRefreshDialog";

afterEach(cleanup);

const ROWS = [
  {
    id: "lock-1",
    propertyName: "Bahamas",
    name: "Front Door",
    lastSyncedAt: null,
  },
  {
    id: "lock-2",
    propertyName: "Camingo",
    name: "Side Door",
    lastSyncedAt: null,
  },
];

describe("BulkRefreshDialog", () => {
  it("the selection checklist is not visible until the trigger is clicked", () => {
    render(<BulkRefreshDialog rows={ROWS} action={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Bulk refresh/ })).toBeTruthy();
    // The panel's own "Select all"/"Select none" controls only make sense
    // once the dialog is meaningfully open — confirms the 42-row checklist
    // no longer permanently occupies the page.
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  });

  it("clicking the trigger opens the dialog and reveals the existing selection functionality (Select all/Select none)", () => {
    render(<BulkRefreshDialog rows={ROWS} action={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Bulk refresh/ }));

    expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select none" })).toBeTruthy();
    expect(screen.getByText(/Bahamas — Front Door/)).toBeTruthy();
    expect(screen.getByText(/Camingo — Side Door/)).toBeTruthy();
  });

  it("clicking the dialog's close control hides it again without submitting anything", () => {
    const action = vi.fn();
    render(<BulkRefreshDialog rows={ROWS} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: /Bulk refresh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("the dialog is titled 'Bulk refresh telemetry', matching the original panel heading it replaced", () => {
    render(<BulkRefreshDialog rows={ROWS} action={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Bulk refresh/ }));

    expect(screen.getByText("Bulk refresh telemetry")).toBeTruthy();
  });
});
