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
  },
  expired: { state: "expired", expiresAt: EXPIRES },
};

describe("AugustTokenExpiryNotice (2026-10-21)", () => {
  it("card: expiring soon is an alert with the renew-by deadline and steps", () => {
    render(
      <AugustTokenExpiryNotice status={STATES.expiring_soon} variant="card" />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("August login expires in 3 days");
    expect(alert.textContent).toContain("Renew by Nov 18, 2026, 11:32 UTC");
    expect(alert.textContent).toContain("redeploy");
    expect(alert.className).toContain("text-warning-700");
  });

  it("card: expired is an error alert", () => {
    render(<AugustTokenExpiryNotice status={STATES.expired} variant="card" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "August login expired Nov 19, 2026, 11:32 UTC",
    );
    expect(alert.className).toContain("text-error-500");
  });

  it("card: ok and not configured are quiet lines, not alerts", () => {
    const { container, rerender } = render(
      <AugustTokenExpiryNotice status={STATES.ok} variant="card" />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain(
      "August login expires Nov 19, 2026, 11:32 UTC.",
    );

    rerender(
      <AugustTokenExpiryNotice status={STATES.not_configured} variant="card" />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain(
      "August login expiry date not configured.",
    );
  });

  it("banner (/locks): only expiring soon and expired are shown", () => {
    for (const state of ["ok", "not_configured"] as const) {
      const { container } = render(
        <AugustTokenExpiryNotice status={STATES[state]} variant="banner" />,
      );
      expect(container.textContent).toBe("");
      cleanup();
    }
    for (const state of ["expiring_soon", "expired"] as const) {
      render(
        <AugustTokenExpiryNotice status={STATES[state]} variant="banner" />,
      );
      expect(screen.getByRole("alert").dataset.augustTokenExpiry).toBe(state);
      cleanup();
    }
  });
});
