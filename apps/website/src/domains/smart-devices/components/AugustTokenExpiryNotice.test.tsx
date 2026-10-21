// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AugustTokenExpiry } from "../lib/august-token-expiry";

import { AugustTokenExpiryNotice } from "./AugustTokenExpiryNotice";

afterEach(cleanup);

const EXPIRES = "2026-11-19T11:32:00.000Z";
const STATES: Record<AugustTokenExpiry["state"], AugustTokenExpiry> = {
  not_configured: { state: "not_configured", reason: "missing" },
  ok: {
    state: "ok",
    expiresAt: EXPIRES,
    renewBy: "2026-11-18T11:32:00.000Z",
    warnFrom: "2026-11-12T11:32:00.000Z",
  },
  expiring_soon: {
    state: "expiring_soon",
    expiresAt: EXPIRES,
    renewBy: "2026-11-18T11:32:00.000Z",
    msLeft: 3 * 24 * 60 * 60 * 1000,
    renewByPassed: false,
  },
  expired: { state: "expired", expiresAt: EXPIRES },
};

/** Anything that only an admin should see: setting names, Vercel, the login script. */
const ADMIN_ONLY = /AUGUST_|Vercel|login script|redeploy/;

describe("AugustTokenExpiryNotice (2026-10-21)", () => {
  it("admin, expiring soon: an alert with the renew-by deadline and the renewal steps", () => {
    render(
      <AugustTokenExpiryNotice
        status={STATES.expiring_soon}
        variant="card"
        showRenewalSteps
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("August login expires in 3 days");
    expect(alert.textContent).toContain("Renew by Nov 18, 2026, 11:32 UTC");
    expect(alert.textContent).toContain("redeploy");
    expect(alert.className).toContain("text-warning-700");
  });

  it("non-admin, expiring soon: the same dates and urgency, without the steps", () => {
    render(
      <AugustTokenExpiryNotice
        status={STATES.expiring_soon}
        variant="card"
        showRenewalSteps={false}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "August login expires in 3 days (Nov 19, 2026, 11:32 UTC). An admin needs to renew it by Nov 18, 2026, 11:32 UTC.",
    );
    expect(alert.className).toContain("text-warning-700");
  });

  it("admin vs non-admin, expired: both error alerts; steps for the admin only", () => {
    render(
      <AugustTokenExpiryNotice
        status={STATES.expired}
        variant="card"
        showRenewalSteps
      />,
    );
    const admin = screen.getByRole("alert");
    expect(admin.textContent).toContain(
      "August login expired Nov 19, 2026, 11:32 UTC",
    );
    expect(admin.textContent).toMatch(ADMIN_ONLY);
    expect(admin.className).toContain("text-error-500");
    cleanup();

    render(
      <AugustTokenExpiryNotice
        status={STATES.expired}
        variant="card"
        showRenewalSteps={false}
      />,
    );
    const viewer = screen.getByRole("alert");
    expect(viewer.textContent).toBe(
      "August login expired Nov 19, 2026, 11:32 UTC. Lock readings stop updating until an admin renews it.",
    );
    expect(viewer.className).toContain("text-error-500");
  });

  it("ok and not configured are quiet lines, not alerts; not configured is short for non-admins", () => {
    const { container, rerender } = render(
      <AugustTokenExpiryNotice
        status={STATES.ok}
        variant="card"
        showRenewalSteps={false}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain(
      "August login expires Nov 19, 2026, 11:32 UTC.",
    );

    rerender(
      <AugustTokenExpiryNotice
        status={STATES.not_configured}
        variant="card"
        showRenewalSteps
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain(
      "August login expiry date not configured.",
    );
    expect(container.textContent).toContain("AUGUST_TOKEN_EXPIRES_AT");

    rerender(
      <AugustTokenExpiryNotice
        status={STATES.not_configured}
        variant="card"
        showRenewalSteps={false}
      />,
    );
    expect(container.textContent).toBe("Expiry date not configured.");
  });

  it("non-admins never see setting names, Vercel or the login script, in any state", () => {
    for (const status of Object.values(STATES)) {
      const { container } = render(
        <AugustTokenExpiryNotice
          status={status}
          variant="card"
          showRenewalSteps={false}
        />,
      );
      expect(container.textContent).not.toMatch(ADMIN_ONLY);
      cleanup();
    }
  });

  it("banner (/locks): only expiring soon and expired are shown, for either audience", () => {
    for (const showRenewalSteps of [true, false]) {
      for (const state of ["ok", "not_configured"] as const) {
        const { container } = render(
          <AugustTokenExpiryNotice
            status={STATES[state]}
            variant="banner"
            showRenewalSteps={showRenewalSteps}
          />,
        );
        expect(container.textContent).toBe("");
        cleanup();
      }
      for (const state of ["expiring_soon", "expired"] as const) {
        render(
          <AugustTokenExpiryNotice
            status={STATES[state]}
            variant="banner"
            showRenewalSteps={showRenewalSteps}
          />,
        );
        expect(screen.getByRole("alert").dataset.augustTokenExpiry).toBe(state);
        cleanup();
      }
    }
  });
});
