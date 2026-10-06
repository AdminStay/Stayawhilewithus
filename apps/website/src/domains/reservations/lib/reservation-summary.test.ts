import { describe, expect, it } from "vitest";

import {
  nightsLabel,
  RESERVATION_STATUS_TONE,
  reservationNights,
  TODAY_RESERVATIONS_HREF,
} from "./reservation-summary";

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("reservationNights (Phase 6)", () => {
  it.each([
    ["2026-09-24", "2026-09-27", 3],
    ["2026-10-06", "2026-10-07", 1],
    ["2026-10-30", "2026-11-02", 3], // across a month end
    ["2026-11-01", "2026-11-04", 3], // across the US DST change
    ["2026-10-06", "2026-10-06", 0],
  ])("%s → %s = %i nights", (checkIn, checkOut, nights) => {
    expect(reservationNights(day(checkIn), day(checkOut))).toBe(nights);
  });

  it("is never negative for out-of-order dates", () => {
    expect(reservationNights(day("2026-10-07"), day("2026-10-06"))).toBe(0);
  });
});

describe("nightsLabel", () => {
  it("singular and plural", () => {
    expect(nightsLabel(1)).toBe("1 night");
    expect(nightsLabel(0)).toBe("0 nights");
    expect(nightsLabel(4)).toBe("4 nights");
  });
});

describe("status tone and View all link", () => {
  it("uses the same tones as /reservations", () => {
    expect(RESERVATION_STATUS_TONE).toEqual({
      PENDING: "gold",
      CONFIRMED: "info",
      CHECKED_IN: "success",
      CHECKED_OUT: "neutral",
      CANCELLED: "error",
    });
  });

  it("View all goes to /reservations?view=today", () => {
    expect(TODAY_RESERVATIONS_HREF).toBe("/reservations?view=today");
  });
});
