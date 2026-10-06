import { describe, expect, it, vi } from "vitest";

import type { NotionParentRef } from "@stayw/integrations/notion";

import {
  libraryEntryVisibility,
  NOTION_LIBRARY_DATABASE_ID,
  NOTION_LIBRARY_ENTRY_VISIBILITY,
} from "../config/notion-visibility";

import {
  canViewNotionVisibility,
  resolveNotionVisibility,
  withCacheAndBudget,
  type NotionParentLookup,
} from "./notion-visibility";

// Real LIBRARY row ids (from the config); everything else is fake test data.
const PROPERTY_DIRECTORY = "b3bb913f-4b06-44bf-b87c-a692c00f4790";
const LOCKBOXES = "ecccd45d-b3f1-4241-b050-333eca3c42d1";
const OWNER_INFO = "5a8f6661-9641-4835-a541-db6b04c44374";
const SERVICE_PROVIDERS = "598204db-fcb1-49cd-8ab4-782846a44de5";
const SOP_ROOT = "sop-root-0000";
const LISTINGS_DB = "listings-db-0000";

const db = (id: string): NotionParentRef => ({ type: "database", id });
const page = (id: string): NotionParentRef => ({ type: "page", id });
const block = (id: string): NotionParentRef => ({ type: "block", id });
const workspace: NotionParentRef = { type: "workspace", id: null };

// Fake workspace structure (ids are fake except the LIBRARY rows above).
const PARENTS: Record<string, NotionParentRef> = {
  [`page:${PROPERTY_DIRECTORY}`]: db(NOTION_LIBRARY_DATABASE_ID),
  [`page:${LOCKBOXES}`]: db(NOTION_LIBRARY_DATABASE_ID),
  [`page:${OWNER_INFO}`]: db(NOTION_LIBRARY_DATABASE_ID),
  "page:new-library-row": db(NOTION_LIBRARY_DATABASE_ID),
  "page:palm-haven": page(PROPERTY_DIRECTORY),
  "page:palm-haven-router": page("palm-haven"),
  "page:lockbox-subpage": page(LOCKBOXES),
  "page:owner-deep": page("owner-mid"),
  "page:owner-mid": page(OWNER_INFO),
  "page:sop-vrbo": page(SOP_ROOT),
  "page:sop-in-toggle": block("toggle-1"),
  "block:toggle-1": page("sop-vrbo"),
  "page:listing-row": db(LISTINGS_DB),
  "page:random-workspace-page": workspace,
  "page:child-of-random": page("random-workspace-page"),
  "page:in-unknown-db": db("some-other-db"),
  "page:staff-contact": db("20f6058d-b989-80cf-805a-edd83b6e8540"),
};

function fakeLookup(): NotionParentLookup & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (kind, id) => {
    calls.push(`${kind}:${id}`);
    const parent = PARENTS[`${kind}:${id}`];
    if (!parent) throw new Error("404");
    return parent;
  }) as NotionParentLookup & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const roots = { sopRootPageId: SOP_ROOT, listingsDatabaseIds: [LISTINGS_DB] };
const resolve = (id: string, kind: "page" | "block" | "database" = "page") =>
  resolveNotionVisibility({ kind, id }, fakeLookup(), roots);

describe("config — LIBRARY classification", () => {
  it("Property Lockboxes Code, Owner Info and Owner's info for trash service are sensitive; Property Directory and Service Providers are standard", () => {
    expect(libraryEntryVisibility(LOCKBOXES)).toBe("sensitive");
    expect(libraryEntryVisibility(OWNER_INFO)).toBe("sensitive");
    expect(libraryEntryVisibility("a13891a9-4dc2-425c-8be0-3f9fb86587db")).toBe(
      "sensitive",
    );
    expect(libraryEntryVisibility(PROPERTY_DIRECTORY)).toBe("standard");
    expect(libraryEntryVisibility(SERVICE_PROVIDERS)).toBe("standard");
  });

  it("an unknown/new LIBRARY row is sensitive (fail closed); ids match with or without dashes", () => {
    expect(libraryEntryVisibility("00000000-0000-0000-0000-000000000000")).toBe(
      "sensitive",
    );
    expect(libraryEntryVisibility(LOCKBOXES.replace(/-/g, ""))).toBe(
      "sensitive",
    );
    expect(libraryEntryVisibility(PROPERTY_DIRECTORY.toUpperCase())).toBe(
      "standard",
    );
  });

  it("covers all 38 LIBRARY rows found on 2026-09-30, with exactly 4 sensitive", () => {
    expect(NOTION_LIBRARY_ENTRY_VISIBILITY).toHaveLength(38);
    expect(
      NOTION_LIBRARY_ENTRY_VISIBILITY.filter(
        (e) => e.visibility === "sensitive",
      ).map((e) => e.title),
    ).toEqual([
      "(untitled)",
      "Owner Info",
      "Owner's info for trash service",
      "Property Lockboxes Code",
    ]);
  });
});

describe("resolveNotionVisibility — walks to an approved root", () => {
  it("a LIBRARY row itself resolves by its own classification, with no lookup", async () => {
    const lookup = fakeLookup();
    await expect(
      resolveNotionVisibility({ kind: "page", id: LOCKBOXES }, lookup, roots),
    ).resolves.toBe("sensitive");
    expect(lookup.calls).toEqual([]);
  });

  it("nested pages inherit their LIBRARY row: Property Directory › Palm Haven › Router → standard", async () => {
    await expect(resolve("palm-haven")).resolves.toBe("standard");
    await expect(resolve("palm-haven-router")).resolves.toBe("standard");
  });

  it("anything under Lockboxes or Owner Info is sensitive, however deep", async () => {
    await expect(resolve("lockbox-subpage")).resolves.toBe("sensitive");
    await expect(resolve("owner-deep")).resolves.toBe("sensitive");
  });

  it("a new LIBRARY row (not in the config) is sensitive", async () => {
    await expect(resolve("new-library-row")).resolves.toBe("sensitive");
  });

  it("SOP pages are standard, including one nested inside a toggle block", async () => {
    await expect(resolve(SOP_ROOT)).resolves.toBe("standard");
    await expect(resolve("sop-vrbo")).resolves.toBe("standard");
    await expect(resolve("sop-in-toggle")).resolves.toBe("standard");
  });

  it("View of Listings rows are standard", async () => {
    await expect(resolve("listing-row")).resolves.toBe("standard");
    await expect(resolve(LISTINGS_DB, "database")).resolves.toBe("standard");
  });

  it("fails closed: workspace pages, unknown databases, excluded staff DBs, lookup errors → sensitive", async () => {
    await expect(resolve("random-workspace-page")).resolves.toBe("sensitive");
    await expect(resolve("child-of-random")).resolves.toBe("sensitive");
    await expect(resolve("in-unknown-db")).resolves.toBe("sensitive");
    await expect(resolve("staff-contact")).resolves.toBe("sensitive");
    await expect(resolve("does-not-exist")).resolves.toBe("sensitive");
    await expect(resolve("some-other-db", "database")).resolves.toBe(
      "sensitive",
    );
  });

  it("fails closed when listing roots are unknown (env not resolved)", async () => {
    await expect(
      resolveNotionVisibility(
        { kind: "page", id: "listing-row" },
        fakeLookup(),
        {
          sopRootPageId: SOP_ROOT,
          listingsDatabaseIds: [],
        },
      ),
    ).resolves.toBe("sensitive");
  });

  it("fails closed on a parent cycle or a chain deeper than the limit", async () => {
    const cyclic: NotionParentLookup = async (_kind, id) =>
      page(id === "a" ? "b" : "a");
    await expect(
      resolveNotionVisibility({ kind: "page", id: "a" }, cyclic, roots),
    ).resolves.toBe("sensitive");
  });
});

describe("canViewNotionVisibility", () => {
  it("standard needs notion:read (or manage); sensitive needs notion:manage", () => {
    expect(
      canViewNotionVisibility("standard", {
        canReadStandard: true,
        canReadSensitive: false,
      }),
    ).toBe(true);
    expect(
      canViewNotionVisibility("sensitive", {
        canReadStandard: true,
        canReadSensitive: false,
      }),
    ).toBe(false);
    expect(
      canViewNotionVisibility("sensitive", {
        canReadStandard: false,
        canReadSensitive: true,
      }),
    ).toBe(true);
    expect(
      canViewNotionVisibility("standard", {
        canReadStandard: false,
        canReadSensitive: false,
      }),
    ).toBe(false);
  });
});

describe("withCacheAndBudget", () => {
  it("caches parents and stops at the budget — the resolver then fails closed", async () => {
    const inner = vi.fn(async () => page(PROPERTY_DIRECTORY));
    const cache = new Map();
    const lookup = withCacheAndBudget(inner, cache, {
      maxCalls: 1,
      ttlMs: 60_000,
    });
    await lookup("page", "x");
    await lookup("page", "x"); // cached
    expect(inner).toHaveBeenCalledTimes(1);
    await expect(lookup("page", "y")).rejects.toThrow(/budget/);
    await expect(
      resolveNotionVisibility({ kind: "page", id: "y" }, lookup, roots),
    ).resolves.toBe("sensitive");
  });

  it("expires cache entries after the TTL", async () => {
    let now = 0;
    const inner = vi.fn(async () => workspace);
    const lookup = withCacheAndBudget(inner, new Map(), {
      maxCalls: 5,
      ttlMs: 100,
      now: () => now,
    });
    await lookup("page", "x");
    now = 150;
    await lookup("page", "x");
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
