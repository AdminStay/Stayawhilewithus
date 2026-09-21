import { describe, expect, it, vi } from "vitest";

const mockRequest = vi.fn();
const mockHttpClientConstructor = vi.fn();

vi.mock("../core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core")>();
  return {
    ...actual,
    HttpClient: class MockHttpClient {
      constructor(opts: unknown) {
        mockHttpClientConstructor(opts);
      }
      request = mockRequest;
    },
  };
});

import { NotionClient } from "./client";

const credentials = { token: "secret_test" };

describe("NotionClient", () => {
  it("declares only the sync capability for the NOTION provider", () => {
    const client = new NotionClient(credentials);

    expect(client.provider).toBe("NOTION");
    expect(client.capabilities).toEqual(["sync"]);
  });

  it("constructs its HttpClient with the stable default Notion-Version (2022-06-28) — queryDataSource()'s newer version is a per-call override only, never this default", () => {
    new NotionClient(credentials);

    expect(mockHttpClientConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ "Notion-Version": "2022-06-28" }),
      }),
    );
  });

  it("connect() calls /users/me and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce({ id: "u1" });
    const client = new NotionClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith("/users/me");
    expect(result.connected).toBe(true);
  });

  it("validateCredentials() returns invalid with a reason when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 401"));
    const client = new NotionClient(credentials);

    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "Request failed with 401" });
  });

  it("sync(INBOUND) searches and reports the result count, without writing anything", async () => {
    mockRequest.mockResolvedValueOnce({
      results: [
        { id: "p1", object: "page" },
        { id: "p2", object: "page" },
      ],
      has_more: false,
      next_cursor: null,
    });
    const client = new NotionClient(credentials);

    const result = await client.sync("INBOUND");

    expect(mockRequest).toHaveBeenCalledWith("/search", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(result).toEqual({ recordsProcessed: 2, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — no write target is designed yet", async () => {
    const client = new NotionClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  describe("listRecentlyEdited", () => {
    it("extracts a database's title from its top-level title array", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "db1",
            object: "database",
            url: "https://notion.so/db1",
            last_edited_time: "2026-08-01T00:00:00.000Z",
            title: [{ plain_text: "Cleaning " }, { plain_text: "Schedule" }],
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const result = await client.listRecentlyEdited();

      expect(mockRequest).toHaveBeenCalledWith("/search", {
        method: "POST",
        body: JSON.stringify({
          page_size: 5,
          sort: { direction: "descending", timestamp: "last_edited_time" },
        }),
      });
      expect(result).toEqual([
        {
          id: "db1",
          object: "database",
          title: "Cleaning Schedule",
          url: "https://notion.so/db1",
          lastEditedTime: "2026-08-01T00:00:00.000Z",
        },
      ]);
    });

    it("extracts a page's title from whichever property has type 'title'", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "p1",
            object: "page",
            url: "https://notion.so/p1",
            last_edited_time: "2026-08-02T00:00:00.000Z",
            properties: {
              Status: { type: "status" },
              Name: {
                type: "title",
                title: [{ plain_text: "Onboarding checklist" }],
              },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const result = await client.listRecentlyEdited();

      expect(result[0]).toEqual(
        expect.objectContaining({ title: "Onboarding checklist" }),
      );
    });

    it("falls back to a generic label instead of inventing a title when none is extractable", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [{ id: "p2", object: "page" }],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const result = await client.listRecentlyEdited();

      expect(result[0]).toEqual(
        expect.objectContaining({
          title: "(untitled page)",
          url: null,
          lastEditedTime: null,
        }),
      );
    });
  });

  describe("search", () => {
    it("sends a bare /search request with no query field when none is given", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await client.search();

      expect(mockRequest).toHaveBeenCalledWith("/search", {
        method: "POST",
        body: JSON.stringify({ page_size: 50 }),
      });
    });

    it("includes the query string when one is given", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await client.search({ query: "guidebook" });

      expect(mockRequest).toHaveBeenCalledWith("/search", {
        method: "POST",
        body: JSON.stringify({ page_size: 50, query: "guidebook" }),
      });
    });

    it("labels a database object as sourceType 'database'", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "db1",
            object: "database",
            url: "https://notion.so/db1",
            last_edited_time: "2026-08-01T00:00:00.000Z",
            title: [{ plain_text: "View of Listings" }],
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [result] = await client.search();

      expect(result).toEqual({
        id: "db1",
        title: "View of Listings",
        url: "https://notion.so/db1",
        lastEditedTime: "2026-08-01T00:00:00.000Z",
        sourceType: "database",
        parentDatabaseId: null,
      });
    });

    it("labels a page whose parent is a database as sourceType 'database_row' and captures its parentDatabaseId", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "row1",
            object: "page",
            parent: { type: "database_id", database_id: "db1" },
            properties: {
              Name: { type: "title", title: [{ plain_text: "Aqua Palm" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [result] = await client.search();

      expect(result?.sourceType).toBe("database_row");
      expect(result?.parentDatabaseId).toBe("db1");
    });

    it("leaves parentDatabaseId null for a plain page — never guessed from anything else", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "page1",
            object: "page",
            parent: { type: "workspace" },
            properties: {
              Name: { type: "title", title: [{ plain_text: "Cleaning SOP" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [result] = await client.search();

      expect(result?.parentDatabaseId).toBeNull();
    });

    it("labels a page whose parent is a page or the workspace as sourceType 'page'", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "page1",
            object: "page",
            parent: { type: "workspace" },
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Cleaning SOP" }],
              },
            },
          },
          {
            id: "page2",
            object: "page",
            parent: { type: "page_id", page_id: "parent-page" },
            properties: {
              Name: { type: "title", title: [{ plain_text: "Sub-page" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const results = await client.search();

      expect(results[0]?.sourceType).toBe("page");
      expect(results[1]?.sourceType).toBe("page");
    });

    it("follows next_cursor across multiple pages, accumulating results", async () => {
      mockRequest
        .mockResolvedValueOnce({
          results: [{ id: "p1", object: "page" }],
          has_more: true,
          next_cursor: "cursor-a",
        })
        .mockResolvedValueOnce({
          results: [{ id: "p2", object: "page" }],
          has_more: false,
          next_cursor: null,
        });
      const client = new NotionClient(credentials);

      const results = await client.search();

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/search", {
        method: "POST",
        body: JSON.stringify({ page_size: 50, start_cursor: "cursor-a" }),
      });
      expect(results.map((r) => r.id)).toEqual(["p1", "p2"]);
    });

    it("rejects a repeated pagination cursor instead of looping forever", async () => {
      mockRequest
        .mockResolvedValueOnce({
          results: [{ id: "p1", object: "page" }],
          has_more: true,
          next_cursor: "cursor-a",
        })
        .mockResolvedValueOnce({
          results: [{ id: "p2", object: "page" }],
          has_more: true,
          next_cursor: "cursor-a",
        });
      const client = new NotionClient(credentials);

      await expect(client.search()).rejects.toThrow(
        /repeated pagination cursor/,
      );
    });

    it("rejects has_more: true with a missing next_cursor instead of silently truncating", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [{ id: "p1", object: "page" }],
        has_more: true,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await expect(client.search()).rejects.toThrow(
        /refusing to silently truncate/,
      );
    });

    it("respects a caller-supplied maxPages instead of always using the default cap", async () => {
      let n = 0;
      mockRequest.mockImplementation(async () => {
        n += 1;
        return {
          results: [{ id: `p${n}`, object: "page" }],
          has_more: true,
          next_cursor: `cursor-${n}`,
        };
      });
      const client = new NotionClient(credentials);

      await expect(client.search({ maxPages: 2 })).rejects.toThrow(
        /exceeded the maximum of 2 pages/,
      );
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("makes only bare POST /search requests — no create/update/delete/archive call is ever introduced", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await client.search({ query: "anything" });

      for (const call of mockRequest.mock.calls) {
        const [path, init] = call as [string, { method: string }];
        expect(path).toBe("/search");
        expect(init.method).toBe("POST");
      }
    });
  });

  describe("queryDataSource", () => {
    it("queries the given data source with a per-request Notion-Version override, requesting only the given page size", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "row1",
            object: "page",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Aqua Palm" }] },
            },
          },
        ],
        has_more: true,
        next_cursor: "abc",
      });
      const client = new NotionClient(credentials);

      const result = await client.queryDataSource("ds-123", 1);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith("/data_sources/ds-123/query", {
        method: "POST",
        headers: { "Notion-Version": "2026-03-11" },
        body: JSON.stringify({ page_size: 1 }),
      });
      expect(result).toEqual({ resultCount: 1, firstTitle: "Aqua Palm" });
    });

    it("makes exactly one request and never any create/update/delete/archive call — read-only by construction", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await client.queryDataSource("ds-123", 1);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [, init] = mockRequest.mock.calls[0] as [
        string,
        { method: string },
      ];
      expect(init.method).toBe("POST");
      expect(init.method).not.toBe("PATCH");
      expect(init.method).not.toBe("DELETE");
    });

    it("defaults to page_size 1 when not given", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await client.queryDataSource("ds-123");

      expect(mockRequest).toHaveBeenCalledWith(
        "/data_sources/ds-123/query",
        expect.objectContaining({ body: JSON.stringify({ page_size: 1 }) }),
      );
    });

    it("reports zero results and a null title without throwing when the data source is empty", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const result = await client.queryDataSource("ds-123", 1);

      expect(result).toEqual({ resultCount: 0, firstTitle: null });
    });

    it("propagates the request error untouched (e.g. 404 for not-shared-or-invalid, 401 for bad token, 400 for a version mismatch) rather than swallowing it", async () => {
      mockRequest.mockRejectedValueOnce(
        new Error("Request to /data_sources/ds-123/query failed with 404"),
      );
      const client = new NotionClient(credentials);

      await expect(client.queryDataSource("ds-123", 1)).rejects.toThrow(
        "failed with 404",
      );
    });
  });

  describe("listDataSourceRecords", () => {
    function row(id: string, overrides: Record<string, unknown> = {}) {
      return {
        id,
        url: `https://notion.so/${id}`,
        properties: {
          Name: { type: "title", title: [{ plain_text: `Listing ${id}` }] },
          Address: {
            type: "rich_text",
            rich_text: [{ plain_text: "123 Main St" }],
          },
          "Number of Guests": { type: "number", number: 4 },
          Bathrooms: { type: "number", number: 2 },
          Bedrooms: { type: "number", number: 3 },
          "Direct booking": {
            type: "rich_text",
            rich_text: [{ plain_text: "Book direct" }],
          },
          "Airbnb Link": {
            type: "rich_text",
            rich_text: [{ plain_text: "https://airbnb.com/x" }],
          },
          "VRBO Link": {
            type: "rich_text",
            rich_text: [{ plain_text: "https://vrbo.com/x" }],
          },
          "Google Drive Photos": {
            type: "url",
            url: "https://drive.google.com/x",
          },
          Guidebook: { type: "url", url: "https://guidebook.example/x" },
          ...overrides,
        },
      };
    }

    it("retrieves a single page in one request", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1")],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const records = await client.listDataSourceRecords("ds-123");

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith("/data_sources/ds-123/query", {
        method: "POST",
        headers: { "Notion-Version": "2026-03-11" },
        body: JSON.stringify({ page_size: 100 }),
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        id: "1",
        url: "https://notion.so/1",
        name: "Listing 1",
        address: "123 Main St",
        bedrooms: 3,
        bathrooms: 2,
        guests: 4,
        directBooking: "Book direct",
        airbnbLink: "https://airbnb.com/x",
        vrboLink: "https://vrbo.com/x",
        googleDrivePhotosUrl: "https://drive.google.com/x",
        guidebookUrl: "https://guidebook.example/x",
        lastEditedTime: null,
      });
    });

    it("follows next_cursor across multiple pages, accumulating rows from every page", async () => {
      mockRequest
        .mockResolvedValueOnce({
          results: [row("1")],
          has_more: true,
          next_cursor: "cursor-a",
        })
        .mockResolvedValueOnce({
          results: [row("2")],
          has_more: false,
          next_cursor: null,
        });
      const client = new NotionClient(credentials);

      const records = await client.listDataSourceRecords("ds-123");

      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/data_sources/ds-123/query",
        {
          method: "POST",
          headers: { "Notion-Version": "2026-03-11" },
          body: JSON.stringify({ page_size: 100, start_cursor: "cursor-a" }),
        },
      );
      expect(records.map((r) => r.id)).toEqual(["1", "2"]);
    });

    it("rejects a repeated pagination cursor instead of looping forever", async () => {
      mockRequest
        .mockResolvedValueOnce({
          results: [row("1")],
          has_more: true,
          next_cursor: "cursor-a",
        })
        .mockResolvedValueOnce({
          results: [row("2")],
          has_more: true,
          next_cursor: "cursor-a", // same cursor again — a well-behaved API never does this
        });
      const client = new NotionClient(credentials);

      await expect(client.listDataSourceRecords("ds-123")).rejects.toThrow(
        /repeated pagination cursor/,
      );
    });

    it("rejects has_more: true with a missing next_cursor instead of silently truncating", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1")],
        has_more: true,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      await expect(client.listDataSourceRecords("ds-123")).rejects.toThrow(
        /refusing to silently truncate/,
      );
    });

    it("enforces a hard maximum page count instead of looping forever on ever-changing cursors", async () => {
      let n = 0;
      mockRequest.mockImplementation(async () => {
        n += 1;
        return {
          results: [row(String(n))],
          has_more: true,
          next_cursor: `cursor-${n}`,
        };
      });
      const client = new NotionClient(credentials);

      await expect(client.listDataSourceRecords("ds-123")).rejects.toThrow(
        /exceeded the maximum of 50 pages/,
      );
    });

    it("maps nullable/missing properties to null instead of throwing", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          {
            id: "1",
            url: null,
            properties: {
              Name: { type: "title", title: [{ plain_text: "Bare Listing" }] },
              // every other property omitted entirely
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record).toEqual({
        id: "1",
        url: null,
        name: "Bare Listing",
        address: null,
        bedrooms: null,
        bathrooms: null,
        guests: null,
        directBooking: null,
        airbnbLink: null,
        vrboLink: null,
        googleDrivePhotosUrl: null,
        guidebookUrl: null,
        lastEditedTime: null,
      });
    });

    it("concatenates multi-run rich_text values rather than taking only the first run", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          row("1", {
            Address: {
              type: "rich_text",
              rich_text: [
                { plain_text: "123 Main St, " },
                { plain_text: "Suite 4" },
              ],
            },
          }),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.address).toBe("123 Main St, Suite 4");
    });

    it("extracts a null number value without coercing it to zero", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1", { Bedrooms: { type: "number", number: null } })],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.bedrooms).toBeNull();
    });

    it("falls back to a generic label instead of inventing a name when Name is empty", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1", { Name: { type: "title", title: [] } })],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.name).toBe("(untitled listing)");
    });

    it("ignores an entirely missing properties object instead of throwing", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [{ id: "1", url: "https://notion.so/1" }], // no `properties` key at all
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const records = await client.listDataSourceRecords("ds-123");

      expect(records).toEqual([
        {
          id: "1",
          url: "https://notion.so/1",
          name: "(untitled listing)",
          address: null,
          bedrooms: null,
          bathrooms: null,
          guests: null,
          directBooking: null,
          airbnbLink: null,
          vrboLink: null,
          googleDrivePhotosUrl: null,
          guidebookUrl: null,
          lastEditedTime: null,
        },
      ]);
    });

    it("ignores an unexpected/unmodeled property type on a known field instead of throwing", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          row("1", {
            // A future Notion schema change: Address is now `select`, a
            // type this client doesn't model — must resolve to null, not
            // crash the whole row.
            Address: { type: "select", select: { name: "Downtown" } },
          }),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.address).toBeNull();
    });

    it("ignores a completely unrecognized property present on the row without affecting known fields", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          row("1", {
            // A brand-new column this client has never heard of.
            "Cleaning Notes": {
              type: "rich_text",
              rich_text: [{ plain_text: "Extra towels" }],
            },
          }),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record).not.toHaveProperty("Cleaning Notes");
      expect(record?.name).toBe("Listing 1"); // known fields unaffected
    });

    it("falls back to null for a malformed rich_text property (type matches but the array is missing)", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          row("1", {
            Address: { type: "rich_text" }, // missing `rich_text` array entirely
          }),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.address).toBeNull();
    });

    it("falls back to null for a malformed number property (type matches but the value isn't numeric)", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1", { Bedrooms: { type: "number", number: "three" } })],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.bedrooms).toBeNull();
    });

    it("falls back to null when a known field's raw value is a primitive, not an object", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          row("1", { Address: "just a string, not a Notion property object" }),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.address).toBeNull();
    });

    it("falls back to null when a known field's raw value is null", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [row("1", { Address: null })],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const [record] = await client.listDataSourceRecords("ds-123");

      expect(record?.address).toBeNull();
    });

    it("one malformed row does not prevent other rows in the same page from being returned", async () => {
      mockRequest.mockResolvedValueOnce({
        results: [
          { id: "bad", url: null, properties: "not even an object" },
          row("2"),
        ],
        has_more: false,
        next_cursor: null,
      });
      const client = new NotionClient(credentials);

      const records = await client.listDataSourceRecords("ds-123");

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual(
        expect.objectContaining({ id: "bad", name: "(untitled listing)" }),
      );
      expect(records[1]).toEqual(
        expect.objectContaining({ id: "2", name: "Listing 2" }),
      );
    });

    it("makes only bare POST .../query requests — no create/update/delete/archive call is ever introduced", async () => {
      mockRequest
        .mockResolvedValueOnce({
          results: [row("1")],
          has_more: true,
          next_cursor: "cursor-a",
        })
        .mockResolvedValueOnce({
          results: [row("2")],
          has_more: false,
          next_cursor: null,
        });
      const client = new NotionClient(credentials);

      await client.listDataSourceRecords("ds-123");

      for (const call of mockRequest.mock.calls) {
        const [path, init] = call as [string, { method: string }];
        expect(path).toBe("/data_sources/ds-123/query");
        expect(init.method).toBe("POST");
      }
    });
  });

  describe("updatePageProperty", () => {
    it("reads the page first, then PATCHes using Notion's OWN current property type — never the caller's assumption", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Notes: { type: "rich_text" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      const result = await client.updatePageProperty(
        "page-1",
        "Notes",
        "New note text",
      );

      expect(mockRequest).toHaveBeenNthCalledWith(1, "/pages/page-1");
      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            Notes: {
              rich_text: [{ type: "text", text: { content: "New note text" } }],
            },
          },
        }),
      });
      expect(result).toEqual({ lastEditedTime: "2026-09-22T00:00:00.000Z" });
    });

    it("writes an empty rich_text array for an empty string, never a one-item array with empty content", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Notes: { type: "rich_text" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Notes", "");

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({ properties: { Notes: { rich_text: [] } } }),
      });
    });

    it("shapes a url property as a bare url string", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Guidebook: { type: "url" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty(
        "page-1",
        "Guidebook",
        "https://example.com/guide",
      );

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({
          properties: { Guidebook: { url: "https://example.com/guide" } },
        }),
      });
    });

    it("shapes a number property as a bare number", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Bedrooms: { type: "number" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Bedrooms", 4);

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({ properties: { Bedrooms: { number: 4 } } }),
      });
    });

    it("shapes a checkbox property as a bare boolean", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Active: { type: "checkbox" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Active", true);

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({ properties: { Active: { checkbox: true } } }),
      });
    });

    it("shapes a date property as { start }", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { "Move-in": { type: "date" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Move-in", "2026-10-01");

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({
          properties: { "Move-in": { date: { start: "2026-10-01" } } },
        }),
      });
    });

    it("shapes a select property as { name }", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Status: { type: "select" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Status", "Active");

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({
          properties: { Status: { select: { name: "Active" } } },
        }),
      });
    });

    it("shapes a multi_select property as an array of { name }", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Tags: { type: "multi_select" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Tags", ["A", "B"]);

      expect(mockRequest).toHaveBeenNthCalledWith(2, "/pages/page-1", {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            Tags: { multi_select: [{ name: "A" }, { name: "B" }] },
          },
        }),
      });
    });

    it("refuses to guess and throws when the property doesn't exist on the page — never falls back to a default type", async () => {
      mockRequest.mockResolvedValueOnce({
        id: "page-1",
        properties: { Notes: { type: "rich_text" } },
      });
      const client = new NotionClient(credentials);

      await expect(
        client.updatePageProperty("page-1", "NotARealField", "x"),
      ).rejects.toThrow(/has no property named "NotARealField"/);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("throws rather than guessing a shape for an unsupported/unrecognized Notion property type", async () => {
      mockRequest.mockResolvedValueOnce({
        id: "page-1",
        properties: { Owner: { type: "people" } },
      });
      const client = new NotionClient(credentials);

      await expect(
        client.updatePageProperty("page-1", "Owner", "someone"),
      ).rejects.toThrow(/property type "people" is not supported/);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("never puts the credential token anywhere in the PATCH request body", async () => {
      mockRequest
        .mockResolvedValueOnce({
          id: "page-1",
          properties: { Notes: { type: "rich_text" } },
        })
        .mockResolvedValueOnce({
          last_edited_time: "2026-09-22T00:00:00.000Z",
        });
      const client = new NotionClient(credentials);

      await client.updatePageProperty("page-1", "Notes", "hello");

      const patchCall = mockRequest.mock.calls[1] as [string, { body: string }];
      expect(patchCall[1].body).not.toContain(credentials.token);
    });
  });

  describe("getPageContent", () => {
    function page(
      results: Record<string, unknown>[],
      hasMore = false,
      nextCursor: string | null = null,
    ) {
      return { results, has_more: hasMore, next_cursor: nextCursor };
    }

    it("reads a page's real body content — reading it with a single GET to /blocks/{pageId}/children", async () => {
      mockRequest.mockResolvedValueOnce(
        page([
          {
            id: "b1",
            type: "heading_2",
            has_children: false,
            heading_2: { rich_text: [{ plain_text: "Booking Steps" }] },
          },
          {
            id: "b2",
            type: "paragraph",
            has_children: false,
            paragraph: {
              rich_text: [
                { plain_text: "Call the guest.", annotations: { bold: true } },
              ],
            },
          },
          {
            id: "b3",
            type: "callout",
            has_children: false,
            callout: {
              rich_text: [{ plain_text: "Never share the door code by text." }],
              icon: { type: "emoji", emoji: "⚠️" },
            },
          },
        ]),
      );
      const client = new NotionClient(credentials);

      const result = await client.getPageContent("page-1");

      expect(mockRequest).toHaveBeenCalledWith(
        "/blocks/page-1/children?page_size=100",
      );
      expect(result).toEqual({
        truncated: false,
        blocks: [
          {
            id: "b1",
            type: "heading_2",
            text: [
              {
                text: "Booking Steps",
                href: null,
                bold: false,
                italic: false,
                code: false,
              },
            ],
            children: [],
          },
          {
            id: "b2",
            type: "paragraph",
            text: [
              {
                text: "Call the guest.",
                href: null,
                bold: true,
                italic: false,
                code: false,
              },
            ],
            children: [],
          },
          {
            id: "b3",
            type: "callout",
            text: [
              {
                text: "Never share the door code by text.",
                href: null,
                bold: false,
                italic: false,
                code: false,
              },
            ],
            icon: "⚠️",
            children: [],
          },
        ],
      });
    });

    it("maps bulleted_list_item and numbered_list_item blocks", async () => {
      mockRequest.mockResolvedValueOnce(
        page([
          {
            id: "b1",
            type: "bulleted_list_item",
            has_children: false,
            bulleted_list_item: {
              rich_text: [{ plain_text: "Lock the door" }],
            },
          },
          {
            id: "b2",
            type: "numbered_list_item",
            has_children: false,
            numbered_list_item: {
              rich_text: [{ plain_text: "Turn off lights" }],
            },
          },
        ]),
      );
      const client = new NotionClient(credentials);

      const { blocks } = await client.getPageContent("page-1");

      expect(blocks[0]).toEqual(
        expect.objectContaining({ type: "bulleted_list_item" }),
      );
      expect(blocks[1]).toEqual(
        expect.objectContaining({ type: "numbered_list_item" }),
      );
    });

    it("fetches a toggle's nested children as a real recursive read, not invented content", async () => {
      mockRequest
        .mockResolvedValueOnce(
          page([
            {
              id: "toggle-1",
              type: "toggle",
              has_children: true,
              toggle: { rich_text: [{ plain_text: "Advanced steps" }] },
            },
          ]),
        )
        .mockResolvedValueOnce(
          page([
            {
              id: "child-1",
              type: "paragraph",
              has_children: false,
              paragraph: { rich_text: [{ plain_text: "Nested instruction" }] },
            },
          ]),
        );
      const client = new NotionClient(credentials);

      const { blocks } = await client.getPageContent("page-1");

      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/blocks/toggle-1/children?page_size=100",
      );
      expect(blocks[0]).toMatchObject({
        type: "toggle",
        children: [
          expect.objectContaining({
            type: "paragraph",
            text: [
              {
                text: "Nested instruction",
                href: null,
                bold: false,
                italic: false,
                code: false,
              },
            ],
          }),
        ],
      });
    });

    it("renders a table's rows from its children, reading cells inline rather than recursing into each row", async () => {
      mockRequest
        .mockResolvedValueOnce(
          page([
            {
              id: "table-1",
              type: "table",
              has_children: true,
              table: {
                table_width: 2,
                has_column_header: true,
                has_row_header: false,
              },
            },
          ]),
        )
        .mockResolvedValueOnce(
          page([
            {
              id: "row-1",
              type: "table_row",
              has_children: false,
              table_row: {
                cells: [
                  [{ plain_text: "Property" }],
                  [{ plain_text: "Lockbox code" }],
                ],
              },
            },
          ]),
        );
      const client = new NotionClient(credentials);

      const { blocks } = await client.getPageContent("page-1");

      expect(blocks[0]).toEqual({
        id: "table-1",
        type: "table",
        tableWidth: 2,
        hasColumnHeader: true,
        hasRowHeader: false,
        rows: [
          {
            id: "row-1",
            cells: [
              [
                {
                  text: "Property",
                  href: null,
                  bold: false,
                  italic: false,
                  code: false,
                },
              ],
              [
                {
                  text: "Lockbox code",
                  href: null,
                  bold: false,
                  italic: false,
                  code: false,
                },
              ],
            ],
          },
        ],
      });
    });

    it("maps an unsupported block type to a safe fallback and never fetches its children even if has_children is true", async () => {
      mockRequest.mockResolvedValueOnce(
        page([{ id: "img-1", type: "image", has_children: true, image: {} }]),
      );
      const client = new NotionClient(credentials);

      const { blocks } = await client.getPageContent("page-1");

      expect(blocks).toEqual([
        { id: "img-1", type: "unsupported", originalType: "image" },
      ]);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("returns an empty block list, not an error, for an empty page", async () => {
      mockRequest.mockResolvedValueOnce(page([]));
      const client = new NotionClient(credentials);

      const result = await client.getPageContent("page-1");

      expect(result).toEqual({ blocks: [], truncated: false });
    });

    it("propagates a real read failure (e.g. 404/401) untouched rather than swallowing it", async () => {
      mockRequest.mockRejectedValueOnce(
        new Error("Request to /blocks/page-1/children failed with 404"),
      );
      const client = new NotionClient(credentials);

      await expect(client.getPageContent("page-1")).rejects.toThrow(
        "failed with 404",
      );
    });

    it("stops recursing and reports truncated:true past the max nesting depth, instead of guessing or looping forever", async () => {
      // Every level returns one toggle block with a child, forever — a real
      // pathological/cyclical-looking structure. The depth cap must stop
      // this deterministically at MAX_BLOCK_TREE_DEPTH, not rely on the
      // per-parent-page cap or the call budget to eventually kick in.
      let depth = 0;
      mockRequest.mockImplementation(async () => {
        depth += 1;
        return page([
          {
            id: `toggle-${depth}`,
            type: "toggle",
            has_children: true,
            toggle: { rich_text: [{ plain_text: `Level ${depth}` }] },
          },
        ]);
      });
      const client = new NotionClient(credentials);

      const result = await client.getPageContent("page-1");

      expect(result.truncated).toBe(true);
      // depth 0 (page itself) + 4 nested fetches = 5 total requests, then
      // the 5th-level toggle's own children are never fetched.
      expect(mockRequest).toHaveBeenCalledTimes(5);
    });

    it("never issues anything but a GET-style read — no create/update/delete/archive call is introduced", async () => {
      mockRequest.mockResolvedValueOnce(page([]));
      const client = new NotionClient(credentials);

      await client.getPageContent("page-1");

      for (const call of mockRequest.mock.calls) {
        const [path, init] = call as [string, { method?: string } | undefined];
        expect(path).toMatch(/^\/blocks\//);
        expect(init).toBeUndefined();
      }
    });
  });
});
