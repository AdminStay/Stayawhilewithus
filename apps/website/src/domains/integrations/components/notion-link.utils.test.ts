import { describe, expect, it } from "vitest";

import { isSafeHttpUrl, notionPageUrl } from "./notion-link.utils";

describe("isSafeHttpUrl", () => {
  it("accepts a well-formed https URL", () => {
    expect(isSafeHttpUrl("https://airbnb.com/rooms/123")).toBe(true);
  });

  it("accepts a well-formed http URL", () => {
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects a javascript: URL", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects plain descriptive text that isn't a URL", () => {
    expect(isSafeHttpUrl("Book direct via text message")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeHttpUrl("")).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isSafeHttpUrl("ht!tp://not a url")).toBe(false);
  });
});

describe("notionPageUrl (Phase 0 Open in Notion)", () => {
  it("builds a notion.so link from a hyphenated id", () => {
    expect(notionPageUrl("3e26058d-b989-803d-a1d7-f06f8adc27a6")).toBe(
      "https://notion.so/3e26058db989803da1d7f06f8adc27a6",
    );
  });

  it("accepts an un-hyphenated id and lower-cases it", () => {
    expect(notionPageUrl("3E26058DB989803DA1D7F06F8ADC27A6")).toBe(
      "https://notion.so/3e26058db989803da1d7f06f8adc27a6",
    );
  });

  it("returns null for missing or empty ids", () => {
    expect(notionPageUrl(null)).toBeNull();
    expect(notionPageUrl(undefined)).toBeNull();
    expect(notionPageUrl("")).toBeNull();
  });

  it("returns null for anything that isn't exactly a Notion id", () => {
    for (const bad of [
      "row-1",
      "3e26058d-b989-803d-a1d7-f06f8adc27a", // too short
      "3e26058d-b989-803d-a1d7-f06f8adc27a6f", // too long
      "3e26058g-b989-803d-a1d7-f06f8adc27a6", // non-hex
      "3e26058d-b989-803d-a1d7-f06f8adc27a6/evil",
      "3e26058d-b989-803d-a1d7-f06f8adc27a6?x=1",
      "3e26058d-b989-803d-a1d7-f06f8adc27a6#x",
      "javascript:alert(1)",
      " 3e26058d-b989-803d-a1d7-f06f8adc27a6",
    ]) {
      expect(notionPageUrl(bad)).toBeNull();
    }
  });

  it("always produces a URL that passes isSafeHttpUrl", () => {
    expect(
      isSafeHttpUrl(notionPageUrl("3e26058d-b989-803d-a1d7-f06f8adc27a6")),
    ).toBe(true);
  });
});
