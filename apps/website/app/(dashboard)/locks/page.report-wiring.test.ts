import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "./page.tsx"),
  "utf8",
);

describe("/locks daily lock report wiring (2026-09-29)", () => {
  it("the report and the top 'Needs attention' metric both come from the same classifier rows", () => {
    expect(source).toMatch(
      /<LockHealthPanel\s+rows=\{lockHealthRows\}\s+now=\{healthNow\.toISOString\(\)\}/,
    );
    expect(source).toContain(
      "needsAttentionCount={countLocksNeedingAttention(lockHealthRows)}",
    );
  });

  it("command eligibility inputs are unchanged — the report never feeds control decisions", () => {
    const ctx = source.slice(
      source.indexOf("const ctx = {"),
      source.indexOf("};", source.indexOf("const ctx = {")),
    );
    for (const field of [
      "externalDeviceId",
      "connectivity: lock.status",
      "lastOutcome",
      "lockControlEnabled: lockControl.enabled",
      "operationalHold:",
    ]) {
      expect(ctx).toContain(field);
    }
    expect(ctx).not.toMatch(/report|needsAttention|action/i);
    expect(source).toContain(
      "controlEligibility: isAugust ? computeLockControlEligibility(ctx) : null",
    );
    expect(source).toContain(
      "firstTestEligibility: isAugust ? computeFirstTestEligibility(ctx) : null",
    );
  });
});
