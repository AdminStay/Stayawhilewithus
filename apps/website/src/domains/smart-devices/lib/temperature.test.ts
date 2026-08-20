import { describe, expect, it } from "vitest";

import { celsiusToFahrenheit, fahrenheitToCelsius } from "./temperature";

describe("celsiusToFahrenheit", () => {
  it("converts known reference points correctly", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(21)).toBe(70);
  });
});

describe("fahrenheitToCelsius", () => {
  it("converts known reference points correctly", () => {
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
  });

  it("round-trips through celsiusToFahrenheit within rounding tolerance", () => {
    const original = 68;
    const roundTripped = celsiusToFahrenheit(fahrenheitToCelsius(original));
    expect(roundTripped).toBe(original);
  });
});
