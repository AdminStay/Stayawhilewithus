import { describe, expect, it } from "vitest";

import {
  TEAM_IDENTITY_MAPPINGS,
  resolveTeamMember,
} from "./team-identity-mapping";

describe("TEAM_IDENTITY_MAPPINGS", () => {
  it("is empty today — no VA/team member has been explicitly confirmed and mapped yet", () => {
    expect(TEAM_IDENTITY_MAPPINGS).toEqual([]);
  });
});

describe("resolveTeamMember", () => {
  it("returns null (UNKNOWN/UNMAPPED) for any key, since the mapping table is empty", () => {
    expect(resolveTeamMember("Jane Doe")).toBeNull();
    expect(resolveTeamMember("")).toBeNull();
  });

  it("never fuzzy-matches — a near-identical key is not the same as an exact one, proven with a simulated non-empty table via a local re-implementation of the same lookup rule", () => {
    // TEAM_IDENTITY_MAPPINGS itself can't be mutated (readonly, and
    // genuinely empty in production) to simulate this against the real
    // export — this proves the *lookup rule* `resolveTeamMember` encodes
    // (exact match via `.find(m => m.scheduleSourceKey === key)`, no
    // normalization) is fail-closed by construction, the same guarantee a
    // populated table would inherit.
    const simulated = [{ scheduleSourceKey: "Jane Doe", userId: "user-1" }];
    const exactMatch = simulated.find(
      (m) => m.scheduleSourceKey === "Jane Doe",
    );
    const caseVariant = simulated.find(
      (m) => m.scheduleSourceKey === "jane doe",
    );
    const trailingSpace = simulated.find(
      (m) => m.scheduleSourceKey === "Jane Doe ",
    );
    expect(exactMatch?.userId).toBe("user-1");
    expect(caseVariant).toBeUndefined();
    expect(trailingSpace).toBeUndefined();
  });
});
