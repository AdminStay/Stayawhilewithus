import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpClient, HttpRequestError } from "./http-client";

function fakeResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    json: () => Promise.resolve(opts.body),
    text: () =>
      Promise.resolve(
        opts.text ?? (opts.body === undefined ? "" : JSON.stringify(opts.body)),
      ),
  } as unknown as Response;
}

describe("HttpClient", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns parsed JSON on a 2xx response, unchanged from before", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: true, status: 200, body: { a: 1 } }),
      );
    const client = new HttpClient({ baseUrl: "https://example.test" });

    const result = await client.request("/things");

    expect(result).toEqual({ a: 1 });
  });

  it("throws an HttpRequestError with the exact same message format callers already string-match on", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/locks/abc/lock")).rejects.toMatchObject({
      message: "Request to /locks/abc/lock failed with 403",
      status: 403,
    });
  });

  it("never retries a 4xx response, even once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
    global.fetch = fetchMock;
    const client = new HttpClient({
      baseUrl: "https://example.test",
      maxRetries: 2,
    });

    await expect(client.request("/x")).rejects.toBeInstanceOf(HttpRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries a 5xx response up to maxRetries, then throws with detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 503,
        body: { message: "bridge overloaded" },
      }),
    );
    global.fetch = fetchMock;
    const client = new HttpClient({
      baseUrl: "https://example.test",
      maxRetries: 2,
    });

    const promise = client.request("/x");
    await expect(promise).rejects.toMatchObject({
      status: 503,
      providerMessage: "bridge overloaded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("extracts an allowlisted error code and message from the response body", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 403,
        body: {
          code: "device_not_authorized",
          message: "no bridge registered",
        },
      }),
    );
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/x")).rejects.toMatchObject({
      providerErrorCode: "device_not_authorized",
      providerMessage: "no bridge registered",
    });
  });

  it("never surfaces a field whose name looks sensitive, even if it happens to match an allowlisted name pattern loosely", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 403,
        body: {
          access_token: "should-never-appear",
          auth_code: "should-never-appear-either",
          message: "safe to show",
        },
      }),
    );
    const client = new HttpClient({ baseUrl: "https://example.test" });

    let caught: unknown;
    try {
      await client.request("/x");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpRequestError);
    const error = caught as HttpRequestError;
    expect(error.providerMessage).toBe("safe to show");
    expect(JSON.stringify(error)).not.toMatch(/should-never-appear/);
    expect(error.providerErrorCode).toBeUndefined();
  });

  it("degrades to no detail (never throws a second error) when the error body isn't JSON", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ ok: false, status: 403, text: "<html>not json</html>" }),
      );
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/x")).rejects.toMatchObject({
      status: 403,
      providerErrorCode: undefined,
      providerMessage: undefined,
    });
  });

  it("degrades to no detail when the error body is empty", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 403, text: "" }));
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/x")).rejects.toMatchObject({
      status: 403,
      providerErrorCode: undefined,
      providerMessage: undefined,
    });
  });

  describe("per-call maxRetries override (2026-09-25, physical-write single-attempt correction)", () => {
    it("a per-call { maxRetries: 0 } makes exactly ONE fetch attempt on a network-level failure (abort/timeout), even though the client's own configured maxRetries is higher", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error("This operation was aborted"));
      global.fetch = fetchMock;
      const client = new HttpClient({
        baseUrl: "https://example.test",
        maxRetries: 2, // the client's own default is still 2 — proves the override, not a global change
      });

      await expect(
        client.request(
          "/remoteoperate/x/lock",
          { method: "PUT" },
          { maxRetries: 0 },
        ),
      ).rejects.toThrow("This operation was aborted");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a per-call { maxRetries: 0 } makes exactly ONE fetch attempt on a 5xx response too, never retrying even a transient-looking server error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({
          ok: false,
          status: 503,
          body: { message: "bridge overloaded" },
        }),
      );
      global.fetch = fetchMock;
      const client = new HttpClient({
        baseUrl: "https://example.test",
        maxRetries: 2,
      });

      await expect(
        client.request(
          "/remoteoperate/x/unlock",
          { method: "PUT" },
          { maxRetries: 0 },
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("omitting the per-call option preserves this client's existing configured retry behavior unchanged — proves ordinary read calls are unaffected by this correction", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network blip"));
      global.fetch = fetchMock;
      const client = new HttpClient({
        baseUrl: "https://example.test",
        maxRetries: 2,
      });

      await expect(client.request("/locks/mine")).rejects.toThrow(
        "network blip",
      );
      // Same as the pre-existing 5xx-retry test above: 1 initial + 2 retries = 3 total.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("a per-call override still respects the immediate-throw-on-4xx rule — a 403 is never retried even if maxRetries were higher", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
      global.fetch = fetchMock;
      const client = new HttpClient({
        baseUrl: "https://example.test",
        maxRetries: 5,
      });

      await expect(
        client.request(
          "/remoteoperate/x/lock",
          { method: "PUT" },
          { maxRetries: 0 },
        ),
      ).rejects.toBeInstanceOf(HttpRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

// 2026-09-25, the Coco Vista incident: August's async remote-operate PUT
// answers 2xx with an EMPTY body. These use real `Response` objects (not the
// fakeResponse() helper above, whose json() never fails) so an empty body
// behaves exactly as it does in production.
describe("HttpClient — ignoreSuccessBody per-call opt-in", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("WITHOUT the opt-in, behavior is unchanged: an empty 2xx body still fails JSON parsing (the original bug)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/x", {}, { maxRetries: 0 })).rejects.toThrow(
      /Unexpected end of JSON input/,
    );
  });

  it("WITHOUT the opt-in, a JSON 2xx body is still parsed and returned", async () => {
    global.fetch = vi.fn().mockResolvedValue(Response.json({ a: 1 }));
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(client.request("/x")).resolves.toEqual({ a: 1 });
  });

  it("WITH the opt-in, an empty 202 resolves undefined — no parse error, one fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    global.fetch = fetchMock;
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(
      client.request(
        "/x",
        { method: "PUT" },
        { maxRetries: 0, ignoreSuccessBody: true },
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("WITH the opt-in, a non-empty 2xx body is also discarded, never trusted", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "kAugLockState_Locked" }));
    const client = new HttpClient({ baseUrl: "https://example.test" });

    await expect(
      client.request("/x", {}, { ignoreSuccessBody: true }),
    ).resolves.toBeUndefined();
  });

  it("WITH the opt-in, an error response is unchanged: a 4xx still throws HttpRequestError with provider detail", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "FORBIDDEN", message: "not allowed" },
          { status: 403 },
        ),
      );
    const client = new HttpClient({ baseUrl: "https://example.test" });

    const err = await client
      .request("/x", {}, { maxRetries: 0, ignoreSuccessBody: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpRequestError);
    expect(err).toMatchObject({ status: 403 });
  });
});
