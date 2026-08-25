import { describe, expect, it } from "vitest";

import { isSafeHttpUrl } from "./notion-link.utils";

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
