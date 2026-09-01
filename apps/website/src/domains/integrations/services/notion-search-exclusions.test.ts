import { describe, expect, it } from "vitest";

import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";
import { isExcludedFromVaSearch } from "./notion-search-exclusions";

const [PEOPLE_DB_ID] = NOTION_SEARCH_EXCLUDED_DATABASE_IDS;

describe("isExcludedFromVaSearch", () => {
  it("excludes the excluded database object itself", () => {
    expect(
      isExcludedFromVaSearch({
        id: PEOPLE_DB_ID!,
        sourceType: "database",
        parentDatabaseId: null,
      }),
    ).toBe(true);
  });

  it("excludes a row whose parentDatabaseId is an excluded database", () => {
    expect(
      isExcludedFromVaSearch({
        id: "row-123",
        sourceType: "database_row",
        parentDatabaseId: PEOPLE_DB_ID!,
      }),
    ).toBe(true);
  });

  it("does not exclude a row in an unrelated database", () => {
    expect(
      isExcludedFromVaSearch({
        id: "row-456",
        sourceType: "database_row",
        parentDatabaseId: "some-operational-db-id",
      }),
    ).toBe(false);
  });

  it("does not exclude a database that isn't in the excluded list", () => {
    expect(
      isExcludedFromVaSearch({
        id: "view-of-listings-id",
        sourceType: "database",
        parentDatabaseId: null,
      }),
    ).toBe(false);
  });

  it("never excludes a standalone page, even one with no parentDatabaseId", () => {
    expect(
      isExcludedFromVaSearch({
        id: "page-1",
        sourceType: "page",
        parentDatabaseId: null,
      }),
    ).toBe(false);
  });

  it("does not exclude a row with a null parentDatabaseId (never treats 'unknown parent' as excluded)", () => {
    expect(
      isExcludedFromVaSearch({
        id: "row-789",
        sourceType: "database_row",
        parentDatabaseId: null,
      }),
    ).toBe(false);
  });

  it("excludes every configured database id, not just the first", () => {
    for (const id of NOTION_SEARCH_EXCLUDED_DATABASE_IDS) {
      expect(
        isExcludedFromVaSearch({
          id: "some-row",
          sourceType: "database_row",
          parentDatabaseId: id,
        }),
      ).toBe(true);
    }
  });

  it("is never fooled by a title containing a staff member's name — exclusion is id-based only, this function doesn't even accept a title", () => {
    // Type-level guarantee: isExcludedFromVaSearch's parameter type has no
    // `title` field at all, so it's structurally impossible for this
    // function to make a decision based on result text.
    const result = isExcludedFromVaSearch({
      id: "sop-page-mentioning-jenny",
      sourceType: "database_row",
      parentDatabaseId: "operational-sop-database-id",
    });
    expect(result).toBe(false);
  });
});
