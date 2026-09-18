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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
});
