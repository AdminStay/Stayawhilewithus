import { describe, expect, it, vi } from "vitest";

import { defaultIsRetryable, withRetry } from "./retry";

describe("defaultIsRetryable", () => {
  it("treats 429 and 5xx as retryable", () => {
    expect(defaultIsRetryable({ status: 429 })).toBe(true);
    expect(defaultIsRetryable({ status: 500 })).toBe(true);
    expect(defaultIsRetryable({ status: 503 })).toBe(true);
  });

  it("treats other 4xx as not retryable", () => {
    expect(defaultIsRetryable({ status: 400 })).toBe(false);
    expect(defaultIsRetryable({ status: 401 })).toBe(false);
    expect(defaultIsRetryable({ status: 404 })).toBe(false);
  });

  it("treats an error with no status (e.g. network failure) as retryable", () => {
    expect(defaultIsRetryable(new Error("fetch failed"))).toBe(true);
  });
});

describe("withRetry", () => {
  it("returns the result immediately on first success, no delay", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");

    const result = await withRetry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to maxRetries, then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { initialDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on a non-retryable error, without retrying", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ status: 401 });

    await expect(withRetry(fn, { initialDelayMs: 1 })).rejects.toEqual({
      status: 401,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error once maxRetries is exhausted", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelayMs: 1 }),
    ).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("honors a custom isRetryable predicate", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("custom-retryable"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, {
      initialDelayMs: 1,
      isRetryable: (err) =>
        err instanceof Error && err.message === "custom-retryable",
    });

    expect(result).toBe("ok");
  });
});
