import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({ prisma: {} }));
vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

import {
  computeLockControlEligibility,
  type LockControlContext,
} from "../services/august-commands.service";

import {
  describeRemoteControlAvailability,
  REMOTE_CONTROL_AVAILABILITY_LABELS,
} from "./remote-control-availability";

const OUTCOMES = [
  undefined,
  "SUCCEEDED",
  "FAILED",
  "AMBIGUOUS",
  "ADMIN_RESET",
] as const;

function* allContexts(): Generator<LockControlContext> {
  for (const lockControlEnabled of [true, false])
    for (const operationalHold of [
      null,
      { label: "Out of service", note: "x" },
    ])
      for (const externalDeviceId of [null, "ext-1"])
        for (const connectivity of ["ONLINE", "OFFLINE", "UNKNOWN", "ERROR"])
          for (const lastOutcome of OUTCOMES)
            yield {
              lockControlEnabled,
              operationalHold,
              externalDeviceId,
              connectivity,
              lastOutcome,
            };
}

describe("describeRemoteControlAvailability — same rule as command eligibility", () => {
  it("'Available' exactly when computeLockControlEligibility says eligible, for every combination", () => {
    let checked = 0;
    for (const ctx of allContexts()) {
      const code = describeRemoteControlAvailability(ctx);
      expect(code === "AVAILABLE").toBe(
        computeLockControlEligibility(ctx).eligible,
      );
      checked++;
    }
    expect(checked).toBe(160);
  });

  it("reports the first blocking reason in the eligibility order", () => {
    const base: LockControlContext = {
      lockControlEnabled: true,
      operationalHold: null,
      externalDeviceId: "ext-1",
      connectivity: "ONLINE",
      lastOutcome: "SUCCEEDED",
    };
    expect(describeRemoteControlAvailability(base)).toBe("AVAILABLE");
    expect(
      describeRemoteControlAvailability({ ...base, lockControlEnabled: false }),
    ).toBe("CONTROL_OFF");
    expect(
      describeRemoteControlAvailability({
        ...base,
        operationalHold: { label: "Out of service", note: "jammed" },
      }),
    ).toBe("ON_HOLD");
    expect(
      describeRemoteControlAvailability({ ...base, externalDeviceId: null }),
    ).toBe("NOT_MAPPED");
    expect(
      describeRemoteControlAvailability({ ...base, lastOutcome: "AMBIGUOUS" }),
    ).toBe("BLOCKED_AMBIGUOUS");
    expect(
      describeRemoteControlAvailability({ ...base, lastOutcome: "FAILED" }),
    ).toBe("BLOCKED_FAILED");
    expect(
      describeRemoteControlAvailability({ ...base, connectivity: "UNKNOWN" }),
    ).toBe("NOT_ONLINE");
    expect(
      describeRemoteControlAvailability({ ...base, lastOutcome: undefined }),
    ).toBe("NOT_VERIFIED");
    expect(REMOTE_CONTROL_AVAILABILITY_LABELS.NOT_VERIFIED).toBe(
      "Unavailable — not verified yet",
    );
  });
});
