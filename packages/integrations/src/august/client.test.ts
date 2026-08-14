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

import { AugustClient } from "./client";

const credentials = {
  identifier: "email:test@example.com",
  installId: "install-1",
  accessToken: "token-1",
};

describe("AugustClient", () => {
  it("declares sync + webhook capabilities for the AUGUST provider", () => {
    const client = new AugustClient(credentials);

    expect(client.provider).toBe("AUGUST");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("connect() calls /users/locks/mine and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce({});
    const client = new AugustClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith("/users/locks/mine");
    expect(result.connected).toBe(true);
    expect(result.connectedAt).toBeInstanceOf(Date);
  });

  it("validateCredentials() returns invalid with a reason when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 401"));
    const client = new AugustClient(credentials);

    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "Request failed with 401" });
  });

  it("healthCheck() returns unhealthy with details when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("timeout"));
    const client = new AugustClient(credentials);

    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details).toBe("timeout");
  });

  it("listLocks() turns the keyed object response into an array", async () => {
    mockRequest.mockResolvedValueOnce({
      "lock-1": { LockName: "Front Door", HouseID: "house-1" },
      "lock-2": { LockName: "Back Door", HouseID: "house-1" },
    });
    const client = new AugustClient(credentials);

    const locks = await client.listLocks();

    expect(mockRequest).toHaveBeenCalledWith("/users/locks/mine");
    expect(locks).toEqual([
      { id: "lock-1", name: "Front Door", houseId: "house-1" },
      { id: "lock-2", name: "Back Door", houseId: "house-1" },
    ]);
  });

  it("getLockDetail() converts the 0–1 battery fraction to a 0–100 percentage and reads bridge connectivity from operative when no status object is present", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-1",
      LockName: "Front Door",
      HouseID: "house-1",
      battery: 0.85,
      Bridge: { operative: true },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-1");

    expect(mockRequest).toHaveBeenCalledWith("/locks/lock-1");
    expect(detail).toEqual({
      id: "lock-1",
      name: "Front Door",
      houseId: "house-1",
      batteryLevel: 85,
      online: true,
    });
  });

  it("getLockDetail() prefers bridge.status.current === 'online' when a status object is present", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-2",
      LockName: "Back Door",
      HouseID: "house-1",
      battery: 0.62,
      Bridge: { operative: true, status: { current: "offline" } },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-2");

    expect(detail.online).toBe(false);
  });

  it("getLockDetail() reports offline when there's no Bridge at all", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-3",
      LockName: "Side Door",
      HouseID: "house-1",
      battery: 0.5,
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-3");

    expect(detail.online).toBe(false);
  });

  it("sync(INBOUND) fetches locks and reports the count processed, without writing to the database", async () => {
    mockRequest.mockResolvedValueOnce({
      "lock-1": { LockName: "Front Door", HouseID: "house-1" },
    });
    const client = new AugustClient(credentials);

    const result = await client.sync("INBOUND");

    expect(result).toEqual({ recordsProcessed: 1, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — August is the system of record for its own lock state", async () => {
    const client = new AugustClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() throws NotImplementedError — no webhook payload shape has been researched", async () => {
    const client = new AugustClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
      /not implemented yet/,
    );
  });
});
