import { describe, expect, it } from "vitest";

import { summarizeOwnerRezPreview } from "./ownerrez-preview-summary";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const item = (
  id: number,
  overrides: Partial<{
    ownerRezPropertyId: number;
    status: string;
    arrival: string;
    departure: string;
  }> = {},
) => ({
  ownerRezBookingId: id,
  ownerRezPropertyId: 500,
  propertyName: "Aqua Palm",
  status: "active",
  arrival: "2026-10-05",
  departure: "2026-10-08",
  ...overrides,
});

describe("summarizeOwnerRezPreview (2026-09-28)", () => {
  it("counts creates/updates, active/cancelled/other and in-house/upcoming among bookings a sync would write", () => {
    const summary = summarizeOwnerRezPreview(
      {
        totalFetched: 9,
        toCreate: [
          item(1),
          item(2, { status: "canceled" }),
          item(3, { arrival: "2026-09-25", departure: "2026-09-30" }), // in-house
          item(4, { arrival: "2026-08-01", departure: "2026-08-04" }), // past
        ],
        toUpdate: [item(5, { status: "pending" })],
        unmatchedProperty: [
          item(6, {
            ownerRezPropertyId: 900,
            arrival: "2026-11-01",
            departure: "2026-11-03",
          }),
          item(7, {
            ownerRezPropertyId: 900,
            arrival: "2026-10-10",
            departure: "2026-10-12",
          }),
          item(8, {
            ownerRezPropertyId: 901,
            arrival: "2026-07-01",
            departure: "2026-07-02",
          }),
        ],
        unrecognizedStatus: [item(9, { status: "hold" })],
      },
      NOW,
    );

    expect(summary).toEqual({
      bookingsEvaluated: 9,
      toCreate: 4,
      toUpdate: 1,
      writable: { active: 3, cancelled: 1, other: 1 },
      currentOrUpcoming: 4,
      unmatchedPropertyBookings: 3,
      unrecognizedStatusBookings: 1,
      unmatchedProperties: [
        { ownerRezPropertyId: 900, bookings: 2, nextArrival: "2026-10-10" },
        { ownerRezPropertyId: 901, bookings: 1, nextArrival: null },
      ],
      unrecognizedStatuses: [{ status: "hold", bookings: 1 }],
    });
  });

  it("a long-lead upcoming stay is counted as a create and as upcoming", () => {
    const summary = summarizeOwnerRezPreview(
      {
        totalFetched: 1,
        toCreate: [
          item(42, { arrival: "2027-02-01", departure: "2027-02-05" }),
        ],
        toUpdate: [],
        unmatchedProperty: [],
        unrecognizedStatus: [],
      },
      NOW,
    );
    expect(summary.toCreate).toBe(1);
    expect(summary.currentOrUpcoming).toBe(1);
  });
});
