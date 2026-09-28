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
  eligibleGuestBookings: 180,
  toCreate: 180,
  toUpdate: 0,
  writable: { active: 170, cancelled: 10, other: 0 },
  currentOrUpcoming: 95,
  unmatchedPropertyBookings: 820,
  unrecognizedStatusBookings: 2,
  nonGuest: {
    block: 187,
    quote_hold: 1,
    linked_availability: 3,
    owner: 4,
    unknown: 5,
  },
  nonGuestTotal: 200,
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
    expect(panel.textContent).toContain("OwnerRez records evaluated1012");
    expect(panel.textContent).toContain(
      "Guest bookings eligible for import180",
    );
    expect(panel.textContent).toContain("Would create180");
    expect(panel.textContent).toContain("170 / 10 / 0");
    expect(panel.textContent).toContain("in-house or upcoming95");
    expect(panel.textContent).toContain(
      "OwnerRez property #900: 40 bookings (next arrival 2026-10-10)",
    );
    expect(panel.textContent).toContain("“hold”: 2");
    expect(panel.textContent).toContain("Wait at least 5 minutes");
  });

  it("shows non-guest records separately by kind, marked as never imported (2026-09-29)", async () => {
    render(
      <PreviewOwnerRezSyncButton
        action={vi.fn().mockResolvedValue({
          status: "preview",
          generatedAt: "2026-09-29T04:00:00.000Z",
          summary,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Preview OwnerRez Sync/ }),
    );
    const panel = await screen.findByRole("region", {
      name: "OwnerRez sync preview",
    });
    const text = panel.textContent ?? "";
    expect(text).toContain("Skipped: not guest reservations200");
    expect(text).toContain("Not guest reservations — never imported");
    expect(text).toContain("Blocked-off time187");
    expect(text).toContain("Quote holds1");
    expect(text).toContain("Linked availability3");
    expect(text).toContain("Owner stays4");
    expect(text).toContain("Unknown or missing type5");
    // The existing skips stay separate from the non-guest ones.
    expect(text).toContain("Skipped: property not linked in StayWhile820");
    expect(text).toContain("Skipped: unrecognized status2");
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
