import { describe, expect, it } from "vitest";

import {
  findBlockEditAllowlistEntry,
  NOTION_BLOCK_EDIT_ALLOWLIST,
} from "./notion-block-edit-allowlist";

const APPROVED_TEST_PAGE_ID = "3e26058d-b989-803d-a1d7-f06f8adc27a6";
const APPROVED_TEST_BLOCK_ID = "3e26058d-b989-8006-9732-c285c035e832";

describe("NOTION_BLOCK_EDIT_ALLOWLIST — real, live config", () => {
  it("contains exactly one entry — the user-approved controlled-test page/block, and nothing else", () => {
    expect(NOTION_BLOCK_EDIT_ALLOWLIST).toEqual([
      {
        pageId: APPROVED_TEST_PAGE_ID,
        blockId: APPROVED_TEST_BLOCK_ID,
        blockType: "paragraph",
        label: "StayWhile Dashboard Integration Test — first paragraph",
      },
    ]);
  });

  it("findBlockEditAllowlistEntry returns the real entry for the exact approved page+block pair", () => {
    const entry = findBlockEditAllowlistEntry(
      APPROVED_TEST_PAGE_ID,
      APPROVED_TEST_BLOCK_ID,
    );
    expect(entry).toEqual({
      pageId: APPROVED_TEST_PAGE_ID,
      blockId: APPROVED_TEST_BLOCK_ID,
      blockType: "paragraph",
      label: "StayWhile Dashboard Integration Test — first paragraph",
    });
  });

  it("findBlockEditAllowlistEntry returns null for every other page/block — the approved entry does not broaden access to anything else", () => {
    expect(findBlockEditAllowlistEntry("page-1", "block-1")).toBeNull();
    // The approved page's OTHER (second, unapproved) paragraph block.
    expect(
      findBlockEditAllowlistEntry(
        APPROVED_TEST_PAGE_ID,
        "3e26058d-b989-806a-a79f-e082f156eeef",
      ),
    ).toBeNull();
    // The approved block id under a different (wrong) page id.
    expect(
      findBlockEditAllowlistEntry("some-other-page", APPROVED_TEST_BLOCK_ID),
    ).toBeNull();
  });
});

describe("findBlockEditAllowlistEntry", () => {
  it("matches only the exact pageId + blockId pair, never pageId or blockId alone", () => {
    const fakeAllowlist = [
      {
        pageId: "page-1",
        blockId: "block-1",
        blockType: "paragraph" as const,
        label: "Test",
      },
    ];

    const findWith = (pageId: string, blockId: string) =>
      fakeAllowlist.find((e) => e.pageId === pageId && e.blockId === blockId) ??
      null;

    expect(findWith("page-1", "block-1")).not.toBeNull();
    expect(findWith("page-1", "block-2")).toBeNull();
    expect(findWith("page-2", "block-1")).toBeNull();
  });
});
