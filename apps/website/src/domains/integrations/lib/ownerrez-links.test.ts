import { describe, expect, it } from "vitest";

import {
  ownerRezBookingUrl,
  ownerRezPropertyUrl,
  ownerRezReservationUrl,
} from "./ownerrez-links";

// The real links Michelle supplied (2026-10-03).
const BOOKING_19458918 =
  "https://secure.ownerreservations.com/bookings/19458918";
const PROPERTY_386471 = "https://app.ownerrez.com/properties/386471/info";

describe("OwnerRez links — exact patterns from real examples", () => {
  it("booking 19458918 → Michelle's reservation URL (string or number id)", () => {
    expect(ownerRezBookingUrl("19458918")).toBe(BOOKING_19458918);
    expect(ownerRezBookingUrl(19458918)).toBe(BOOKING_19458918);
  });

  it("property 386471 → Michelle's property URL (string or number id)", () => {
    expect(ownerRezPropertyUrl("386471")).toBe(PROPERTY_386471);
    expect(ownerRezPropertyUrl(386471)).toBe(PROPERTY_386471);
  });

  it.each([
    [
      "a DIRECT reservation's generated UUID",
      "3f6c2b1e-8d4a-4c6e-9f2a-1b2c3d4e5f60",
    ],
    ["empty", ""],
    ["whitespace", "   "],
    ["zero", "0"],
    ["negative", "-19458918"],
    ["decimal", "1945.8918"],
    ["leading zero", "019458918"],
    ["letters", "19458918a"],
    ["a path", "19458918/edit"],
    ["a full URL", "https://evil.example/19458918"],
    ["null", null],
    ["undefined", undefined],
  ])("no link (never a malformed one) for %s", (_label, id) => {
    expect(ownerRezBookingUrl(id as never)).toBeNull();
    expect(ownerRezPropertyUrl(id as never)).toBeNull();
  });

  it("surrounding spaces are trimmed, not passed into the URL", () => {
    expect(ownerRezBookingUrl(" 19458918 ")).toBe(BOOKING_19458918);
  });
});

describe("ownerRezReservationUrl — uses the reservation's own OwnerRez booking id", () => {
  it("an OWNERREZ reservation links by its externalReservationId", () => {
    expect(
      ownerRezReservationUrl({
        source: "OWNERREZ",
        externalReservationId: "19458918",
      }),
    ).toBe(BOOKING_19458918);
  });

  it.each(["DIRECT", "AIRBNB", "OTHER"])(
    "a %s reservation never gets an OwnerRez link, even with a numeric id",
    (source) => {
      expect(
        ownerRezReservationUrl({ source, externalReservationId: "19458918" }),
      ).toBeNull();
    },
  );
});
