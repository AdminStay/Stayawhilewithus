// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  disconnectIntegrationAction: vi.fn(),
  syncAugustDevicesAction: vi.fn(),
  syncCieloDevicesAction: vi.fn(),
}));

vi.mock("../services/integrations.service", () => ({
  PROVIDER_CLIENT_STATUS: { AUGUST: "real", CIELO: "real" },
}));

vi.mock("./SyncNowButton", () => ({ SyncNowButton: () => null }));

import { IntegrationConnectionList } from "./IntegrationConnectionList";

afterEach(cleanup);

function connection(provider: "AUGUST" | "CIELO") {
  return {
    id: `conn-${provider}`,
    provider,
    displayName: provider === "AUGUST" ? "August" : "Cielo",
    authType: "API_KEY",
    status: "CONNECTED",
    lastSyncedAt: new Date("2026-10-12T21:00:00Z"),
    syncLogs: [],
  } as never;
}

describe("IntegrationConnectionList — August re-authorization (2026-10-21)", () => {
  it("shows the re-authorization message on the August card only, while the sign-in is refused", () => {
    render(
      <IntegrationConnectionList
        connections={[connection("AUGUST"), connection("CIELO")]}
        augustAuthFailedAt="2026-11-19T12:00:00.000Z"
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain(
      "August re-authorization required",
    );
    expect(alerts[0]!.textContent).toContain("Renew the August login");
  });

  it("shows nothing extra when the sign-in isn't refused", () => {
    render(
      <IntegrationConnectionList
        connections={[connection("AUGUST")]}
        augustAuthFailedAt={null}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("IntegrationConnectionList — August login expiry (2026-10-21)", () => {
  const expiringSoon = {
    state: "expiring_soon",
    expiresAt: "2026-11-19T11:32:00.000Z",
    renewBy: "2026-11-18T11:32:00.000Z",
    msLeft: 5 * 24 * 60 * 60 * 1000,
    renewByPassed: false,
  } as const;

  it("admin: the expiry warning, with the renewal steps, on the August card only", () => {
    const { container } = render(
      <IntegrationConnectionList
        connections={[connection("AUGUST"), connection("CIELO")]}
        augustTokenExpiry={expiringSoon}
        augustShowRenewalSteps
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain("August login expires in 5 days");
    expect(alerts[0]!.textContent).toContain(
      "Renew by Nov 18, 2026, 11:32 UTC",
    );
    expect(alerts[0]!.textContent).toContain("AUGUST_TOKEN_EXPIRES_AT");
    expect(
      container.querySelectorAll("[data-august-token-expiry]"),
    ).toHaveLength(1);
  });

  it("non-admin (the default): the same warning without steps or setting names", () => {
    render(
      <IntegrationConnectionList
        connections={[connection("AUGUST")]}
        augustTokenExpiry={expiringSoon}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "August login expires in 5 days (Nov 19, 2026, 11:32 UTC). An admin needs to renew it by Nov 18, 2026, 11:32 UTC.",
    );
  });

  it("keeps the sign-in-refused alert alongside the expiry warning", () => {
    render(
      <IntegrationConnectionList
        connections={[connection("AUGUST")]}
        augustAuthFailedAt="2026-11-19T12:00:00.000Z"
        augustTokenExpiry={{
          state: "expired",
          expiresAt: "2026-11-19T11:32:00.000Z",
        }}
        augustShowRenewalSteps
      />,
    );
    const texts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("August re-authorization required");
    expect(texts[1]).toContain("August login expired");
  });

  it("missing setting: the full message for admins, 'Expiry date not configured.' for everyone else", () => {
    const { container, rerender } = render(
      <IntegrationConnectionList
        connections={[connection("AUGUST")]}
        augustTokenExpiry={{ state: "not_configured", reason: "missing" }}
        augustShowRenewalSteps
      />,
    );
    expect(container.textContent).toContain(
      "August login expiry date not configured.",
    );
    expect(container.textContent).toContain("YYYY-MM-DDTHH:MM:SSZ");

    rerender(
      <IntegrationConnectionList
        connections={[connection("AUGUST")]}
        augustTokenExpiry={{ state: "not_configured", reason: "missing" }}
        augustShowRenewalSteps={false}
      />,
    );
    expect(container.textContent).toContain("Expiry date not configured.");
    expect(container.textContent).not.toContain("AUGUST_TOKEN_EXPIRES_AT");
  });
});
