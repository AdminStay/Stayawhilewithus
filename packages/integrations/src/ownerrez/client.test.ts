import { afterEach, describe, expect, it, vi } from "vitest";

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

import { OwnerrezClient } from "./client";

const credentials = { username: "stayW", token: "sk-ownerrez-test" };

describe("OwnerrezClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares sync + webhook capabilities for the OWNERREZ provider", () => {
    const client = new OwnerrezClient(credentials);

    expect(client.provider).toBe("OWNERREZ");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("connect() calls /properties and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce({ items: [] });
    const client = new OwnerrezClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith("/properties?page_size=1");
    expect(result.connected).toBe(true);
    expect(result.connectedAt).toBeInstanceOf(Date);
  });

  it("validateCredentials() returns invalid with a reason when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 401"));
    const client = new OwnerrezClient(credentials);

    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "Request failed with 401" });
  });

  it("healthCheck() returns unhealthy with details when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("timeout"));
    const client = new OwnerrezClient(credentials);

    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details).toBe("timeout");
  });

  describe("listProperties", () => {
    it("fetches active=true and active=false separately and merges the results", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url: null,
        })
        .mockResolvedValueOnce({
          items: [{ id: 2, name: "Cabin B", key: "cabin-b", active: false }],
          next_page_url: null,
        });
      const client = new OwnerrezClient(credentials);

      const properties = await client.listProperties();

      expect(mockRequest).toHaveBeenNthCalledWith(1, "/properties?active=true");
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/properties?active=false",
      );
      expect(properties).toEqual([
        { id: 1, name: "Cabin A", key: "cabin-a", active: true },
        { id: 2, name: "Cabin B", key: "cabin-b", active: false },
      ]);
    });

    it("follows next_page_url across multiple pages for the active=true set", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url:
            "https://api.ownerreservations.com/v2/properties?active=true&offset=20",
        })
        .mockResolvedValueOnce({
          items: [{ id: 2, name: "Cabin B", key: "cabin-b", active: true }],
          next_page_url: null,
        })
        .mockResolvedValueOnce({ items: [], next_page_url: null }); // active=false
      const client = new OwnerrezClient(credentials);

      const properties = await client.listProperties();

      expect(mockRequest).toHaveBeenNthCalledWith(1, "/properties?active=true");
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/properties?active=true&offset=20",
      );
      expect(mockRequest).toHaveBeenNthCalledWith(
        3,
        "/properties?active=false",
      );
      expect(properties).toEqual([
        { id: 1, name: "Cabin A", key: "cabin-a", active: true },
        { id: 2, name: "Cabin B", key: "cabin-b", active: true },
      ]);
    });

    it("follows next_page_url across multiple pages for the active=false set", async () => {
      mockRequest
        .mockResolvedValueOnce({ items: [], next_page_url: null }) // active=true
        .mockResolvedValueOnce({
          items: [{ id: 3, name: "Cabin C", key: "cabin-c", active: false }],
          next_page_url: "/v2/properties?active=false&offset=20",
        })
        .mockResolvedValueOnce({
          items: [{ id: 4, name: "Cabin D", key: "cabin-d", active: false }],
          next_page_url: null,
        });
      const client = new OwnerrezClient(credentials);

      const properties = await client.listProperties();

      expect(mockRequest).toHaveBeenNthCalledWith(
        3,
        "/properties?active=false&offset=20",
      );
      expect(properties).toEqual([
        { id: 3, name: "Cabin C", key: "cabin-c", active: false },
        { id: 4, name: "Cabin D", key: "cabin-d", active: false },
      ]);
    });

    it("dedupes by id when the same property id appears in both active and inactive results", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url: null,
        })
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: false }],
          next_page_url: null,
        });
      const client = new OwnerrezClient(credentials);

      const properties = await client.listProperties();

      expect(properties).toHaveLength(1);
    });

    it("resolves a root-relative next_page_url against OwnerRez's own host", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url: "/v2/properties?active=true&offset=20",
        })
        .mockResolvedValueOnce({ items: [], next_page_url: null })
        .mockResolvedValueOnce({ items: [], next_page_url: null }); // active=false
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).resolves.toBeDefined();
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/properties?active=true&offset=20",
      );
    });

    it("resolves a valid absolute OwnerRez next_page_url", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url:
            "https://api.ownerreservations.com/v2/properties?active=true&offset=20",
        })
        .mockResolvedValueOnce({ items: [], next_page_url: null })
        .mockResolvedValueOnce({ items: [], next_page_url: null }); // active=false
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).resolves.toBeDefined();
      expect(mockRequest).toHaveBeenNthCalledWith(
        2,
        "/properties?active=true&offset=20",
      );
    });

    it("rejects a next_page_url pointing at a foreign host", async () => {
      mockRequest.mockResolvedValueOnce({
        items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
        next_page_url: "https://evil.example.com/v2/properties?offset=20",
      });
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).rejects.toThrow(/unexpected host/);
    });

    it("rejects a next_page_url pointing outside the expected endpoint path", async () => {
      mockRequest.mockResolvedValueOnce({
        items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
        next_page_url:
          "https://api.ownerreservations.com/v2/bookings?offset=20",
      });
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).rejects.toThrow(/unexpected path/);
    });

    it("rejects a repeated pagination URL instead of looping forever", async () => {
      const repeatingUrl =
        "https://api.ownerreservations.com/v2/properties?active=true&offset=20";
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url: repeatingUrl,
        })
        .mockResolvedValueOnce({
          items: [{ id: 2, name: "Cabin B", key: "cabin-b", active: true }],
          next_page_url: repeatingUrl, // same URL again — a well-behaved API never does this
        });
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).rejects.toThrow(
        /repeated pagination URL/,
      );
    });

    it("enforces a hard maximum page count instead of looping forever on ever-changing URLs", async () => {
      let offset = 0;
      mockRequest.mockImplementation(async () => {
        offset += 20;
        return {
          items: [
            {
              id: offset,
              name: `Cabin ${offset}`,
              key: `cabin-${offset}`,
              active: true,
            },
          ],
          next_page_url: `https://api.ownerreservations.com/v2/properties?active=true&offset=${offset}`,
        };
      });
      const client = new OwnerrezClient(credentials);

      await expect(client.listProperties()).rejects.toThrow(
        /exceeded the maximum of 50 pages/,
      );
    });

    it("introduces no mutation/write calls — every request is a bare GET with no init argument", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
          next_page_url: null,
        })
        .mockResolvedValueOnce({
          items: [{ id: 2, name: "Cabin B", key: "cabin-b", active: false }],
          next_page_url: null,
        });
      const client = new OwnerrezClient(credentials);

      await client.listProperties();

      for (const call of mockRequest.mock.calls) {
        expect(call).toHaveLength(1);
      }
    });
  });

  describe("listBookings", () => {
    it("passes since_utc as a query param when provided, overriding the default", async () => {
      mockRequest.mockResolvedValueOnce({ items: [] });
      const client = new OwnerrezClient(credentials);

      await client.listBookings({ sinceUtc: "2026-01-01T00:00:00Z" });

      expect(mockRequest).toHaveBeenCalledWith(
        "/bookings?since_utc=2026-01-01T00%3A00%3A00Z",
      );
    });

    it("defaults to a 90-day-back since_utc cutoff when called with no params — never sends a bare /bookings request", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
      mockRequest.mockResolvedValueOnce({ items: [] });
      const client = new OwnerrezClient(credentials);

      await client.listBookings();

      const expectedCutoff = new Date(
        Date.parse("2026-08-25T12:00:00.000Z") - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(mockRequest).toHaveBeenCalledWith(
        `/bookings?since_utc=${encodeURIComponent(expectedCutoff)}`,
      );
    });

    it("the default since_utc is a valid, well-formed ISO-8601 UTC datetime — not an arbitrary string", async () => {
      mockRequest.mockResolvedValueOnce({ items: [] });
      const client = new OwnerrezClient(credentials);

      await client.listBookings();

      const [calledUrl] = mockRequest.mock.calls[0] as [string];
      const sinceUtcRaw = decodeURIComponent(
        calledUrl.split("since_utc=")[1] ?? "",
      );
      expect(sinceUtcRaw).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(new Date(sinceUtcRaw).toString()).not.toBe("Invalid Date");
    });

    it("sends a plain GET with no write-shaped call introduced by the default (single URL arg only, same shape as listProperties())", async () => {
      mockRequest.mockResolvedValueOnce({ items: [] });
      const client = new OwnerrezClient(credentials);

      await client.listBookings();

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest.mock.calls[0]).toHaveLength(1);
    });

    it("follows next_page_url across multiple pages, accumulating bookings from every page", async () => {
      mockRequest
        .mockResolvedValueOnce({
          items: [{ id: 1 }],
          next_page_url:
            "https://api.ownerreservations.com/v2/bookings?since_utc=2026-01-01T00%3A00%3A00Z&offset=20",
        })
        .mockResolvedValueOnce({
          items: [{ id: 2 }],
          next_page_url: null,
        });
      const client = new OwnerrezClient(credentials);

      const bookings = await client.listBookings({
        sinceUtc: "2026-01-01T00:00:00Z",
      });

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(bookings).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("rejects a bookings next_page_url pointing outside /v2/bookings", async () => {
      mockRequest.mockResolvedValueOnce({
        items: [{ id: 1 }],
        next_page_url:
          "https://api.ownerreservations.com/v2/properties?offset=20",
      });
      const client = new OwnerrezClient(credentials);

      await expect(client.listBookings()).rejects.toThrow(/unexpected path/);
    });
  });

  it("sync(INBOUND) fetches bookings with a valid since_utc (never a bare /bookings call) and reports the count processed, without writing to the database", async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ id: 1 }, { id: 2 }],
    });
    const client = new OwnerrezClient(credentials);

    const result = await client.sync("INBOUND");

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockRequest.mock.calls[0] as [string];
    expect(calledUrl).toMatch(/^\/bookings\?since_utc=.+/);
    expect(result).toEqual({ recordsProcessed: 2, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — OwnerRez is the system of record for its own bookings", async () => {
    const client = new OwnerrezClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() still throws NotImplementedError — payload shape is an open design question", async () => {
    const client = new OwnerrezClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
      /not implemented yet/,
    );
  });
});
