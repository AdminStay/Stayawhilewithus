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

import { CieloClient } from "./client";

const credentials = { username: "test@example.com", password: "hunter2" };

const LOGIN_SUCCESS = {
  status: 200,
  message: "SUCCESS",
  data: { user: { accessToken: "access-1", userId: "user-1" } },
};

describe("CieloClient", () => {
  it("declares sync + webhook capabilities for the CIELO provider", () => {
    const client = new CieloClient(credentials);

    expect(client.provider).toBe("CIELO");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("connect() logs in and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    const client = new CieloClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith(
      "/user/smarthvac/login/1",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.connected).toBe(true);
    expect(result.connectedAt).toBeInstanceOf(Date);
  });

  it("login sends the password as a SHA-256 hash, never the plaintext", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    const client = new CieloClient(credentials);

    await client.connect();

    const [, init] = mockRequest.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.user.password).not.toBe(credentials.password);
    expect(body.user.password).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validateCredentials() returns invalid with a reason when login fails", async () => {
    mockRequest.mockResolvedValueOnce({
      status: 401,
      message: "Invalid credentials",
    });
    const client = new CieloClient(credentials);

    const result = await client.validateCredentials();

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Invalid credentials/);
  });

  it("healthCheck() returns unhealthy with details when the request throws", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));
    const client = new CieloClient(credentials);

    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.details).toBe("network error");
  });

  it("listDevices() logs in, then reads deviceStatus/macAddress/deviceName from /web/devices", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS).mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [
          {
            deviceName: "Living Room",
            macAddress: "aa:bb:cc",
            deviceStatus: 1,
          },
          { deviceName: "Main", macAddress: "dd:ee:ff", deviceStatus: 0 },
        ],
      },
    });
    const client = new CieloClient(credentials);

    const devices = await client.listDevices();

    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      "/web/devices?limit=420",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "access-1" }),
      }),
    );
    expect(devices).toEqual([
      { id: "aa:bb:cc", name: "Living Room", online: true },
      { id: "dd:ee:ff", name: "Main", online: false },
    ]);
  });

  it("sync(INBOUND) fetches devices and reports the count processed, without writing to the database", async () => {
    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS).mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [{ deviceName: "A", macAddress: "1", deviceStatus: 1 }],
      },
    });
    const client = new CieloClient(credentials);

    const result = await client.sync("INBOUND");

    expect(result).toEqual({ recordsProcessed: 1, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — Cielo is the system of record for its own device state", async () => {
    const client = new CieloClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() throws NotImplementedError — no webhook payload shape has been researched", async () => {
    const client = new CieloClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
      /not implemented yet/,
    );
  });
});
