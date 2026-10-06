import { beforeEach, describe, expect, it, vi } from "vitest";

// Real integrations.service + real notion-access.service + real config;
// only permissions and the Notion HTTP client are faked. Test data is fake
// except the real LIBRARY row ids used for classification.
const { perms, fakeClient } = vi.hoisted(() => ({
  perms: { "notion:read": false, "notion:manage": false } as Record<
    string,
    boolean
  >,
  fakeClient: {
    listDataSourceEntries: vi.fn(),
    search: vi.fn(),
    getPageContent: vi.fn(),
    getObjectParent: vi.fn(),
    getDataSourceParentDatabaseId: vi.fn(),
    listRecentlyEdited: vi.fn(),
    listDataSourceRecords: vi.fn(),
  },
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: vi.fn(
    async (_actor: unknown, key: string) => perms[key] === true,
  ),
  assertPermission: vi.fn(async (_actor: unknown, key: string) => {
    if (key.startsWith("notion:") && perms[key] !== true) {
      throw Object.assign(new Error("Forbidden"), { name: "ForbiddenError" });
    }
  }),
}));
vi.mock("@stayw/database", () => ({ prisma: {} }));
vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi.fn().mockImplementation(() => fakeClient),
}));

import { NOTION_LIBRARY_DATABASE_ID } from "../config/notion-visibility";

import {
  getNotionHighlights,
  getNotionPageContent,
  listNotionLibraryEntries,
  NOTION_PAGE_NO_ACCESS_ERROR,
  searchNotionContent,
  searchNotionLibraryContent,
} from "./integrations.service";
import { __resetNotionAccessCachesForTests } from "./notion-access.service";

const PROPERTY_DIRECTORY = "b3bb913f-4b06-44bf-b87c-a692c00f4790";
const LOCKBOXES = "ecccd45d-b3f1-4241-b050-333eca3c42d1";
const OWNER_INFO = "5a8f6661-9641-4835-a541-db6b04c44374";
const NEW_ROW = "99999999-9999-4999-8999-999999999999";
const actor = { userId: "u1" };

const entry = (id: string, title: string) => ({
  id,
  title,
  url: null,
  lastEditedTime: null,
});
const result = (
  id: string,
  title: string,
  parentPageId: string | null = null,
  sourceType = "page",
) => ({
  id,
  title,
  url: null,
  lastEditedTime: null,
  sourceType,
  parentDatabaseId: null,
  parentPageId,
});
const PARENTS: Record<string, { type: string; id: string | null }> = {
  [PROPERTY_DIRECTORY]: { type: "database", id: NOTION_LIBRARY_DATABASE_ID },
  [LOCKBOXES]: { type: "database", id: NOTION_LIBRARY_DATABASE_ID },
  "palm-haven": { type: "page", id: PROPERTY_DIRECTORY },
  "palm-haven-router": { type: "page", id: "palm-haven" },
  "lockbox-child": { type: "page", id: LOCKBOXES },
  "random-page": { type: "workspace", id: null },
};

function as(profile: "ops" | "admin" | "none") {
  perms["notion:read"] = profile !== "none";
  perms["notion:manage"] = profile === "admin";
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotionAccessCachesForTests();
  process.env.NOTION_API_KEY = "test-key";
  delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  fakeClient.listDataSourceEntries.mockResolvedValue([
    entry(PROPERTY_DIRECTORY, "Property Directory"),
    entry(LOCKBOXES, "Property Lockboxes Code"),
    entry(OWNER_INFO, "Owner Info"),
    entry(NEW_ROW, "Brand new row"),
  ]);
  fakeClient.getObjectParent.mockImplementation(
    async (_kind: string, id: string) => {
      const p = PARENTS[id];
      if (!p) throw new Error("404");
      return p;
    },
  );
  fakeClient.getPageContent.mockResolvedValue({ blocks: [], truncated: false });
});

describe("Library list", () => {
  it("ops (notion:read): standard rows only — no Lockboxes, Owner Info, or unknown new rows", async () => {
    as("ops");
    const res = await listNotionLibraryEntries(actor as never);
    expect(res.configured && res.ok && res.items.map((e) => e.title)).toEqual([
      "Property Directory",
    ]);
  });

  it("admin (notion:manage): every row", async () => {
    as("admin");
    const res = await listNotionLibraryEntries(actor as never);
    expect(res.configured && res.ok && res.items).toHaveLength(4);
  });

  it("no Notion permission: refused (never returns rows)", async () => {
    as("none");
    await expect(listNotionLibraryEntries(actor as never)).rejects.toThrow();
    expect(fakeClient.listDataSourceEntries).not.toHaveBeenCalled();
  });
});

describe("Library search", () => {
  it("ops: sensitive rows and their nested pages never match", async () => {
    as("ops");
    fakeClient.search.mockResolvedValue([
      result("palm-haven", "Palm Haven", PROPERTY_DIRECTORY),
      result("lockbox-child", "Palm Haven lockbox", LOCKBOXES),
    ]);
    const res = await searchNotionLibraryContent(actor as never, "palm");
    expect(res.configured && res.ok && res.results.map((r) => r.title)).toEqual(
      ["Palm Haven"],
    );
  });

  it("admin: sees both", async () => {
    as("admin");
    fakeClient.search.mockResolvedValue([
      result("palm-haven", "Palm Haven", PROPERTY_DIRECTORY),
      result("lockbox-child", "Palm Haven lockbox", LOCKBOXES),
    ]);
    const res = await searchNotionLibraryContent(actor as never, "palm");
    expect(res.configured && res.ok && res.results).toHaveLength(2);
  });
});

describe("Search All Notion", () => {
  const results = [
    result("palm-haven-router", "Router and Thermostat Location"),
    result("lockbox-child", "Lockbox list"),
    result("random-page", "Random workspace page"),
    result("unknown-page", "Unresolvable"),
  ];

  it("ops: only results under approved standard roots; sensitive and unknown are hidden", async () => {
    as("ops");
    fakeClient.search.mockResolvedValue(results);
    const res = await searchNotionContent(actor as never, "x");
    expect(res.configured && res.ok && res.results.map((r) => r.title)).toEqual(
      ["Router and Thermostat Location"],
    );
  });

  it("admin: everything the integration can read, with no parent lookups", async () => {
    as("admin");
    fakeClient.search.mockResolvedValue(results);
    const res = await searchNotionContent(actor as never, "x");
    expect(res.configured && res.ok && res.results).toHaveLength(4);
    expect(fakeClient.getObjectParent).not.toHaveBeenCalled();
  });
});

describe("Direct page access", () => {
  it("ops: a sensitive page is refused BEFORE its content is fetched, with a neutral message", async () => {
    as("ops");
    const res = await getNotionPageContent(actor as never, "lockbox-child");
    expect(res).toEqual({
      configured: true,
      ok: false,
      error: NOTION_PAGE_NO_ACCESS_ERROR,
    });
    expect(fakeClient.getPageContent).not.toHaveBeenCalled();
  });

  it("ops: an unknown/unresolvable page is refused (fail closed)", async () => {
    as("ops");
    const res = await getNotionPageContent(actor as never, "unknown-page");
    expect(res.configured && !res.ok).toBe(true);
    expect(fakeClient.getPageContent).not.toHaveBeenCalled();
  });

  it("ops: a standard page loads", async () => {
    as("ops");
    const res = await getNotionPageContent(actor as never, "palm-haven-router");
    expect(res.configured && res.ok).toBe(true);
    expect(fakeClient.getPageContent).toHaveBeenCalledWith("palm-haven-router");
  });

  it("admin: sensitive pages load", async () => {
    as("admin");
    const res = await getNotionPageContent(actor as never, "lockbox-child");
    expect(res.configured && res.ok).toBe(true);
  });

  it("no Notion permission: refused", async () => {
    as("none");
    await expect(
      getNotionPageContent(actor as never, "palm-haven"),
    ).rejects.toThrow();
    expect(fakeClient.getPageContent).not.toHaveBeenCalled();
  });
});

describe("Dashboard recently-edited tile", () => {
  it("ops: sensitive/unknown titles are dropped", async () => {
    as("ops");
    fakeClient.listRecentlyEdited.mockResolvedValue([
      {
        id: "lockbox-child",
        object: "page",
        title: "Lockbox list",
        url: null,
        lastEditedTime: null,
      },
      {
        id: "palm-haven",
        object: "page",
        title: "Palm Haven",
        url: null,
        lastEditedTime: null,
      },
      {
        id: "random-page",
        object: "page",
        title: "Random",
        url: null,
        lastEditedTime: null,
      },
    ]);
    const res = await getNotionHighlights(actor as never);
    expect(res.configured && res.ok && res.items.map((i) => i.title)).toEqual([
      "Palm Haven",
    ]);
  });

  it("no Notion permission: empty list, no titles", async () => {
    as("none");
    const res = await getNotionHighlights(actor as never);
    expect(res).toEqual({ configured: true, ok: true, items: [] });
    expect(fakeClient.listRecentlyEdited).not.toHaveBeenCalled();
  });
});
