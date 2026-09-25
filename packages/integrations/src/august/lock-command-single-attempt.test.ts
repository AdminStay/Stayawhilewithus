// Deliberately does NOT mock "../core" (unlike client.test.ts) — this file
// exercises the REAL HttpClient, with a real fetch spy, to prove the
// end-to-end guarantee directly at each physical-write call site: a
// network-level abort/timeout during lock()/unlock()/unlatch() results in
// exactly ONE outbound fetch, never a silent retransmission (2026-09-25,
// the Orion incident's root-cause correction). Read methods are proven
// here too, to show their pre-existing retry behavior is genuinely
// unaffected — not just that operate() happens to omit an option.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AugustClient } from "./client";

const credentials = {
  identifier: "email:test@example.com",
  installId: "install-1",
  accessToken: "token-1",
};

describe("AugustClient physical-write commands — at most one outbound fetch per call, real HttpClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("lock(): a network-level abort produces exactly ONE outbound fetch, never a retry, and the error propagates (never swallowed as a false success)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("This operation was aborted"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.lock("lock-1")).rejects.toThrow(
      "This operation was aborted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unlock(): a network-level abort produces exactly ONE outbound fetch, never a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("This operation was aborted"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.unlock("lock-1")).rejects.toThrow(
      "This operation was aborted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unlatch(): a network-level abort produces exactly ONE outbound fetch, never a retry (unlatch remains supported by this client/backend)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("This operation was aborted"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.unlatch("lock-1")).rejects.toThrow(
      "This operation was aborted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lock(): a 5xx (server-side, potentially transient) response is STILL only ONE outbound fetch — physical writes never retry, even for a status class reads would retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    } as Response);
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.lock("lock-1")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("READS RETAIN EXISTING BEHAVIOR: getLockDetail() on the same client still retries a network-level failure — proves this correction is scoped to writes only, not a global retry change", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network blip"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.getLockDetail("lock-1")).rejects.toThrow(
      "network blip",
    );
    // Default HttpClient config: 1 initial attempt + 2 retries = 3 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("READS RETAIN EXISTING BEHAVIOR: listLocks() still retries a network-level failure, same as before this correction", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network blip"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(client.listLocks()).rejects.toThrow("network blip");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("AugustClient.getLockDetail() call options (2026-09-25)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("with { maxRetries: 0 }, a network-level abort produces exactly ONE outbound fetch (used by confirmation polling)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("This operation was aborted"));
    global.fetch = fetchMock;
    const client = new AugustClient(credentials);

    await expect(
      client.getLockDetail("lock-1", { maxRetries: 0 }),
    ).rejects.toThrow("This operation was aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// 2026-09-25, the Coco Vista incident: the real async remote-operate answer
// is 2xx with an EMPTY body. Exercises the real HttpClient parsing layer
// (only fetch is faked), which is exactly what the earlier mocked tests missed.
describe("AugustClient physical commands — real async empty-body acknowledgement", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ["lock", (c: AugustClient) => c.lock("lock-1")],
    ["unlock", (c: AugustClient) => c.unlock("lock-1")],
    ["unlatch", (c: AugustClient) => c.unlatch("lock-1")],
  ] as const)(
    "%s(): an empty 202 resolves without a JSON parse error — exactly ONE PUT to the async remote-operate URL",
    async (segment, call) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 202 }));
      global.fetch = fetchMock;

      await expect(
        call(new AugustClient(credentials)),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain(
        `/remoteoperate/lock-1/${segment}?type=async`,
      );
      expect((init as RequestInit).method).toBe("PUT");
    },
  );

  it("an empty 200 is handled the same way", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(
      new AugustClient(credentials).lock("lock-1"),
    ).resolves.toBeUndefined();
  });

  it("a definite provider rejection (403 with a body) still throws HttpRequestError after ONE fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: "User is not authorized" }, { status: 403 }),
      );
    global.fetch = fetchMock;

    await expect(
      new AugustClient(credentials).lock("lock-1"),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads are unaffected: getLockDetail() still parses its JSON body", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          LockID: "lock-1",
          LockName: "Front Door",
          HouseID: "h1",
          battery: 0.9,
        }),
      );
    const detail = await new AugustClient(credentials).getLockDetail("lock-1");
    expect(detail).toMatchObject({
      id: "lock-1",
      name: "Front Door",
      batteryLevel: 90,
    });
  });
});
