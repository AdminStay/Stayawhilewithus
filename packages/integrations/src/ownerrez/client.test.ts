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

import { HttpRequestError } from "../core";

import {
  describeOwnerrezResponseShape,
  OwnerrezClient,
  OwnerrezRequestBudgetError,
  OwnerrezUnexpectedResponseError,
} from "./client";

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
        /exceeded the maximum of 200 pages/,
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

  describe("getProperty", () => {
    it("fetches the single-property detail endpoint by id", async () => {
      mockRequest.mockResolvedValueOnce({
        id: 431354,
        name: "Ocean Pearl",
        key: "ocean-pearl",
        active: true,
        internal_code: "OCEAN-PEARL",
        address: {
          street1: "2330 Kings Point Dr",
          city: "Largo",
          state: "FL",
          postal_code: "33774",
          country: "US",
        },
        bedrooms: 6,
        bathrooms_full: 4,
        bathrooms_half: 1,
        max_guests: 14,
        time_zone: "America/New_York",
        property_type: "House",
      });
      const client = new OwnerrezClient(credentials);

      const detail = await client.getProperty(431354);

      expect(mockRequest).toHaveBeenCalledWith("/properties/431354");
      expect(detail.address?.city).toBe("Largo");
      expect(detail.bathrooms_full).toBe(4);
      expect(detail.time_zone).toBe("America/New_York");
    });

    it("sends a plain GET with no write-shaped call (single URL arg only)", async () => {
      mockRequest.mockResolvedValueOnce({
        id: 1,
        name: "Cabin A",
        key: "cabin-a",
        active: true,
      });
      const client = new OwnerrezClient(credentials);

      await client.getProperty(1);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest.mock.calls[0]).toHaveLength(1);
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

  describe("listOperationalBookings (2026-09-27, OwnerRez step 1)", () => {
    const NOW = new Date("2026-09-27T18:00:00.000Z");
    const daysFromNow = (d: number) =>
      new Date(NOW.getTime() + d * 86_400_000).toISOString();

    function booking(id: number, overrides: Record<string, unknown> = {}) {
      return {
        id,
        property_id: 1,
        guest_id: id + 1000,
        status: "active",
        arrival: daysFromNow(10).slice(0, 10),
        departure: daysFromNow(14).slice(0, 10),
        created_utc: daysFromNow(-5),
        updated_utc: daysFromNow(-5),
        ...overrides,
      };
    }

    /** Routes the mocked HTTP layer by path, the way OwnerRez would answer. */
    function serve(routes: {
      active?: unknown[];
      inactive?: unknown[];
      recent?: unknown[];
      stay?: (path: string) => {
        items: unknown[];
        next_page_url?: string | null;
      };
    }) {
      mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path === "/properties?active=true")
          return { items: routes.active ?? [] };
        if (path === "/properties?active=false")
          return { items: routes.inactive ?? [] };
        if (path.startsWith("/bookings?since_utc="))
          return { items: routes.recent ?? [] };
        if (path.startsWith("/bookings?property_ids="))
          return routes.stay ? routes.stay(path) : { items: [] };
        throw new Error(`unexpected path ${path}`);
      });
    }

    it("REGRESSION: a booking created and last changed 200 days ago that arrives tomorrow is NOT omitted (the 90-day since_utc query can't return it; the stay window does)", async () => {
      const longLead = booking(501, {
        arrival: daysFromNow(1).slice(0, 10),
        departure: daysFromNow(5).slice(0, 10),
        created_utc: daysFromNow(-200),
        updated_utc: daysFromNow(-200),
      });
      serve({
        active: [{ id: 1 }],
        recent: [],
        stay: () => ({ items: [longLead] }),
      });

      const { bookings } = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });

      expect(bookings).toEqual([longLead]);
    });

    it("includes a currently in-house stay booked long ago (arrived 3 days ago, departs in 2 days)", async () => {
      const inHouse = booking(502, {
        arrival: daysFromNow(-3).slice(0, 10),
        departure: daysFromNow(2).slice(0, 10),
        created_utc: daysFromNow(-150),
        updated_utc: daysFromNow(-150),
      });
      serve({ active: [{ id: 1 }], stay: () => ({ items: [inHouse] }) });

      const { bookings } = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(bookings.map((b) => b.id)).toEqual([502]);
    });

    it("keeps recent-change bookings (new bookings, cancellations, recent past stays) from the unchanged 90-day query", async () => {
      const newBooking = booking(601);
      const cancelled = booking(602, { status: "canceled" });
      const recentPast = booking(603, {
        arrival: daysFromNow(-20).slice(0, 10),
        departure: daysFromNow(-15).slice(0, 10),
      });
      serve({
        active: [{ id: 1 }],
        recent: [newBooking, cancelled, recentPast],
      });

      const { bookings } = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(bookings.map((b) => b.id).sort()).toEqual([601, 602, 603]);
      expect(bookings.find((b) => b.id === 602)?.status).toBe("canceled");
    });

    it("a cancelled future booking returned only by the stay window keeps its cancelled status", async () => {
      serve({
        active: [{ id: 1 }],
        stay: () => ({
          items: [
            booking(604, {
              status: "canceled",
              updated_utc: daysFromNow(-120),
            }),
          ],
        }),
      });
      const { bookings } = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(bookings).toEqual([
        expect.objectContaining({ id: 604, status: "canceled" }),
      ]);
    });

    it("de-duplicates a booking returned by both queries (idempotent), keeping the copy with the later updated_utc", async () => {
      const older = booking(700, {
        updated_utc: daysFromNow(-10),
        status: "active",
      });
      const newer = booking(700, {
        updated_utc: daysFromNow(-1),
        status: "canceled",
      });
      serve({
        active: [{ id: 1 }],
        recent: [older],
        stay: () => ({ items: [newer] }),
      });

      const result = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(result.bookings).toEqual([newer]);
      expect(result.stats).toMatchObject({
        recentChanges: 1,
        stayWindow: 1,
        merged: 1,
      });
    });

    it("sends exactly the documented GETs: since_utc = now − 90 days; property_ids of ALL properties (active + inactive) with from = yesterday", async () => {
      serve({ active: [{ id: 11 }, { id: 12 }], inactive: [{ id: 13 }] });

      const result = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });

      const paths = mockRequest.mock.calls.map((c) => c[0] as string);
      expect(paths).toContain(
        `/bookings?since_utc=${encodeURIComponent(daysFromNow(-90))}`,
      );
      expect(paths).toContain(
        "/bookings?property_ids=11,12,13&from=2026-09-26",
      );
      for (const call of mockRequest.mock.calls) {
        expect(call).toHaveLength(1); // plain GET, no write-shaped init
      }
      expect(result.stats).toMatchObject({
        propertiesQueried: 3,
        stayWindowFrom: "2026-09-26",
      });
    });

    it("chunks property_ids at 50 per request for a large portfolio", async () => {
      serve({
        active: Array.from({ length: 120 }, (_, i) => ({ id: i + 1 })),
      });
      await new OwnerrezClient(credentials).listOperationalBookings({
        now: NOW,
      });
      const stayCalls = mockRequest.mock.calls
        .map((c) => c[0] as string)
        .filter((p) => p.startsWith("/bookings?property_ids="));
      expect(stayCalls).toHaveLength(3);
      expect(
        stayCalls.map((p) => p.split("=")[1]!.split("&")[0]!.split(",").length),
      ).toEqual([50, 50, 20]);
    });

    it("follows stay-window pagination and still rejects a next_page_url outside /v2/bookings", async () => {
      serve({
        active: [{ id: 1 }],
        stay: (path) =>
          path.includes("offset=20")
            ? { items: [booking(802)], next_page_url: null }
            : {
                items: [booking(801)],
                next_page_url:
                  "https://api.ownerreservations.com/v2/bookings?property_ids=1&from=2026-09-26&offset=20",
              },
      });
      const { bookings } = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(bookings.map((b) => b.id)).toEqual([801, 802]);

      serve({
        active: [{ id: 1 }],
        stay: () => ({
          items: [booking(803)],
          next_page_url:
            "https://api.ownerreservations.com/v2/properties?offset=20",
        }),
      });
      await expect(
        new OwnerrezClient(credentials).listOperationalBookings({ now: NOW }),
      ).rejects.toThrow(/unexpected path/);
    });

    it("with no OwnerRez properties it runs only the recent-changes query (never an empty property_ids request)", async () => {
      serve({ recent: [booking(900)] });
      const result = await new OwnerrezClient(
        credentials,
      ).listOperationalBookings({ now: NOW });
      expect(result.bookings.map((b) => b.id)).toEqual([900]);
      expect(
        mockRequest.mock.calls.some((c) =>
          String(c[0]).startsWith("/bookings?property_ids="),
        ),
      ).toBe(false);
    });

    it("listBookings() itself is unchanged: bare call still uses the 90-day since_utc only", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      mockRequest.mockReset().mockResolvedValueOnce({ items: [] });
      await new OwnerrezClient(credentials).listBookings();
      expect(mockRequest).toHaveBeenCalledWith(
        `/bookings?since_utc=${encodeURIComponent(daysFromNow(-90))}`,
      );
    });
  });

  describe("request budget + 429 stop (2026-09-28)", () => {
    it("without a budget nothing changes (existing callers are unlimited)", async () => {
      mockRequest.mockReset().mockResolvedValue({ id: 1 });
      const client = new OwnerrezClient(credentials);
      for (let i = 0; i < 5; i++) await client.getGuest(i);
      expect(mockRequest).toHaveBeenCalledTimes(5);
      expect(client.usage).toEqual({
        requestsMade: 5,
        requestBudget: null,
        rateLimited: false,
      });
    });

    it("never sends more requests than the budget; the next call is refused before any HTTP request", async () => {
      mockRequest.mockReset().mockResolvedValue({ id: 1 });
      const client = new OwnerrezClient(credentials, { requestBudget: 2 });
      await client.getGuest(1);
      await client.getGuest(2);
      await expect(client.getGuest(3)).rejects.toMatchObject({
        name: "OwnerrezRequestBudgetError",
        reason: "BUDGET_EXHAUSTED",
      });
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("concurrent callers can't overshoot the budget (counter is taken before awaiting)", async () => {
      mockRequest.mockReset().mockResolvedValue({ id: 1 });
      const client = new OwnerrezClient(credentials, { requestBudget: 3 });
      const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((id) => client.getGuest(id)),
      );
      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    });

    it("a 429 is not retried and stops every further request from this client", async () => {
      mockRequest
        .mockReset()
        .mockRejectedValueOnce(new HttpRequestError("/guests/1", 429));
      const client = new OwnerrezClient(credentials, { requestBudget: 100 });

      await expect(client.getGuest(1)).rejects.toBeInstanceOf(
        OwnerrezRequestBudgetError,
      );
      await expect(client.getGuest(2)).rejects.toMatchObject({
        reason: "RATE_LIMITED",
      });
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(client.usage.rateLimited).toBe(true);
    });

    it("other errors (e.g. 404) pass through unchanged and don't stop the client", async () => {
      mockRequest
        .mockReset()
        .mockRejectedValueOnce(new HttpRequestError("/guests/1", 404))
        .mockResolvedValueOnce({ id: 2 });
      const client = new OwnerrezClient(credentials, { requestBudget: 10 });
      await expect(client.getGuest(1)).rejects.toBeInstanceOf(HttpRequestError);
      await expect(client.getGuest(2)).resolves.toEqual({ id: 2 });
    });

    it("pagination counts against the budget too — a long crawl stops at the budget instead of running on", async () => {
      let offset = 0;
      mockRequest.mockReset().mockImplementation(async () => {
        offset += 20;
        return {
          items: [{ id: offset }],
          next_page_url: `https://api.ownerreservations.com/v2/bookings?since_utc=x&offset=${offset}`,
        };
      });
      const client = new OwnerrezClient(credentials, { requestBudget: 7 });
      await expect(
        client.listBookings({ sinceUtc: "2026-01-01T00:00:00Z" }),
      ).rejects.toBeInstanceOf(OwnerrezRequestBudgetError);
      expect(mockRequest).toHaveBeenCalledTimes(7);
    });
  });

  describe("listStayWindowBookings (2026-09-28, dashboard upcoming bookings)", () => {
    it("fetches only properties + the stay window (no 90-day since_utc query) and returns a long-lead upcoming stay", async () => {
      const longLead = {
        id: 42,
        arrival: "2026-10-02",
        departure: "2026-10-05",
        created_utc: "2026-03-01T00:00:00Z",
        updated_utc: "2026-03-01T00:00:00Z",
      };
      mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path === "/properties?active=true") return { items: [{ id: 5 }] };
        if (path === "/properties?active=false") return { items: [] };
        if (path === "/bookings?property_ids=5&from=2026-09-26")
          return { items: [longLead] };
        throw new Error(`unexpected path ${path}`);
      });

      const result = await new OwnerrezClient(
        credentials,
      ).listStayWindowBookings({ now: new Date("2026-09-27T18:00:00.000Z") });

      expect(result).toEqual({
        bookings: [longLead],
        propertiesQueried: 1,
        from: "2026-09-26",
      });
      expect(
        mockRequest.mock.calls.some((c) => String(c[0]).includes("since_utc")),
      ).toBe(false);
    });
  });

  describe("response-shape validation + safe diagnostic (2026-09-28)", () => {
    const serveOnce = (body: unknown) =>
      mockRequest.mockReset().mockResolvedValueOnce(body);

    async function failure(body: unknown) {
      serveOnce(body);
      const err = await new OwnerrezClient(credentials)
        .listBookings({ sinceUtc: "2026-01-01T00:00:00Z" })
        .then(
          () => {
            throw new Error("expected a rejection, got a result");
          },
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(OwnerrezUnexpectedResponseError);
      return err as InstanceType<typeof OwnerrezUnexpectedResponseError>;
    }

    it("a normal { items: [...] } page still succeeds", async () => {
      serveOnce({ items: [{ id: 1 }], next_page_url: null });
      await expect(
        new OwnerrezClient(credentials).listBookings({
          sinceUtc: "2026-01-01T00:00:00Z",
        }),
      ).resolves.toEqual([{ id: 1 }]);
    });

    it("an object without items fails visibly with operation, page, type and key names only", async () => {
      const err = await failure({ count: 0, limit: 20, offset: 0 });
      expect(err.diagnostic).toEqual({
        operation: "bookings:recent-changes",
        page: 1,
        type: "object",
        keys: ["count", "limit", "offset"],
      });
      expect(err.message).toBe(
        "OwnerRez returned an unexpected response for bookings:recent-changes (page 1): object with keys [count, limit, offset].",
      );
    });

    it("items that is not an array fails (its JSON type is reported, not its content)", async () => {
      const err = await failure({ items: { "901": { guest: "Jane" } } });
      expect(err.diagnostic).toMatchObject({
        type: "object",
        keys: ["items"],
        itemsType: "object",
      });
      expect(err.message).toContain('"items" is object, not an array');
      expect(err.message).not.toMatch(/901|Jane/);
    });

    it("a top-level array fails: length + first element key names only", async () => {
      const err = await failure([
        { id: 4471, arrival: "2026-10-01", guest_email: "jane@example.com" },
        { id: 4472 },
      ]);
      expect(err.diagnostic).toMatchObject({
        type: "array",
        length: 2,
        firstElementKeys: ["arrival", "guest_email", "id"],
      });
      expect(err.message).not.toMatch(/4471|2026-10-01|jane@example\.com/);
    });

    it("null, a string, a number and an empty array all fail visibly — none become zero bookings", async () => {
      for (const [body, type] of [
        [null, "null"],
        ["<html>error</html>", "string"],
        [0, "number"],
        [[], "array"],
      ] as const) {
        const err = await failure(body);
        expect(err.diagnostic.type).toBe(type);
        expect(err.message).not.toContain("<html>");
      }
    });

    it("an error-style object returned with 2xx fails, and none of its values are exposed", async () => {
      const err = await failure({
        message: "Invalid token sk-ownerrez-test for user stayW",
        errors: [{ field: "from", detail: "bad value 2026-09-27" }],
        status: 400,
      });
      expect(err.diagnostic).toEqual({
        operation: "bookings:recent-changes",
        page: 1,
        type: "object",
        keys: ["errors", "message", "status"],
      });
      const emitted = JSON.stringify({ m: err.message, d: err.diagnostic });
      for (const secret of [
        "sk-ownerrez-test",
        "stayW",
        "Invalid token",
        "2026-09-27",
        "400",
      ]) {
        expect(emitted).not.toContain(secret);
      }
    });

    it("keys that aren't ordinary field names (numeric ids, emails) are counted as redacted, never shown", () => {
      const shape = describeOwnerrezResponseShape({
        "4471": {},
        "jane@example.com": 1,
        next_page_url: null,
      });
      expect(shape).toEqual({
        type: "object",
        keys: ["next_page_url"],
        redactedKeyCount: 2,
      });
    });

    it("the stay-window diagnostic names the operation, batch and page — never property ids, the date or the URL", async () => {
      mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path === "/properties?active=true")
          return { items: [{ id: 11 }, { id: 12 }] };
        if (path === "/properties?active=false") return { items: [] };
        if (path.startsWith("/bookings?property_ids=")) {
          return path.includes("offset=20")
            ? { message: "nope" }
            : {
                items: [{ id: 1 }],
                next_page_url:
                  "https://api.ownerreservations.com/v2/bookings?property_ids=11,12&from=2026-09-26&offset=20",
              };
        }
        throw new Error(`unexpected path ${path}`);
      });

      const err = await new OwnerrezClient(credentials)
        .listStayWindowBookings({ now: new Date("2026-09-27T18:00:00.000Z") })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(OwnerrezUnexpectedResponseError);
      const e = err as InstanceType<typeof OwnerrezUnexpectedResponseError>;
      expect(e.message).toBe(
        "OwnerRez returned an unexpected response for bookings:stay-window (page 2, batch 1): object with keys [message].",
      );
      expect(JSON.stringify(e.diagnostic)).not.toMatch(
        /11,12|2026-09-26|property_ids|nope|http/,
      );
    });

    it("properties pages are labelled too", async () => {
      mockRequest
        .mockReset()
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ data: [] });
      const err = await new OwnerrezClient(credentials)
        .listProperties()
        .catch((e: unknown) => e);
      expect(
        (err as InstanceType<typeof OwnerrezUnexpectedResponseError>).diagnostic
          .operation,
      ).toBe("properties:inactive");
    });

    it("the operational retrieval rejects on a malformed page instead of returning fewer bookings", async () => {
      mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path.startsWith("/bookings?since_utc="))
          return { items: [{ id: 1 }] };
        if (path.startsWith("/properties")) return { items: [{ id: 5 }] };
        return { count: 3 };
      });
      await expect(
        new OwnerrezClient(credentials).listOperationalBookings({
          now: new Date("2026-09-27T18:00:00.000Z"),
        }),
      ).rejects.toBeInstanceOf(OwnerrezUnexpectedResponseError);
    });

    it("a paged HTTP error is re-labelled with the operation (status kept) — no URL or query values in the message", async () => {
      mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path.startsWith("/properties")) return { items: [{ id: 77 }] };
        throw new HttpRequestError(path, 400);
      });
      const err = await new OwnerrezClient(credentials)
        .listStayWindowBookings({ now: new Date("2026-09-27T18:00:00.000Z") })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpRequestError);
      expect((err as HttpRequestError).status).toBe(400);
      expect((err as Error).message).toBe(
        "Request to OwnerRez bookings:stay-window (page 1, batch 1) failed with 400",
      );
      expect((err as Error).message).not.toMatch(/property_ids|77|from=/);
    });

    it("pagination-validation errors keep their protection but no longer echo the URL", async () => {
      mockRequest.mockReset().mockResolvedValueOnce({
        items: [{ id: 1 }],
        next_page_url: "https://evil.example.com/v2/bookings?secret=abc",
      });
      const err = await new OwnerrezClient(credentials)
        .listBookings({ sinceUtc: "2026-01-01T00:00:00Z" })
        .catch((e: unknown) => e);
      expect((err as Error).message).toMatch(/unexpected host/);
      expect((err as Error).message).not.toMatch(/evil|secret|abc/);
    });
  });
});
