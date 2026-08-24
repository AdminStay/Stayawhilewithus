/**
 * Proves the actual Notion-Version header sent on the wire, end-to-end
 * through the real HttpClient (not the class-replacing mock used in
 * client.test.ts) — because a per-call header override is only meaningful if
 * it's provably scoped to queryDataSource() and doesn't leak into every
 * other method's requests. See HANDOFF.md Increments 44-46.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotionClient } from "./client";

const mockFetch = vi.fn();
const originalFetch = global.fetch;

function stubFetchOnce(status: number, body: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("NotionClient — Notion-Version header (real HttpClient, fetch-level)", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockReset();
  });

  it("sends the stable default (2022-06-28) for /users/me via connect()", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    stubFetchOnce(200, { id: "u1" });
    const client = new NotionClient({ token: "secret_test" });

    await client.connect();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/users/me");
    expect((init.headers as Record<string, string>)["Notion-Version"]).toBe(
      "2022-06-28",
    );
  });

  it("sends the stable default (2022-06-28) for /search via sync()", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    stubFetchOnce(200, { results: [], has_more: false, next_cursor: null });
    const client = new NotionClient({ token: "secret_test" });

    await client.sync("INBOUND");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/search");
    expect((init.headers as Record<string, string>)["Notion-Version"]).toBe(
      "2022-06-28",
    );
  });

  it("sends 2026-03-11 for queryDataSource() only — a same-client subsequent call to an existing method still uses the default", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    stubFetchOnce(200, { results: [], has_more: false, next_cursor: null });
    const client = new NotionClient({ token: "secret_test" });

    await client.queryDataSource("ds-123", 1);

    const [firstUrl, firstInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(firstUrl).toContain("/data_sources/ds-123/query");
    expect(
      (firstInit.headers as Record<string, string>)["Notion-Version"],
    ).toBe("2026-03-11");

    stubFetchOnce(200, { id: "u1" });
    await client.connect();

    const [, secondInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(
      (secondInit.headers as Record<string, string>)["Notion-Version"],
    ).toBe("2022-06-28");
  });
});
