import { describe, expect, it } from "vitest";

import {
  NOTION_VISIBILITY_ALLOWLIST,
  selectVisibleNotionFields,
  type NotionVisibilityAllowlistEntry,
} from "./notion-field-visibility";

const RECORD = {
  id: "1",
  url: "https://notion.so/1",
  name: "Moonlit Cove",
  address: "123 Main St",
  bedrooms: 3,
  bathrooms: 2,
  guests: 6,
  directBooking: null,
  airbnbLink: null,
  vrboLink: null,
  googleDrivePhotosUrl: null,
  guidebookUrl: null,
  lastEditedTime: "2026-09-01T00:00:00.000Z",
};

describe("NOTION_VISIBILITY_ALLOWLIST", () => {
  it("models no sensitive field yet — every entry is standard", () => {
    // Michelle's requested operational examples (lockbox, router location,
    // service-provider info) are real but unconfirmed against the live
    // Notion schema — this proves none were guessed into the allowlist.
    expect(
      NOTION_VISIBILITY_ALLOWLIST.every(
        (entry) => entry.sensitivity === "standard",
      ),
    ).toBe(true);
  });
});

describe("selectVisibleNotionFields — .list (ordered, labeled — feeds the generic detail view)", () => {
  it("returns every standard field regardless of sensitive-field permission", () => {
    const withoutSensitive = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: false,
    });
    const withSensitive = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: true,
    });
    expect(withoutSensitive.list).toHaveLength(
      NOTION_VISIBILITY_ALLOWLIST.length,
    );
    expect(withSensitive.list).toHaveLength(NOTION_VISIBILITY_ALLOWLIST.length);
  });

  it("never returns id/url/lastEditedTime as a labeled field — those are handled separately by the caller", () => {
    const { list } = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: true,
    });
    expect(list.some((f) => f.field === "id")).toBe(false);
    expect(list.some((f) => f.field === "url")).toBe(false);
    expect(list.some((f) => f.field === "lastEditedTime")).toBe(false);
  });

  it("carries the real record value through for each allowlisted field", () => {
    const { list } = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: false,
    });
    const name = list.find((f) => f.field === "name");
    expect(name?.value).toBe("Moonlit Cove");
  });
});

describe("selectVisibleNotionFields — .fields (the SAFE CLIENT DTO payload)", () => {
  // Requirement 4: Property Listings still receive all 10 currently
  // approved standard fields.
  it("includes exactly the 10 currently-approved standard fields, with their real values", () => {
    const { fields } = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: false,
    });
    expect(Object.keys(fields).sort()).toEqual(
      [
        "name",
        "address",
        "bedrooms",
        "bathrooms",
        "guests",
        "directBooking",
        "airbnbLink",
        "vrboLink",
        "googleDrivePhotosUrl",
        "guidebookUrl",
      ].sort(),
    );
    expect(fields.name).toBe("Moonlit Cove");
    expect(fields.address).toBe("123 Main St");
    expect(fields.bedrooms).toBe(3);
  });

  // Requirement 1: a field not in the visibility allowlist cannot appear in
  // the client DTO. `id`/`url`/`lastEditedTime` exist on RECORD but are
  // never in NOTION_VISIBILITY_ALLOWLIST — this proves the filter, not just
  // the specific 10-field allowlist snapshot above.
  it("never includes a field absent from the allowlist, even though it's present on the source record", () => {
    const { fields } = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: true,
    });
    expect("id" in fields).toBe(false);
    expect("url" in fields).toBe(false);
    expect("lastEditedTime" in fields).toBe(false);
  });

  // Requirement 9 (this function specifically): the SAFE CLIENT DTO is a
  // brand-new object built key-by-key — never `record` itself, never a
  // spread of it. A regression back to `{...record}` would make this
  // fail, since RECORD's own object identity would then appear in the
  // result.
  it("never returns the source record object itself, or an object that === it", () => {
    const { fields } = selectVisibleNotionFields(RECORD, {
      canSeeSensitiveFields: true,
    });
    expect(fields).not.toBe(RECORD);
  });

  // Requirements 2 & 3: a sensitive field cannot reach a standard-role
  // client payload, and adding a hypothetical sensitive provider field
  // does NOT automatically make it browser-visible. No real sensitive
  // field exists in NotionListingRecord yet (Michelle's lockbox/router/
  // service-provider fields are unconfirmed), so this simulates one via
  // the optional `allowlist` override — proving the actual gating logic
  // that will apply the day a real one is added, not just today's
  // (currently all-standard) allowlist contents.
  describe("simulated sensitive field (allowlist override — test-only, no production caller ever passes this)", () => {
    const FAKE_SENSITIVE_ENTRY: NotionVisibilityAllowlistEntry = {
      field: "guidebookUrl", // reuses an existing NotionListingRecord key; only its declared sensitivity is being tested here
      sensitivity: "sensitive",
      label: "Lockbox code (simulated)",
    };
    const FAKE_ALLOWLIST = [FAKE_SENSITIVE_ENTRY];

    it("excludes the simulated sensitive field for an actor without canSeeSensitiveFields", () => {
      const { fields, list } = selectVisibleNotionFields(
        RECORD,
        { canSeeSensitiveFields: false },
        FAKE_ALLOWLIST,
      );
      expect(fields).toEqual({});
      expect(list).toEqual([]);
    });

    it("includes the simulated sensitive field only for an actor WITH canSeeSensitiveFields", () => {
      const { fields, list } = selectVisibleNotionFields(
        RECORD,
        { canSeeSensitiveFields: true },
        FAKE_ALLOWLIST,
      );
      expect(fields.guidebookUrl).toBe(RECORD.guidebookUrl);
      expect(list).toHaveLength(1);
      expect(list[0]?.label).toBe("Lockbox code (simulated)");
    });

    it("a field present on the record but absent from EVERY allowlist entry never appears, regardless of role", () => {
      // Neither the fake allowlist above nor the real one gates "address"
      // in this scenario (the fake allowlist only has one entry, for
      // guidebookUrl) — proving an unlisted field stays excluded even for
      // the most-privileged actor, not just for a standard one.
      const { fields } = selectVisibleNotionFields(
        RECORD,
        { canSeeSensitiveFields: true },
        FAKE_ALLOWLIST,
      );
      expect("address" in fields).toBe(false);
      expect("name" in fields).toBe(false);
    });
  });
});
