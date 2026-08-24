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
});
