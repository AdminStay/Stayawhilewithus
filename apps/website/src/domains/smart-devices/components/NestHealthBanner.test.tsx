// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatTimestamp } from "../lib/format-timestamp";

import { NestHealthBanner } from "./NestHealthBanner";

afterEach(cleanup);

const summary = {
  lastSucceededAt: "2026-09-10T19:58:00.000Z",
  lastAttemptAt: "2026-09-27T20:00:00.000Z",
  lastAttemptOk: false,
  newestReadingAt: "2026-09-10T19:58:00.000Z",
};

describe("NestHealthBanner (2026-09-27, Nest Phase 1)", () => {
  it("needs-reauthorization: an alert with the reason, last success, last attempt and newest reading", () => {
    render(
      <NestHealthBanner
        health={{
          ...summary,
          state: "needs_reauthorization",
          headline:
            "Nest connection needs attention: Google authorization has expired or been revoked.",
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Nest connection needs attention");
    expect(alert.textContent).toContain(
      `Last successful refresh: ${formatTimestamp(new Date(summary.lastSucceededAt))}`,
    );
    expect(alert.textContent).toContain(
      `Last attempted refresh: ${formatTimestamp(new Date(summary.lastAttemptAt))} (failed)`,
    );
    expect(alert.textContent).toContain(
      `Newest Nest reading: ${formatTimestamp(new Date(summary.newestReadingAt))}`,
    );
  });

  it("before any refresh is recorded it says so rather than implying a time", () => {
    render(
      <NestHealthBanner
        health={{
          state: "stale",
          headline: "Nest readings are stale.",
          lastSucceededAt: null,
          lastAttemptAt: null,
          lastAttemptOk: null,
          newestReadingAt: summary.newestReadingAt,
        }}
      />,
    );
    const text = screen.getByRole("alert").textContent!;
    expect(text).toContain("Last successful refresh: not recorded yet");
    expect(text).toContain("Last attempted refresh: not recorded yet");
  });

  it("healthy → a quiet status line, not an alert", () => {
    render(
      <NestHealthBanner
        health={{
          ...summary,
          state: "ok",
          headline: null,
          lastAttemptOk: true,
        }}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Nest readings are current.",
    );
  });

  it("renders nothing when there are no Nest thermostats", () => {
    const { container } = render(
      <NestHealthBanner
        health={{ ...summary, state: "no_devices", headline: null }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
