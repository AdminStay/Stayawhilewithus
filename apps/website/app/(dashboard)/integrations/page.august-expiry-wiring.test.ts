import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const integrations = readFileSync(resolve(here, "./page.tsx"), "utf8");
const locks = readFileSync(resolve(here, "../locks/page.tsx"), "utf8");

describe("August login expiry wiring (2026-10-21)", () => {
  it("/integrations reads it under integrations:read and passes it to the cards", () => {
    expect(integrations).toMatch(
      /getAugustTokenExpiry\(\s*actor,\s*"integrations:read",?\s*\)/,
    );
    expect(integrations).toContain("augustTokenExpiry={augustTokenExpiry}");
  });

  it("/locks reads it under smart_devices:read and shows the banner variant next to the auto-refresh line", () => {
    expect(locks).toMatch(
      /getAugustTokenExpiry\(\s*actor,\s*"smart_devices:read",?\s*\)/,
    );
    const autoRefresh = locks.slice(locks.indexOf("<LockAutoRefresh"));
    expect(autoRefresh.slice(0, 600)).toMatch(
      /<AugustTokenExpiryNotice\s+status=\{augustTokenExpiry\}\s+variant="banner"/,
    );
    // The existing sign-in-refused wiring is unchanged.
    expect(locks).toContain(
      "initialAuthFailedAt={refreshFreshness.authFailedAt}",
    );
  });

  it("neither page reads settings directly or names an August credential", () => {
    for (const source of [integrations, locks]) {
      expect(source).not.toContain("process.env");
      expect(source).not.toMatch(
        /AUGUST_ACCESS_TOKEN|AUGUST_INSTALL_ID|AUGUST_IDENTIFIER/,
      );
    }
  });
});
