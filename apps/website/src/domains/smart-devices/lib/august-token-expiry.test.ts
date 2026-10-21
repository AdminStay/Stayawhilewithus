import { describe, expect, it } from "vitest";

import {
  AUGUST_TOKEN_EXPIRY_WARNING_MS,
  AUGUST_TOKEN_RENEWAL_BUFFER_MS,
  describeAugustTokenExpiry,
  formatAugustExpiryTime,
  getAugustTokenExpiryStatus,
  parseAugustTokenExpiresAt,
} from "./august-token-expiry";

const EXPIRES = "2026-11-19T11:32:00.000Z";
const EXPIRES_MS = Date.parse(EXPIRES);
const at = (ms: number) => new Date(ms);
const DAY = 24 * 60 * 60 * 1000;

describe("parseAugustTokenExpiresAt", () => {
  it.each([
    ["2026-11-19T11:32:08.123Z", "2026-11-19T11:32:08.123Z"],
    ["2026-11-19T11:32Z", "2026-11-19T11:32:00.000Z"],
    ["2026-11-19T19:32:00+08:00", "2026-11-19T11:32:00.000Z"],
    ["  2026-11-19T11:32:00Z  ", "2026-11-19T11:32:00.000Z"],
  ])("accepts a zoned ISO date-time: %s", (raw, iso) => {
    expect(parseAugustTokenExpiresAt(raw)?.toISOString()).toBe(iso);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["date only (no time zone)", "2026-11-19"],
    ["no time zone", "2026-11-19T11:32:00"],
    ["impossible day (Date.parse would roll it over)", "2026-02-30T00:00:00Z"],
    ["month 13", "2026-13-01T00:00:00Z"],
    ["hour 24", "2026-11-19T24:00:00Z"],
    ["epoch number", "1795087920000"],
    ["words", "next Thursday"],
    ["US format", "11/19/2026 11:32"],
    ["a token pasted by mistake", "eyJhbGciOiJIUzI1NiJ9.e30.c2lnbmF0dXJl"],
  ])("rejects %s", (_label, raw) => {
    expect(parseAugustTokenExpiresAt(raw)).toBeNull();
  });
});

describe("getAugustTokenExpiryStatus — thresholds", () => {
  it("well before the warning window: ok, with when the warning starts and the renew-by time", () => {
    expect(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - 20 * DAY)),
    ).toEqual({
      state: "ok",
      expiresAt: EXPIRES,
      warnFrom: "2026-11-12T11:32:00.000Z",
      renewBy: "2026-11-18T11:32:00.000Z",
    });
  });

  it("1ms before the warning threshold: still ok", () => {
    const now = at(EXPIRES_MS - AUGUST_TOKEN_EXPIRY_WARNING_MS - 1);
    expect(getAugustTokenExpiryStatus(EXPIRES, now).state).toBe("ok");
  });

  it("exactly at the warning threshold (7 days before): expiring_soon", () => {
    const now = at(EXPIRES_MS - AUGUST_TOKEN_EXPIRY_WARNING_MS);
    expect(getAugustTokenExpiryStatus(EXPIRES, now)).toEqual({
      state: "expiring_soon",
      expiresAt: EXPIRES,
      renewBy: new Date(
        EXPIRES_MS - AUGUST_TOKEN_RENEWAL_BUFFER_MS,
      ).toISOString(),
      msLeft: AUGUST_TOKEN_EXPIRY_WARNING_MS,
      renewByPassed: false,
    });
  });

  it("inside the window, including past the renew-by time: expiring_soon", () => {
    expect(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - 3 * DAY)).state,
    ).toBe("expiring_soon");
    expect(getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - 1)).state).toBe(
      "expiring_soon",
    );
  });

  it("renew-by: not yet passed 1ms before it, passed exactly at it and after it — state stays expiring_soon", () => {
    const RENEW_BY_MS = EXPIRES_MS - AUGUST_TOKEN_RENEWAL_BUFFER_MS;
    const cases: [number, boolean][] = [
      [RENEW_BY_MS - 1, false],
      [RENEW_BY_MS, true],
      [RENEW_BY_MS + 1, true],
      [EXPIRES_MS - 1, true],
    ];
    for (const [ms, passed] of cases) {
      const status = getAugustTokenExpiryStatus(EXPIRES, at(ms));
      expect(status).toMatchObject({
        state: "expiring_soon",
        renewBy: "2026-11-18T11:32:00.000Z",
        renewByPassed: passed,
      });
    }
  });

  it("exactly at expiry: expired", () => {
    expect(getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS))).toEqual({
      state: "expired",
      expiresAt: EXPIRES,
    });
  });

  it("after expiry: expired", () => {
    expect(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS + 5 * DAY)).state,
    ).toBe("expired");
  });

  it("missing → not configured (missing); invalid → not configured (invalid); no date is invented", () => {
    const now = at(EXPIRES_MS);
    expect(getAugustTokenExpiryStatus(undefined, now)).toEqual({
      state: "not_configured",
      reason: "missing",
    });
    expect(getAugustTokenExpiryStatus("", now)).toEqual({
      state: "not_configured",
      reason: "missing",
    });
    expect(getAugustTokenExpiryStatus("2026-11-19", now)).toEqual({
      state: "not_configured",
      reason: "invalid",
    });
  });
});

const ADMIN = { showRenewalSteps: true };
const VIEWER = { showRenewalSteps: false };
/** Anything only an admin should see: setting names, Vercel, the login script. */
const ADMIN_ONLY = /AUGUST_|Vercel|login script|redeploy/;
const statusAt = (ms: number) => getAugustTokenExpiryStatus(EXPIRES, at(ms));

describe("describeAugustTokenExpiry — wording", () => {
  it("formats times in UTC", () => {
    expect(formatAugustExpiryTime(EXPIRES)).toBe("Nov 19, 2026, 11:32 UTC");
  });

  it("ok: the same quiet line for admins and non-admins", () => {
    for (const audience of [ADMIN, VIEWER]) {
      const d = describeAugustTokenExpiry(
        statusAt(EXPIRES_MS - 20 * DAY),
        audience,
      );
      expect(d.tone).toBe("neutral");
      expect(d.text).toBe(
        "August login expires Nov 19, 2026, 11:32 UTC. A renewal warning will appear from Nov 12, 2026, 11:32 UTC.",
      );
    }
  });

  it("admin, expiring soon before the renew-by time: deadline and renewal steps", () => {
    const d = describeAugustTokenExpiry(statusAt(EXPIRES_MS - 5 * DAY), ADMIN);
    expect(d.tone).toBe("warning");
    expect(d.text).toBe(
      "August login expires in 5 days (Nov 19, 2026, 11:32 UTC). Renew by Nov 18, 2026, 11:32 UTC: Renew the August login with the August login script, update AUGUST_ACCESS_TOKEN and AUGUST_TOKEN_EXPIRES_AT in the August settings in Vercel, and redeploy.",
    );
  });

  it("non-admin, expiring soon before the renew-by time: 'an admin needs to renew it by …', no steps", () => {
    const d = describeAugustTokenExpiry(statusAt(EXPIRES_MS - 5 * DAY), VIEWER);
    expect(d.tone).toBe("warning");
    expect(d.text).toBe(
      "August login expires in 5 days (Nov 19, 2026, 11:32 UTC). An admin needs to renew it by Nov 18, 2026, 11:32 UTC.",
    );
  });

  describe("renew-by time: before, exactly at, after", () => {
    const RENEW_BY_MS = EXPIRES_MS - AUGUST_TOKEN_RENEWAL_BUFFER_MS;

    it("1ms before it: still 'renew by' (admin) / 'renew it by' (non-admin)", () => {
      const admin = describeAugustTokenExpiry(statusAt(RENEW_BY_MS - 1), ADMIN);
      const viewer = describeAugustTokenExpiry(
        statusAt(RENEW_BY_MS - 1),
        VIEWER,
      );
      expect(admin.text).toContain("Renew by Nov 18, 2026, 11:32 UTC:");
      expect(viewer.text).toContain(
        "An admin needs to renew it by Nov 18, 2026, 11:32 UTC.",
      );
      for (const d of [admin, viewer])
        expect(d.text).not.toContain("Renew now");
    });

    it.each([
      ["exactly at it", 0],
      ["1ms after it", 1],
      ["12 hours after it", 12 * 60 * 60 * 1000],
      ["1ms before expiry", AUGUST_TOKEN_RENEWAL_BUFFER_MS - 1],
    ])(
      "%s: 'renew now', never the past deadline as an instruction",
      (_l, offset) => {
        const status = statusAt(RENEW_BY_MS + offset);
        expect(status.state).toBe("expiring_soon");

        const admin = describeAugustTokenExpiry(status, ADMIN);
        expect(admin.tone).toBe("warning");
        expect(admin.text).toContain(
          "Renew now — the recommended renew-by time (Nov 18, 2026, 11:32 UTC) has passed.",
        );
        expect(admin.text).toContain("and redeploy.");
        expect(admin.text).not.toContain("Renew by");

        const viewer = describeAugustTokenExpiry(status, VIEWER);
        expect(viewer.tone).toBe("warning");
        expect(viewer.text).toMatch(
          /^August login expires (in about \d+ hours?|in under an hour|in 1 day) \(Nov 19, 2026, 11:32 UTC\)\. An admin needs to renew it now — the recommended renew-by time has passed\.$/,
        );
      },
    );
  });

  it.each([
    [1 * DAY, "in 1 day"],
    [DAY - 1, "in about 23 hours"],
    [90 * 60 * 1000, "in about 1 hour"],
    [59 * 60 * 1000, "in under an hour"],
  ])("time left %ims → %s", (msLeft, phrase) => {
    const d = describeAugustTokenExpiry(statusAt(EXPIRES_MS - msLeft), ADMIN);
    expect(d.text).toContain(`August login expires ${phrase} (`);
  });

  it("admin, expired: error tone, says readings stop, and the renewal steps", () => {
    const d = describeAugustTokenExpiry(statusAt(EXPIRES_MS + DAY), ADMIN);
    expect(d.tone).toBe("error");
    expect(d.text).toContain("August login expired Nov 19, 2026, 11:32 UTC.");
    expect(d.text).toContain("lock readings stop updating");
    expect(d.text).toContain("update AUGUST_TOKEN_EXPIRES_AT too");
  });

  it("non-admin, expired: error tone, readings stop until an admin renews it", () => {
    const d = describeAugustTokenExpiry(statusAt(EXPIRES_MS + DAY), VIEWER);
    expect(d.tone).toBe("error");
    expect(d.text).toBe(
      "August login expired Nov 19, 2026, 11:32 UTC. Lock readings stop updating until an admin renews it.",
    );
  });

  it("admin, missing or invalid: names the setting with a format placeholder, never a realistic date", () => {
    const missing = describeAugustTokenExpiry(
      { state: "not_configured", reason: "missing" },
      ADMIN,
    );
    const invalid = describeAugustTokenExpiry(
      { state: "not_configured", reason: "invalid" },
      ADMIN,
    );
    expect(missing.text).toBe(
      "August login expiry date not configured. Set AUGUST_TOKEN_EXPIRES_AT in Vercel to the expiry time the August login script prints (format YYYY-MM-DDTHH:MM:SSZ) to get a warning before the login expires.",
    );
    for (const d of [missing, invalid]) {
      expect(d.tone).toBe("neutral");
      expect(d.text).toContain("YYYY-MM-DDTHH:MM:SSZ");
      expect(d.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(d.text).not.toMatch(/expires (in|Nov)|expired/);
    }
    expect(invalid.text).toContain("isn't a valid date-time with a time zone");
  });

  it("non-admin, missing or invalid: just 'Expiry date not configured.'", () => {
    for (const reason of ["missing", "invalid"] as const) {
      const d = describeAugustTokenExpiry(
        { state: "not_configured", reason },
        VIEWER,
      );
      expect(d).toEqual({
        tone: "neutral",
        text: "Expiry date not configured.",
      });
    }
  });

  it("non-admin wording never names a setting, Vercel or the login script, in any state", () => {
    const statuses = [
      statusAt(EXPIRES_MS - 20 * DAY),
      statusAt(EXPIRES_MS - 5 * DAY),
      statusAt(EXPIRES_MS - 12 * 60 * 60 * 1000),
      statusAt(EXPIRES_MS + DAY),
      { state: "not_configured", reason: "missing" } as const,
      { state: "not_configured", reason: "invalid" } as const,
    ];
    for (const status of statuses) {
      expect(describeAugustTokenExpiry(status, VIEWER).text).not.toMatch(
        ADMIN_ONLY,
      );
    }
  });

  it("the default audience is non-admin, so a caller that forgets the option shows no steps", () => {
    for (const status of [
      statusAt(EXPIRES_MS - 5 * DAY),
      statusAt(EXPIRES_MS + DAY),
      { state: "not_configured", reason: "missing" } as const,
    ]) {
      expect(describeAugustTokenExpiry(status)).toEqual(
        describeAugustTokenExpiry(status, VIEWER),
      );
    }
  });
});

describe("no credential or raw setting value is ever exposed", () => {
  const SECRET_LIKE = [
    "eyJhbGciOiJIUzI1NiJ9.e30.c2lnbmF0dXJl",
    "Bearer abc123secret",
    "install-1234-abcd",
    "2026-11-19 token=abc123secret",
  ];

  it.each(SECRET_LIKE)("an invalid value is not echoed: %s", (raw) => {
    const status = getAugustTokenExpiryStatus(raw, at(EXPIRES_MS));
    expect(status).toEqual({ state: "not_configured", reason: "invalid" });
    const all =
      JSON.stringify(status) +
      describeAugustTokenExpiry(status, ADMIN).text +
      describeAugustTokenExpiry(status, VIEWER).text;
    expect(all).not.toContain(raw);
    expect(all).not.toMatch(/eyJ|Bearer|abc123secret|install-1234/);
  });

  it("a valid value only ever comes back re-formatted, never as the raw string", () => {
    const raw = "2026-11-19T19:32:00+08:00";
    for (const ms of [
      EXPIRES_MS - 20 * DAY,
      EXPIRES_MS - DAY,
      EXPIRES_MS + DAY,
    ]) {
      const status = getAugustTokenExpiryStatus(raw, at(ms));
      expect(
        JSON.stringify(status) +
          describeAugustTokenExpiry(status, ADMIN).text +
          describeAugustTokenExpiry(status, VIEWER).text,
      ).not.toContain(raw);
    }
  });

  it("admin messages name the settings to update but carry no credential values", () => {
    const texts = [
      describeAugustTokenExpiry(statusAt(EXPIRES_MS - DAY), ADMIN).text,
      describeAugustTokenExpiry(statusAt(EXPIRES_MS + DAY), ADMIN).text,
      describeAugustTokenExpiry(
        { state: "not_configured", reason: "missing" },
        ADMIN,
      ).text,
    ];
    for (const t of texts) {
      expect(t).not.toMatch(
        /AUGUST_ACCESS_TOKEN=|AUGUST_INSTALL_ID|AUGUST_IDENTIFIER|Bearer|eyJ/,
      );
    }
  });
});
