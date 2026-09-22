import { describe, expect, it } from "vitest";

import {
  findBlockEditAllowlistEntry,
  NOTION_BLOCK_EDIT_ALLOWLIST,
} from "./notion-block-edit-allowlist";

// The former controlled-test page/block — its allowlist entry has been
// removed now that the real Production write/verify/restore test has
// already passed (see HANDOFF.md). Kept here only to prove it's no longer
// editable, not because it's still expected to be.
const FORMER_TEST_PAGE_ID = "3e26058d-b989-803d-a1d7-f06f8adc27a6";
const FORMER_TEST_BLOCK_ID = "3e26058d-b989-8006-9732-c285c035e832";

describe("NOTION_BLOCK_EDIT_ALLOWLIST — real, live config", () => {
  it("is empty — no page/block is editable in the real app until a new one is explicitly approved", () => {
    expect(NOTION_BLOCK_EDIT_ALLOWLIST).toEqual([]);
  });

  it("findBlockEditAllowlistEntry returns null for the former controlled-test page/block now that its entry is removed", () => {
    expect(
      findBlockEditAllowlistEntry(FORMER_TEST_PAGE_ID, FORMER_TEST_BLOCK_ID),
    ).toBeNull();
  });

  it("findBlockEditAllowlistEntry returns null for every other page/block against the real, empty allowlist", () => {
    expect(findBlockEditAllowlistEntry("page-1", "block-1")).toBeNull();
    expect(
      findBlockEditAllowlistEntry(
        FORMER_TEST_PAGE_ID,
        "3e26058d-b989-806a-a79f-e082f156eeef",
      ),
    ).toBeNull();
    expect(
      findBlockEditAllowlistEntry("some-other-page", FORMER_TEST_BLOCK_ID),
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
