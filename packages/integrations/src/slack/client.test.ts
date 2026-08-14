import { createHmac } from "node:crypto";

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

import { SlackClient } from "./client";

const credentials = { botToken: "xoxb-test", signingSecret: "test-secret" };

describe("SlackClient", () => {
  it("declares webhook + messaging capabilities for the SLACK provider", () => {
    const client = new SlackClient(credentials);

    expect(client.provider).toBe("SLACK");
    expect(client.capabilities).toEqual(["webhook", "messaging"]);
  });

  it("validateCredentials() returns valid when auth.test responds ok", async () => {
    mockRequest.mockResolvedValueOnce({ ok: true, user_id: "U1", team: "T1" });
    const client = new SlackClient(credentials);

    const result = await client.validateCredentials();

    expect(mockRequest).toHaveBeenCalledWith("/auth.test", { method: "POST" });
    expect(result).toEqual({ valid: true });
  });

  it("validateCredentials() returns invalid with Slack's error string when ok is false", async () => {
    mockRequest.mockResolvedValueOnce({ ok: false, error: "invalid_auth" });
    const client = new SlackClient(credentials);

    const result = await client.validateCredentials();

    expect(result).toEqual({ valid: false, reason: "invalid_auth" });
  });

  it("connect() throws when credentials are invalid", async () => {
    mockRequest.mockResolvedValueOnce({ ok: false, error: "invalid_auth" });
    const client = new SlackClient(credentials);

    await expect(client.connect()).rejects.toThrow("invalid_auth");
  });

  it("sendMessage() posts to chat.postMessage and returns the message ts", async () => {
    mockRequest.mockResolvedValueOnce({
      ok: true,
      ts: "1700000000.000100",
      channel: "C1",
    });
    const client = new SlackClient(credentials);

    const result = await client.sendMessage("C1", "Hello from StayWhile");

    expect(mockRequest).toHaveBeenCalledWith("/chat.postMessage", {
      method: "POST",
      body: JSON.stringify({ channel: "C1", text: "Hello from StayWhile" }),
    });
    expect(result.externalMessageId).toBe("1700000000.000100");
    expect(result.sentAt).toBeInstanceOf(Date);
  });

  it("sendMessage() throws when Slack reports ok: false", async () => {
    mockRequest.mockResolvedValueOnce({
      ok: false,
      error: "channel_not_found",
    });
    const client = new SlackClient(credentials);

    await expect(client.sendMessage("C1", "hi")).rejects.toThrow(
      "channel_not_found",
    );
  });

  it("receiveWebhook() accepts a correctly signed payload", async () => {
    const client = new SlackClient(credentials);
    const rawBody = JSON.stringify({ type: "event_callback" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", credentials.signingSecret)
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex");

    const result = await client.receiveWebhook(rawBody, {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    });

    expect(result).toEqual({ accepted: true, entityType: "slack.event" });
  });

  it("receiveWebhook() rejects when signature headers are missing", async () => {
    const client = new SlackClient(credentials);

    const result = await client.receiveWebhook("{}", {});

    expect(result).toEqual({ accepted: false });
  });

  it("receiveWebhook() rejects an invalid signature", async () => {
    const client = new SlackClient(credentials);
    const timestamp = String(Math.floor(Date.now() / 1000));

    const result = await client.receiveWebhook("{}", {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": "v0=not-a-real-signature",
    });

    expect(result).toEqual({ accepted: false });
  });
});
