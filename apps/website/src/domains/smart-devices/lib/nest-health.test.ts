import { describe, expect, it } from "vitest";

import {
  formatNestRefreshFailure,
  isThermostatReadingStale,
  parseNestRefreshFailure,
  summarizeNestHealth,
} from "./nest-health";

const NOW = new Date("2026-09-27T21:00:00.000Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("nest-health (2026-09-27, Nest Phase 1)", () => {
  it("stored failures are a stable code + fixed sentence; only an integer HTTP status is ever appended", () => {
    expect(formatNestRefreshFailure("NEST_AUTH_EXPIRED")).toMatch(
      /^NEST_AUTH_EXPIRED: Google authorization for Nest has expired or been revoked\./,
    );
    expect(formatNestRefreshFailure("NEST_PROVIDER_ERROR", 503)).toBe(
      "NEST_PROVIDER_ERROR: The Google Nest API request failed. (HTTP 503)",
    );
    expect(
      formatNestRefreshFailure("NEST_PROVIDER_ERROR", "x-token" as never),
    ).toBe("NEST_PROVIDER_ERROR: The Google Nest API request failed.");
  });

  it("parses only known codes", () => {
    expect(parseNestRefreshFailure("NEST_AUTH_EXPIRED: …")).toBe(
      "NEST_AUTH_EXPIRED",
    );
    expect(parseNestRefreshFailure("Something else")).toBeNull();
    expect(parseNestRefreshFailure(null)).toBeNull();
  });

  it("a reading is stale when older than 24 h or missing", () => {
    expect(isThermostatReadingStale(new Date(ago(23 * HOUR)), NOW)).toBe(false);
    expect(isThermostatReadingStale(new Date(ago(25 * HOUR)), NOW)).toBe(true);
    expect(isThermostatReadingStale(null, NOW)).toBe(true);
  });

  const base = {
    lastAttempt: null,
    lastSucceededAt: null,
    newestReadingAt: ago(HOUR),
    nestThermostatCount: 3,
    now: NOW,
  };

  it("fresh readings and no failed attempt → ok", () => {
    expect(summarizeNestHealth(base).state).toBe("ok");
  });

  it("no Nest thermostats → no banner", () => {
    expect(summarizeNestHealth({ ...base, nestThermostatCount: 0 }).state).toBe(
      "no_devices",
    );
  });

  it("old readings with no refresh ever recorded → stale (flagged immediately after release, no refresh needed)", () => {
    const h = summarizeNestHealth({
      ...base,
      newestReadingAt: ago(17 * 24 * HOUR),
    });
    expect(h.state).toBe("stale");
    expect(h.headline).toMatch(/stale/i);
    expect(h.lastAttemptAt).toBeNull();
  });

  it("a recorded authorization failure wins over everything → needs_reauthorization", () => {
    const h = summarizeNestHealth({
      ...base,
      lastAttempt: {
        status: "FAILED",
        finishedAt: ago(60_000),
        errorMessage: formatNestRefreshFailure("NEST_AUTH_EXPIRED"),
      },
      lastSucceededAt: ago(17 * 24 * HOUR),
    });
    expect(h.state).toBe("needs_reauthorization");
    expect(h.headline).toMatch(/reauthorized/);
    expect(h.lastAttemptOk).toBe(false);
  });

  it("another failed attempt → refresh_failing, even if readings still look recent", () => {
    const h = summarizeNestHealth({
      ...base,
      lastAttempt: {
        status: "FAILED",
        finishedAt: ago(60_000),
        errorMessage: formatNestRefreshFailure("NEST_PROVIDER_ERROR", 500),
      },
    });
    expect(h.state).toBe("refresh_failing");
    expect(h.headline).toMatch(/last Nest refresh failed/);
  });

  it("a successful last attempt with old readings is still stale", () => {
    expect(
      summarizeNestHealth({
        ...base,
        lastAttempt: {
          status: "SUCCEEDED",
          finishedAt: ago(60_000),
          errorMessage: null,
        },
        newestReadingAt: ago(30 * HOUR),
      }).state,
    ).toBe("stale");
  });
});
