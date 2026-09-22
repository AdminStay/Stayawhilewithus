import { describe, expect, it } from "vitest";

import { updateNotionBlockRequestSchema } from "./notion-block-edit.schema";

const VALID = {
  pageId: "page-1",
  blockId: "block-1",
  expectedLastEditedTime: "2026-09-22T00:00:00.000Z",
  text: "Some text",
};

describe("updateNotionBlockRequestSchema", () => {
  it("accepts a well-formed request", () => {
    expect(updateNotionBlockRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an empty string as text (clearing a block's content)", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({ ...VALID, text: "" }).success,
    ).toBe(true);
  });

  it("rejects a missing/empty pageId", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({ ...VALID, pageId: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing/empty blockId", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({ ...VALID, blockId: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing/empty expectedLastEditedTime", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({
        ...VALID,
        expectedLastEditedTime: "",
      }).success,
    ).toBe(false);
  });

  it("rejects text over the 2000-character cap", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({
        ...VALID,
        text: "a".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("accepts text at exactly the 2000-character cap", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({
        ...VALID,
        text: "a".repeat(2000),
      }).success,
    ).toBe(true);
  });

  it("rejects a non-string text value", () => {
    expect(
      updateNotionBlockRequestSchema.safeParse({ ...VALID, text: 123 }).success,
    ).toBe(false);
  });
});
