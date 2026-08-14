import { describe, expect, it, vi } from "vitest";

const mockRequest = vi.fn();

vi.mock("../core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core")>();
  return {
    ...actual,
    HttpClient: class MockHttpClient {
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
});
