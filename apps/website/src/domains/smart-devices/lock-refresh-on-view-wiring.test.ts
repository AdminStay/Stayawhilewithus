import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) =>
  readFileSync(resolve(here, path), "utf8").replace(
    /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
    "",
  );

/**
 * Source-level wiring guarantees for refresh-on-view (2026-09-27).
 */
describe("refresh-on-view wiring", () => {
  it("the /locks page render only READS freshness — it never starts a fleet refresh", () => {
    const page = read("../../../app/(dashboard)/locks/page.tsx");
    expect(page).toContain("getAugustRefreshFreshness(actor)");
    expect(page).not.toMatch(
      /refreshAugustTelemetryIfStale|refreshAugustTelemetryAutomatic|refresh-if-stale/,
    );
  });

  it("the client component only calls the gated endpoint with POST and no body — never a command action", () => {
    const component = read("./components/LockAutoRefresh.tsx");
    expect(component).toContain('"/api/locks/refresh-if-stale"');
    expect(component).not.toMatch(/body:/);
    expect(component).not.toMatch(
      /sendAugustLockCommand|lockCommandAction|resetAugustLock|OperationalHold|operate/,
    );
  });

  it("physical-command, reset and hold services were not given any refresh-on-view hook", () => {
    for (const file of [
      "./services/august-commands.service.ts",
      "./services/lock-operational-hold.service.ts",
      "./services/lock-control-settings.service.ts",
    ]) {
      expect(read(file)).not.toMatch(
        /refreshAugustTelemetryIfStale|LOCK_REFRESH_ON_VIEW|AUGUST_RATE_LIMITED_MARKER/,
      );
    }
  });
});
