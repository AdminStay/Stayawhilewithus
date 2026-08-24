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

import { OwnerrezClient } from "./client";

const credentials = { username: "stayW", token: "sk-ownerrez-test" };

describe("OwnerrezClient", () => {
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

  it("getProperty() fetches the detail endpoint by id", async () => {
    mockRequest.mockResolvedValueOnce({
      id: 1,
      name: "Cabin A",
      key: "cabin-a",
      active: true,
      internal_code: "CABIN-A",
      bedrooms: 3,
    });
    const client = new OwnerrezClient(credentials);

    const property = await client.getProperty(1);

    expect(mockRequest).toHaveBeenCalledWith("/properties/1");
    expect(property).toEqual({
      id: 1,
      name: "Cabin A",
      key: "cabin-a",
      active: true,
      internal_code: "CABIN-A",
      bedrooms: 3,
    });
  });

  it("listBookings() passes since_utc as a query param when provided", async () => {
    mockRequest.mockResolvedValueOnce({ items: [] });
    const client = new OwnerrezClient(credentials);

    await client.listBookings({ sinceUtc: "2026-01-01T00:00:00Z" });

    expect(mockRequest).toHaveBeenCalledWith(
      "/bookings?since_utc=2026-01-01T00%3A00%3A00Z",
    );
  });

  it("sync(INBOUND) fetches bookings and reports the count processed, without writing to the database", async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ id: 1 }, { id: 2 }],
    });
    const client = new OwnerrezClient(credentials);

    const result = await client.sync("INBOUND");

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
