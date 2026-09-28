// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewOwnerRezSyncButton } from "./PreviewOwnerRezSyncButton";

afterEach(cleanup);

const summary = {
  bookingsEvaluated: 1012,
  toCreate: 180,
  toUpdate: 0,
  writable: { active: 170, cancelled: 10, other: 0 },
  currentOrUpcoming: 95,
  unmatchedPropertyBookings: 820,
  unrecognizedStatusBookings: 2,
  unmatchedProperties: [
    { ownerRezPropertyId: 900, bookings: 40, nextArrival: "2026-10-10" },
  ],
  unrecognizedStatuses: [{ status: "hold", bookings: 2 }],
};

describe("PreviewOwnerRezSyncButton (2026-09-28)", () => {
  it("is labelled read-only in words (not just colour) and says it makes no StayWhile changes", () => {
    render(<PreviewOwnerRezSyncButton action={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Preview OwnerRez Sync/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.getByText(/Makes no changes in StayWhile/)).toBeTruthy();
  });

  it("one click runs the preview action once and shows the counts, unmatched properties and statuses", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "preview",
      generatedAt: "2026-09-28T04:00:00.000Z",
      summary,
    });
    render(<PreviewOwnerRezSyncButton action={action} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Preview OwnerRez Sync/ }),
    );

    const panel = await screen.findByRole("region", {
      name: "OwnerRez sync preview",
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(panel.textContent).toContain(
      "Preview only — nothing was written to StayWhile.",
    );
    expect(panel.textContent).toContain("Bookings evaluated1012");
    expect(panel.textContent).toContain("Would create180");
    expect(panel.textContent).toContain("170 / 10 / 0");
    expect(panel.textContent).toContain("in-house or upcoming95");
    expect(panel.textContent).toContain(
      "OwnerRez property #900: 40 bookings (next arrival 2026-10-10)",
    );
    expect(panel.textContent).toContain("“hold”: 2");
    expect(panel.textContent).toContain("Wait at least 5 minutes");
  });

  it("shows a failure without inventing numbers", async () => {
    render(
      <PreviewOwnerRezSyncButton
        action={vi.fn().mockResolvedValue({
          status: "failure",
          error: "OwnerRez rate limit reached",
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Preview OwnerRez Sync/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Preview failed: OwnerRez rate limit reached"),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });
});
