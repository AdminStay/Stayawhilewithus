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
      connectivity: "ONLINE",
      lockState: null,
      telemetryUpdatedAt: null,
      seenAt: null,
      serialNumber: null,
    });
  });

  it("getLockDetail() captures SerialNumber when the provider reports one", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-1",
      LockName: "Front Door",
      HouseID: "house-1",
      battery: 0.85,
      Bridge: { operative: true },
      SerialNumber: "M0123456",
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-1");

    expect(detail.serialNumber).toBe("M0123456");
  });

  it("getLockDetail() normalizes a negative battery fraction (August's 'no reading' sentinel, observed as -1 -> -100%) to null instead of rendering it literally", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-dead-battery",
      LockName: "Dead Battery Door",
      HouseID: "house-1",
      battery: -1,
      Bridge: { operative: true },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-dead-battery");

    expect(detail.batteryLevel).toBeNull();
  });

  it("getLockDetail() leaves a missing battery reading as null (not 0)", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-no-battery-field",
      LockName: "No Battery Field Door",
      HouseID: "house-1",
      Bridge: { operative: true },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-no-battery-field");

    expect(detail.batteryLevel).toBeNull();
  });

  it("getLockDetail() prefers bridge.status.current === 'online' when a status object is present, and reports OFFLINE (not UNKNOWN) when the provider explicitly says offline", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-2",
      LockName: "Back Door",
      HouseID: "house-1",
      battery: 0.62,
      Bridge: { operative: true, status: { current: "offline" } },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-2");

    expect(detail.connectivity).toBe("OFFLINE");
  });

  it("getLockDetail() reports UNKNOWN — not OFFLINE — when there's no Bridge at all (regression: this was the real production bug misclassifying working locks as down)", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-3",
      LockName: "Side Door",
      HouseID: "house-1",
      battery: 0.5,
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-3");

    expect(detail.connectivity).toBe("UNKNOWN");
  });

  it("getLockDetail() reads lockState and seenAt from LockStatus only when the provider marks it valid", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-4",
      LockName: "Patio Door",
      HouseID: "house-1",
      battery: 0.7,
      Bridge: { operative: true, status: { current: "online" } },
      LockStatus: {
        status: "locked",
        valid: true,
        dateTime: "2026-08-19T19:23:18.000Z",
      },
      batteryInfo: { infoUpdatedDate: "2026-08-19T18:00:00.000Z" },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-4");

    expect(detail.lockState).toBe("locked");
    expect(detail.seenAt).toBe("2026-08-19T19:23:18.000Z");
    expect(detail.telemetryUpdatedAt).toBe("2026-08-19T18:00:00.000Z");
  });

  it("getLockDetail() never fabricates lockState/seenAt when LockStatus is present but not valid", async () => {
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-5",
      LockName: "Garage Door",
      HouseID: "house-1",
      battery: 0.9,
      LockStatus: { status: "unknown" },
      batteryInfo: { infoUpdatedDate: "2026-08-19T18:00:00.000Z" },
    });
    const client = new AugustClient(credentials);

    const detail = await client.getLockDetail("lock-5");

    expect(detail.connectivity).toBe("UNKNOWN");
    expect(detail.lockState).toBeNull();
    expect(detail.seenAt).toBeNull();
    expect(detail.telemetryUpdatedAt).toBe("2026-08-19T18:00:00.000Z");
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

  describe("getLockCapabilities()", () => {
    it("reports lock+unlock supported and unlatch supported when the provider's lock key includes unlatch: true", async () => {
      mockRequest.mockResolvedValueOnce({ lock: { unlatch: true } });
      const client = new AugustClient(credentials);

      const capabilities = await client.getLockCapabilities("M0123456");

      expect(mockRequest).toHaveBeenCalledWith(
        "/devices/capabilities?serialNumber=M0123456&topLevelHost=true",
      );
      expect(capabilities).toEqual({
        lock: true,
        unlock: true,
        unlatch: true,
      });
    });

    it("reports unlatch NOT supported when the provider's lock key omits it or sets it false — never assumed true", async () => {
      mockRequest.mockResolvedValueOnce({ lock: {} });
      const client = new AugustClient(credentials);

      const capabilities = await client.getLockCapabilities("M0123456");

      expect(capabilities.unlatch).toBe(false);
    });

    it("reports lock+unlock NOT supported when the response has no lock key at all — this serial number isn't a remotely-operable lock model", async () => {
      mockRequest.mockResolvedValueOnce({});
      const client = new AugustClient(credentials);

      const capabilities = await client.getLockCapabilities("M0123456");

      expect(capabilities).toEqual({
        lock: false,
        unlock: false,
        unlatch: false,
      });
    });
  });

  describe("lock() / unlock() / unlatch()", () => {
    it("lock() sends PUT /remoteoperate/{lockId}/lock?type=async with maxRetries: 0 (2026-09-25: async mode is Phase 2, single-attempt is Phase 1 of the Orion incident's root-cause correction — see operate()'s own doc comment)", async () => {
      mockRequest.mockResolvedValueOnce({});
      const client = new AugustClient(credentials);

      await client.lock("lock-1");

      expect(mockRequest).toHaveBeenCalledWith(
        "/remoteoperate/lock-1/lock?type=async",
        { method: "PUT" },
        { maxRetries: 0 },
      );
    });

    it("unlock() sends PUT /remoteoperate/{lockId}/unlock?type=async with maxRetries: 0", async () => {
      mockRequest.mockResolvedValueOnce({});
      const client = new AugustClient(credentials);

      await client.unlock("lock-1");

      expect(mockRequest).toHaveBeenCalledWith(
        "/remoteoperate/lock-1/unlock?type=async",
        { method: "PUT" },
        { maxRetries: 0 },
      );
    });

    it("unlatch() sends PUT /remoteoperate/{lockId}/unlatch?type=async with maxRetries: 0", async () => {
      mockRequest.mockResolvedValueOnce({});
      const client = new AugustClient(credentials);

      await client.unlatch("lock-1");

      expect(mockRequest).toHaveBeenCalledWith(
        "/remoteoperate/lock-1/unlatch?type=async",
        { method: "PUT" },
        { maxRetries: 0 },
      );
    });

    it("propagates a provider failure (e.g. bridge offline) as a thrown error rather than swallowing it", async () => {
      mockRequest.mockRejectedValueOnce(
        new Error("Request to /remoteoperate/lock-1/lock failed with 422"),
      );
      const client = new AugustClient(credentials);

      await expect(client.lock("lock-1")).rejects.toThrow("422");
    });

    it("every read method on this client (getLockDetail, getLockCapabilities, listLocks, connect) omits the maxRetries override — only the three physical write calls opt into single-attempt behavior", async () => {
      mockRequest.mockClear(); // isolate this test's own calls from every earlier test's accumulated call history (this file never resets mockRequest between tests)
      mockRequest.mockResolvedValue({});
      const client = new AugustClient(credentials);

      await client.getLockDetail("lock-1");
      await client.getLockCapabilities("M0123456");
      await client.listLocks();
      await client.connect();

      for (const call of mockRequest.mock.calls) {
        expect(call).toHaveLength(1); // just the path — no init, no per-call options at all
      }
    });
  });
});
