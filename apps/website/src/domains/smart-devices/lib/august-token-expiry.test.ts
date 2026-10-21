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

describe("describeAugustTokenExpiry — wording", () => {
  it("formats times in UTC", () => {
    expect(formatAugustExpiryTime(EXPIRES)).toBe("Nov 19, 2026, 11:32 UTC");
  });

  it("ok: quiet line with the expiry and when the warning starts", () => {
    const d = describeAugustTokenExpiry(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - 20 * DAY)),
    );
    expect(d.tone).toBe("neutral");
    expect(d.text).toBe(
      "August login expires Nov 19, 2026, 11:32 UTC. A renewal warning will appear from Nov 12, 2026, 11:32 UTC.",
    );
  });

  it("expiring soon: time left, renew-by deadline and the renewal steps", () => {
    const d = describeAugustTokenExpiry(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - 5 * DAY)),
    );
    expect(d.tone).toBe("warning");
    expect(d.text).toContain(
      "August login expires in 5 days (Nov 19, 2026, 11:32 UTC).",
    );
    expect(d.text).toContain("Renew by Nov 18, 2026, 11:32 UTC:");
    expect(d.text).toContain(
      "Renew the August login with the August login script",
    );
    expect(d.text).toContain(
      "update AUGUST_ACCESS_TOKEN and AUGUST_TOKEN_EXPIRES_AT in the August settings in Vercel, and redeploy.",
    );
  });

  it.each([
    [1 * DAY, "in 1 day"],
    [DAY - 1, "in about 23 hours"],
    [90 * 60 * 1000, "in about 1 hour"],
    [59 * 60 * 1000, "in under an hour"],
  ])("time left %ims → %s", (msLeft, phrase) => {
    const d = describeAugustTokenExpiry(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - msLeft)),
    );
    expect(d.text).toContain(`August login expires ${phrase} (`);
  });

  it("expired: error tone, says readings stop, and the renewal steps", () => {
    const d = describeAugustTokenExpiry(
      getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS + DAY)),
    );
    expect(d.tone).toBe("error");
    expect(d.text).toContain("August login expired Nov 19, 2026, 11:32 UTC.");
    expect(d.text).toContain("lock readings stop updating");
    expect(d.text).toContain("update AUGUST_TOKEN_EXPIRES_AT too");
  });

  it("missing and invalid: 'expiry date not configured', never a date", () => {
    const missing = describeAugustTokenExpiry({
      state: "not_configured",
      reason: "missing",
    });
    const invalid = describeAugustTokenExpiry({
      state: "not_configured",
      reason: "invalid",
    });
    for (const d of [missing, invalid]) {
      expect(d.tone).toBe("neutral");
      expect(d.text).toContain("August login expiry date not configured.");
      expect(d.text).not.toMatch(/expires (in|Nov)|expired/);
    }
    expect(invalid.text).toContain("isn't a valid date-time with a time zone");
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
    const all = JSON.stringify(status) + describeAugustTokenExpiry(status).text;
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
        JSON.stringify(status) + describeAugustTokenExpiry(status).text,
      ).not.toContain(raw);
    }
  });

  it("messages name the settings to update but carry no credential values", () => {
    const texts = [
      describeAugustTokenExpiry(
        getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS - DAY)),
      ).text,
      describeAugustTokenExpiry(
        getAugustTokenExpiryStatus(EXPIRES, at(EXPIRES_MS + DAY)),
      ).text,
      describeAugustTokenExpiry({ state: "not_configured", reason: "missing" })
        .text,
    ];
    for (const t of texts) {
      expect(t).not.toMatch(
        /AUGUST_ACCESS_TOKEN=|AUGUST_INSTALL_ID|AUGUST_IDENTIFIER|Bearer|eyJ/,
      );
    }
  });
});
