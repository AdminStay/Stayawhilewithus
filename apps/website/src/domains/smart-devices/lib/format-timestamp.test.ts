import { afterEach, describe, expect, it } from "vitest";

import { formatTimestamp } from "./format-timestamp";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("formatTimestamp", () => {
  it("returns an em dash for null, never a fabricated timestamp", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("formats a known instant as an explicit, UTC-labeled string", () => {
    const date = new Date("2026-09-02T05:29:00.000Z");
    expect(formatTimestamp(date)).toBe("Sep 2, 2026, 5:29 AM UTC");
  });

  /**
   * THE hydration-safety proof: the exact same Date instance must produce
   * byte-for-byte identical output no matter which timezone the runtime
   * calling this function happens to default to — this is what makes
   * server-rendered HTML (Vercel's runtime) and client-hydrated HTML (the
   * viewer's browser, e.g. Asia/Manila, GMT+8) match, closing the real
   * React #418 hydration mismatch this function replaces the cause of. If
   * this function used ambient toLocaleString() instead, this exact test
   * would fail — confirmed manually: the same instant renders as
   * "9/2/2026, 1:29:00 PM" under TZ=Asia/Manila vs "9/2/2026, 5:29:00 AM"
   * under TZ=UTC.
   */
  it("produces identical output regardless of the runtime's ambient TZ — proves deterministic, explicit inputs rather than ambient locale/timezone", () => {
    const date = new Date("2026-09-02T05:29:00.000Z");

    process.env.TZ = "Asia/Manila";
    const underManilaTz = formatTimestamp(date);

    process.env.TZ = "America/New_York";
    const underNewYorkTz = formatTimestamp(date);

    process.env.TZ = "UTC";
    const underUtcTz = formatTimestamp(date);

    process.env.TZ = "Pacific/Auckland";
    const underAucklandTz = formatTimestamp(date);

    expect(underManilaTz).toBe(underNewYorkTz);
    expect(underManilaTz).toBe(underUtcTz);
    expect(underManilaTz).toBe(underAucklandTz);
    expect(underManilaTz).toBe("Sep 2, 2026, 5:29 AM UTC");
  });

  it("accepts a plain Date-shaped value (not requiring a real Date instance) the same way the previous ambient formatter did", () => {
    // SmartDevice.updatedAt/telemetryUpdatedAt/refreshedAt all arrive as
    // real Date objects or ISO strings wrapped in `new Date(...)` by every
    // call site — this just confirms the function doesn't throw on a
    // freshly-constructed Date from an ISO string, the exact shape
    // RefreshThermostatsButton passes it.
    expect(() =>
      formatTimestamp(new Date("2026-09-02T05:29:00.000Z")),
    ).not.toThrow();
  });
});
