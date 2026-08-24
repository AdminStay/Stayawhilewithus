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

  it("listProperties() unwraps the paginated response", async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ id: 1, name: "Cabin A", key: "cabin-a", active: true }],
    });
    const client = new OwnerrezClient(credentials);

    const properties = await client.listProperties();

    expect(mockRequest).toHaveBeenCalledWith("/properties");
    expect(properties).toEqual([
      { id: 1, name: "Cabin A", key: "cabin-a", active: true },
    ]);
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
