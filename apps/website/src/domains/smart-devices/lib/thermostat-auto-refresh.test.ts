import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatNestRefreshFailure,
  parseNestRefreshFailure,
} from "./nest-health";
import {
  CIELO_AUTH_RETRY_MS,
  CIELO_AUTO_MIN_INTERVAL_MS,
  countConsecutiveRefreshFailures,
  decideCieloAutoRefresh,
  decideNestAutoRefresh,
  decideThermostatRefreshAlert,
  formatCieloRefreshFailure,
  isThermostatAutoRefreshEnabled,
  NEST_AUTO_MIN_INTERVAL_MS,
  parseCieloRefreshFailure,
  type RefreshAttemptLike,
  THERMOSTAT_AUTO_REFRESH_SCHEDULE,
} from "./thermostat-auto-refresh";

const NOW = new Date("2026-10-27T12:00:00Z");
const MIN = 60 * 1000;

function attempt(
  status: RefreshAttemptLike["status"],
  minutesAgo: number,
  errorMessage: string | null = null,
): RefreshAttemptLike {
  const startedAt = new Date(NOW.getTime() - minutesAgo * MIN);
  return { status, startedAt, finishedAt: startedAt, errorMessage };
}

const NEST_AUTH = formatNestRefreshFailure("NEST_AUTH_EXPIRED");
const NEST_API = formatNestRefreshFailure("NEST_PROVIDER_ERROR", 503);
const CIELO_AUTH = formatCieloRefreshFailure("CIELO_AUTH_FAILED");
const CIELO_API = formatCieloRefreshFailure("CIELO_PROVIDER_ERROR", 500);
const isNestAuth = (m: string | null) =>
  parseNestRefreshFailure(m) === "NEST_AUTH_EXPIRED";

describe("isThermostatAutoRefreshEnabled — off unless exactly 'true'", () => {
  it.each([undefined, "", "TRUE", "1", "yes", "true "])("%s → off", (value) => {
    expect(
      isThermostatAutoRefreshEnabled({
        THERMOSTAT_AUTO_REFRESH_ENABLED: value,
      }),
    ).toBe(false);
  });
  it("'true' → on", () => {
    expect(
      isThermostatAutoRefreshEnabled({
        THERMOSTAT_AUTO_REFRESH_ENABLED: "true",
      }),
    ).toBe(true);
  });
  it("missing → off", () => {
    expect(isThermostatAutoRefreshEnabled({})).toBe(false);
  });
});

describe("vercel.json cron entry", () => {
  const vercelJson = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../vercel.json",
      ),
      "utf8",
    ),
  ) as { crons: Array<{ path: string; schedule: string }> };

  it("has exactly one thermostat cron, every 30 minutes", () => {
    expect(
      vercelJson.crons.filter((c) => c.path.includes("thermostat")),
    ).toEqual([
      {
        path: "/api/cron/thermostat-refresh",
        schedule: THERMOSTAT_AUTO_REFRESH_SCHEDULE,
      },
    ]);
    expect(THERMOSTAT_AUTO_REFRESH_SCHEDULE).toBe("*/30 * * * *");
  });
});

describe("Cielo failure text — fixed codes only", () => {
  it("formats a code, a fixed sentence and an optional HTTP status, and parses the code back", () => {
    expect(formatCieloRefreshFailure("CIELO_PROVIDER_ERROR", 502)).toBe(
      "CIELO_PROVIDER_ERROR: The Cielo API request failed. (HTTP 502)",
    );
    expect(parseCieloRefreshFailure(CIELO_AUTH)).toBe("CIELO_AUTH_FAILED");
    expect(parseCieloRefreshFailure("Cielo login failed: bad password")).toBe(
      null,
    );
    expect(parseCieloRefreshFailure(null)).toBe(null);
  });
});

describe("countConsecutiveRefreshFailures", () => {
  it("counts FAILED newest-first until anything else; RUNNING is skipped", () => {
    expect(
      countConsecutiveRefreshFailures([
        attempt("RUNNING", 0),
        attempt("FAILED", 30),
        attempt("FAILED", 60),
        attempt("SUCCEEDED", 90),
        attempt("FAILED", 120),
      ]),
    ).toBe(2);
    expect(countConsecutiveRefreshFailures([])).toBe(0);
  });
});

describe("decideNestAutoRefresh", () => {
  it("runs with no history", () => {
    expect(decideNestAutoRefresh([], NOW, isNestAuth)).toBe("run");
  });

  it("runs when the newest attempt started at least the minimum interval ago", () => {
    expect(
      decideNestAutoRefresh(
        [attempt("SUCCEEDED", NEST_AUTO_MIN_INTERVAL_MS / MIN)],
        NOW,
        isNestAuth,
      ),
    ).toBe("run");
  });

  it("skips when a refresh (e.g. a manual click) started within the minimum interval", () => {
    expect(
      decideNestAutoRefresh([attempt("SUCCEEDED", 3)], NOW, isNestAuth),
    ).toBe("recently_refreshed");
  });

  it("pauses after NEST_AUTH_EXPIRED until a later success — however old the failure is", () => {
    expect(
      decideNestAutoRefresh(
        [attempt("FAILED", 600, NEST_AUTH)],
        NOW,
        isNestAuth,
      ),
    ).toBe("auth_required");
    expect(
      decideNestAutoRefresh(
        [attempt("FAILED", 30, NEST_API), attempt("FAILED", 60, NEST_AUTH)],
        NOW,
        isNestAuth,
      ),
    ).toBe("auth_required");
  });

  it("a success after the auth failure (the manual Refresh after reauthorizing) resumes it", () => {
    expect(
      decideNestAutoRefresh(
        [attempt("SUCCEEDED", 40), attempt("FAILED", 90, NEST_AUTH)],
        NOW,
        isNestAuth,
      ),
    ).toBe("run");
  });

  it("an ordinary provider failure does not pause it", () => {
    expect(
      decideNestAutoRefresh([attempt("FAILED", 30, NEST_API)], NOW, isNestAuth),
    ).toBe("run");
  });
});

describe("decideCieloAutoRefresh — about hourly, every other 30-minute run", () => {
  it("runs with no history", () => {
    expect(decideCieloAutoRefresh([], NOW)).toBe("run");
  });

  it("is not due 30 minutes after the last attempt, and due 60 minutes after", () => {
    expect(decideCieloAutoRefresh([attempt("SUCCEEDED", 30)], NOW)).toBe(
      "not_due",
    );
    expect(decideCieloAutoRefresh([attempt("SUCCEEDED", 60)], NOW)).toBe("run");
    expect(CIELO_AUTO_MIN_INTERVAL_MS).toBeLessThan(60 * MIN);
    expect(CIELO_AUTO_MIN_INTERVAL_MS).toBeGreaterThan(30 * MIN);
  });

  it("after a refused sign-in waits CIELO_AUTH_RETRY_MS before trying again", () => {
    expect(
      decideCieloAutoRefresh([attempt("FAILED", 90, CIELO_AUTH)], NOW),
    ).toBe("auth_retry_wait");
    expect(
      decideCieloAutoRefresh(
        [attempt("FAILED", CIELO_AUTH_RETRY_MS / MIN, CIELO_AUTH)],
        NOW,
      ),
    ).toBe("run");
  });

  it("an ordinary failure is retried at the normal hourly pace", () => {
    expect(
      decideCieloAutoRefresh([attempt("FAILED", 60, CIELO_API)], NOW),
    ).toBe("run");
  });
});

describe("decideThermostatRefreshAlert — once per incident", () => {
  const never = () => false;

  it("no alert after a success, or with no history", () => {
    for (const attempts of [[], [attempt("SUCCEEDED", 1)]]) {
      expect(
        decideThermostatRefreshAlert({
          attemptsNewestFirst: attempts,
          isAuthFailure: isNestAuth,
          alreadyAlerted: never,
        }),
      ).toBe(null);
    }
  });

  it("an authorization failure alerts on its first occurrence", () => {
    expect(
      decideThermostatRefreshAlert({
        attemptsNewestFirst: [attempt("FAILED", 1, NEST_AUTH)],
        isAuthFailure: isNestAuth,
        alreadyAlerted: never,
      }),
    ).toBe("auth_failed");
  });

  it("other failures alert only after 3 in a row", () => {
    const two = [
      attempt("FAILED", 1, NEST_API),
      attempt("FAILED", 31, NEST_API),
    ];
    expect(
      decideThermostatRefreshAlert({
        attemptsNewestFirst: two,
        isAuthFailure: isNestAuth,
        alreadyAlerted: never,
      }),
    ).toBe(null);
    expect(
      decideThermostatRefreshAlert({
        attemptsNewestFirst: [...two, attempt("FAILED", 61, NEST_API)],
        isAuthFailure: isNestAuth,
        alreadyAlerted: never,
      }),
    ).toBe("consecutive_failures");
  });

  it("an existing alert for the same reason since the last success suppresses a repeat", () => {
    expect(
      decideThermostatRefreshAlert({
        attemptsNewestFirst: [attempt("FAILED", 1, NEST_AUTH)],
        isAuthFailure: isNestAuth,
        alreadyAlerted: (reason) => reason === "auth_failed",
      }),
    ).toBe(null);
    expect(
      decideThermostatRefreshAlert({
        attemptsNewestFirst: [
          attempt("FAILED", 1, NEST_API),
          attempt("FAILED", 31, NEST_API),
          attempt("FAILED", 61, NEST_API),
        ],
        isAuthFailure: isNestAuth,
        alreadyAlerted: (reason) => reason === "consecutive_failures",
      }),
    ).toBe(null);
  });
});
