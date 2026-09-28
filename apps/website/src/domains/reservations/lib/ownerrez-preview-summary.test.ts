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
        nonGuest: [],
      },
      NOW,
    );

    expect(summary).toEqual({
      bookingsEvaluated: 9,
      eligibleGuestBookings: 5,
      toCreate: 4,
      toUpdate: 1,
      writable: { active: 3, cancelled: 1, other: 1 },
      currentOrUpcoming: 4,
      unmatchedPropertyBookings: 3,
      unrecognizedStatusBookings: 1,
      nonGuest: {
        block: 0,
        quote_hold: 0,
        linked_availability: 0,
        owner: 0,
        unknown: 0,
      },
      nonGuestTotal: 0,
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
        nonGuest: [],
      },
      NOW,
    );
    expect(summary.toCreate).toBe(1);
    expect(summary.currentOrUpcoming).toBe(1);
  });

  it("reports non-guest records separately by kind, apart from eligible guest bookings and the existing skips (2026-09-29)", () => {
    const summary = summarizeOwnerRezPreview(
      {
        totalFetched: 9,
        toCreate: [item(1), item(2, { status: "canceled" })],
        toUpdate: [],
        unmatchedProperty: [item(3, { ownerRezPropertyId: 900 })],
        unrecognizedStatus: [item(4, { status: "hold" })],
        nonGuest: [
          { ...item(5), kind: "block" as const },
          { ...item(6), kind: "block" as const },
          { ...item(7, { status: "canceled" }), kind: "quote_hold" as const },
          { ...item(8), kind: "linked_availability" as const },
          { ...item(9), kind: "unknown" as const },
        ],
      },
      NOW,
    );
    expect(summary.eligibleGuestBookings).toBe(2);
    expect(summary.toCreate).toBe(2);
    expect(summary.writable).toEqual({ active: 1, cancelled: 1, other: 0 });
    expect(summary.unmatchedPropertyBookings).toBe(1);
    expect(summary.unrecognizedStatusBookings).toBe(1);
    expect(summary.nonGuest).toEqual({
      block: 2,
      quote_hold: 1,
      linked_availability: 1,
      owner: 0,
      unknown: 1,
    });
    expect(summary.nonGuestTotal).toBe(5);
    // Non-guest records never count toward what a sync would write.
    expect(summary.currentOrUpcoming).toBe(2);
  });
});
