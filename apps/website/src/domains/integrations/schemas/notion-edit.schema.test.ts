import { describe, expect, it } from "vitest";

import { fieldValueSchemaFor } from "./notion-edit.schema";

/**
 * Direct unit coverage for fieldValueSchemaFor — otherwise untested today,
 * since NOTION_EDIT_ALLOWLIST is empty and notion-edit.service.ts never
 * reaches this function in practice (see that service's own test file).
 * These tests exercise the per-field-type validation in isolation, so the
 * exact rules that WILL gate a future real write are proven correct now,
 * not discovered for the first time once a field is actually approved.
 */
describe("fieldValueSchemaFor", () => {
  it("text: accepts a normal string, rejects anything over the 2000-char cap", () => {
    const schema = fieldValueSchemaFor("text");
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse("a".repeat(2000)).success).toBe(true);
    expect(schema.safeParse("a".repeat(2001)).success).toBe(false);
    expect(schema.safeParse(123).success).toBe(false);
  });

  it("url: accepts a well-formed http(s) URL, rejects a bare string or non-URL", () => {
    const schema = fieldValueSchemaFor("url");
    expect(schema.safeParse("https://example.com/guide").success).toBe(true);
    expect(schema.safeParse("not a url").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });

  it("number: accepts a finite number, rejects NaN/Infinity/strings", () => {
    const schema = fieldValueSchemaFor("number");
    expect(schema.safeParse(4).success).toBe(true);
    expect(schema.safeParse(Number.NaN).success).toBe(false);
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(schema.safeParse("4").success).toBe(false);
  });

  it("checkbox: accepts only real booleans", () => {
    const schema = fieldValueSchemaFor("checkbox");
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(true);
    expect(schema.safeParse("true").success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it("date: accepts a parseable ISO 8601 string, rejects garbage", () => {
    const schema = fieldValueSchemaFor("date");
    expect(schema.safeParse("2026-09-16").success).toBe(true);
    expect(schema.safeParse("2026-09-16T12:00:00.000Z").success).toBe(true);
    expect(schema.safeParse("not-a-date").success).toBe(false);
  });

  it("select: accepts only a value from the exact provided option set", () => {
    const schema = fieldValueSchemaFor("select", ["Available", "Blocked"]);
    expect(schema.safeParse("Available").success).toBe(true);
    expect(schema.safeParse("Unlisted").success).toBe(false);
  });

  it("select: with no options configured, rejects every value (misconfiguration is fail-closed, never a silent passthrough)", () => {
    const schema = fieldValueSchemaFor("select", []);
    expect(schema.safeParse("Available").success).toBe(false);
  });

  it("multi_select: accepts only an array whose entries are all in the option set", () => {
    const schema = fieldValueSchemaFor("multi_select", ["A", "B", "C"]);
    expect(schema.safeParse(["A", "C"]).success).toBe(true);
    expect(schema.safeParse(["A", "Z"]).success).toBe(false);
    expect(schema.safeParse("A").success).toBe(false);
  });

  it("multi_select: with no options configured, rejects every value", () => {
    const schema = fieldValueSchemaFor("multi_select", []);
    expect(schema.safeParse(["A"]).success).toBe(false);
  });
});
