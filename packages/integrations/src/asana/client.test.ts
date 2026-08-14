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

import { AsanaClient } from "./client";

const credentials = { accessToken: "asana-test-token" };

describe("AsanaClient", () => {
  it("declares sync + webhook capabilities for the ASANA provider", () => {
    const client = new AsanaClient(credentials);

    expect(client.provider).toBe("ASANA");
    expect(client.capabilities).toEqual(["sync", "webhook"]);
  });

  it("connect() calls /users/me and reports connected on success", async () => {
    mockRequest.mockResolvedValueOnce({ data: { gid: "1" } });
    const client = new AsanaClient(credentials);

    const result = await client.connect();

    expect(mockRequest).toHaveBeenCalledWith("/users/me");
    expect(result.connected).toBe(true);
  });

  it("validateCredentials() returns invalid with a reason when the request fails", async () => {
    mockRequest.mockRejectedValueOnce(new Error("Request failed with 401"));
    const client = new AsanaClient(credentials);

    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "Request failed with 401" });
  });

  it("sync(INBOUND) lists workspaces and reports the count, without writing anything", async () => {
    mockRequest.mockResolvedValueOnce({
      data: [{ gid: "w1", name: "StayWhile" }],
    });
    const client = new AsanaClient(credentials);

    const result = await client.sync("INBOUND");

    expect(mockRequest).toHaveBeenCalledWith("/workspaces");
    expect(result).toEqual({ recordsProcessed: 1, direction: "INBOUND" });
  });

  it("sync(OUTBOUND) rejects — no write target is designed yet", async () => {
    const client = new AsanaClient(credentials);

    await expect(client.sync("OUTBOUND")).rejects.toThrow(/INBOUND/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("receiveWebhook() still throws NotImplementedError — per-webhook secret storage doesn't exist yet", async () => {
    const client = new AsanaClient(credentials);

    await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
      /not implemented yet/,
    );
  });
});
