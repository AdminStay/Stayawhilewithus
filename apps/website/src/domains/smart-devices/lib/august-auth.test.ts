import { HttpRequestError } from "@stayw/integrations/core";
import { describe, expect, it } from "vitest";

import { isAugustAuthFailure } from "./august-auth";
import {
  AUGUST_AUTO_REFRESH_PAUSED_MESSAGE,
  augustReauthorizationMessage,
} from "./august-reauthorization";

describe("isAugustAuthFailure (2026-10-21)", () => {
  it("401 is an account sign-in failure", () => {
    expect(isAugustAuthFailure(new HttpRequestError("/locks/x", 401))).toBe(
      true,
    );
  });

  it("a plain 403, or one naming a device problem, is not (device-specific)", () => {
    expect(isAugustAuthFailure(new HttpRequestError("/locks/x", 403))).toBe(
      false,
    );
    expect(
      isAugustAuthFailure(
        new HttpRequestError("/locks/x", 403, {
          providerErrorCode: "device_not_authorized",
          providerMessage: "no bridge registered for this lock",
        }),
      ),
    ).toBe(false);
  });

  it("a 403 whose provider text names a token/session/credential problem is (same rule as lock commands)", () => {
    for (const providerMessage of [
      "session token expired, please re-authenticate",
      "invalid credentials",
      "Unauthorized",
    ]) {
      expect(
        isAugustAuthFailure(
          new HttpRequestError("/locks/x", 403, { providerMessage }),
        ),
      ).toBe(true);
    }
  });

  it("other statuses and non-HTTP errors are not — including a message that merely contains '401'", () => {
    for (const status of [400, 404, 422, 429, 500]) {
      expect(isAugustAuthFailure(new HttpRequestError("/x", status))).toBe(
        false,
      );
    }
    expect(isAugustAuthFailure(new Error("got 401 from proxy"))).toBe(false);
    expect(isAugustAuthFailure(new TypeError("fetch failed"))).toBe(false);
    expect(isAugustAuthFailure(undefined)).toBe(false);
  });
});

describe("August re-authorization wording (2026-10-21)", () => {
  it("names the fix and the not-requested count, never a credential", () => {
    expect(augustReauthorizationMessage(1)).toContain(
      "1 lock was not requested.",
    );
    expect(augustReauthorizationMessage(7)).toContain(
      "7 locks were not requested.",
    );
    expect(augustReauthorizationMessage(0)).not.toContain("not requested");
    for (const text of [
      augustReauthorizationMessage(3),
      AUGUST_AUTO_REFRESH_PAUSED_MESSAGE,
    ]) {
      expect(text).toContain("Renew the August login");
      expect(text).not.toMatch(/AUGUST_ACCESS_TOKEN|token=|Bearer/);
    }
  });
});
