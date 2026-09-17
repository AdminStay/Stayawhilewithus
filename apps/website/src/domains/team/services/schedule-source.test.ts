import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchScheduleSheetCsv } from "./schedule-source";

const mockFetch = vi.fn();
const originalFetch = global.fetch;

describe("fetchScheduleSheetCsv", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockReset();
  });

  it("issues exactly one GET request to Google's unauthenticated CSV export endpoint for the confirmed spreadsheet/tab", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "a,b\n1,2\n",
    });

    await fetchScheduleSheetCsv();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://docs.google.com/spreadsheets/d/1DNMYvmlY-I2rUOERlizjfmbfaw4RGVJDs8yrp_pRVv8/export?format=csv&gid=583841225",
    );
    expect(init.method).toBe("GET");
  });

  it("returns { ok: true, csvText } on a successful non-empty response", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "a,b\n1,2\n",
    });

    const result = await fetchScheduleSheetCsv();
    expect(result).toEqual({ ok: true, csvText: "a,b\n1,2\n" });
  });

  it("returns a NON_200 failure without throwing when the response isn't ok", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "",
    });

    const result = await fetchScheduleSheetCsv();
    expect(result).toEqual({
      ok: false,
      reason: "NON_200",
      detail: "Export request returned HTTP 404.",
    });
  });

  it("returns an EMPTY_RESPONSE failure for a 200 with a blank body", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "   \n",
    });

    const result = await fetchScheduleSheetCsv();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("EMPTY_RESPONSE");
  });

  it("returns a NETWORK_ERROR failure without throwing when fetch itself rejects", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

    const result = await fetchScheduleSheetCsv();
    expect(result).toEqual({
      ok: false,
      reason: "NETWORK_ERROR",
      detail: "getaddrinfo ENOTFOUND",
    });
  });

  it("returns a TIMEOUT failure without throwing when fetch rejects with an AbortError", async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await fetchScheduleSheetCsv();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("TIMEOUT");
  });
});
