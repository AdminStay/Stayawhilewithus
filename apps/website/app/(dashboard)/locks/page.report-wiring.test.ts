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
      "const needsAttentionCount = countLocksNeedingAttention(lockHealthRows);",
    );
    expect(source).toContain("needsAttentionCount={needsAttentionCount}");
  });

  it("three tabs (2026-09-30): report unchanged in its own tab; controls only on Fleet Status", () => {
    const report = source.slice(source.indexOf('{tab === "report" && ('));
    expect(report.slice(0, 200)).toMatch(
      /<LockHealthPanel rows=\{lockHealthRows\} now=\{healthNow\.toISOString\(\)\} \/>/,
    );
    const fleet = source.slice(
      source.indexOf('{tab === "fleet" && ('),
      source.indexOf('{tab === "report" && ('),
    );
    expect(fleet).toContain("<LockControlKillSwitch");
    expect(fleet).toContain("lockCommandAction={sendAugustLockCommandAction}");
    const verification = source.slice(
      source.indexOf('{tab === "verification" && ('),
    );
    expect(verification).not.toMatch(
      /sendAugustLockCommandAction|resetAugustLockAction/,
    );
    expect(verification).toContain(
      "canControlLocks ? recordLockVerificationEvidenceAction : undefined",
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
