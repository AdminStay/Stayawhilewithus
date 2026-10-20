// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SyncMaxGuestsActionState } from "../actions";

const m = vi.hoisted(() => ({
  state: { status: "idle" } as unknown,
  pending: false,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: () => [m.state, vi.fn(), m.pending],
  };
});

import { SyncMaxGuestsButton } from "./SyncMaxGuestsButton";

afterEach(() => {
  cleanup();
  m.state = { status: "idle" };
  m.pending = false;
});

function renderWith(state: SyncMaxGuestsActionState, pending = false) {
  m.state = state;
  m.pending = pending;
  render(<SyncMaxGuestsButton action={vi.fn()} />);
}

// FABRICATED TEST FIXTURES — not real StayWhile properties.
const result = (
  n: number,
  outcome: "updated" | "unchanged" | "skipped_blank" | "failed",
  before: number,
  after: number,
  reason?: "rate_limited" | "request_failed",
) => ({
  propertyId: `p${n}`,
  propertyName: `FABRICATED Property ${n}`,
  outcome,
  before,
  after,
  ...(reason ? { reason } : {}),
});

describe("SyncMaxGuestsButton", () => {
  it("shows the sync button and no result before a run", () => {
    renderWith({ status: "idle" });
    expect(
      screen.getByRole("button", { name: /Sync max guests from OwnerRez/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is disabled while a sync is running", () => {
    renderWith({ status: "idle" }, true);
    const button = screen.getByRole("button", {
      name: /Syncing/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("lists every change, skip and failure so nothing changes silently", () => {
    renderWith({
      status: "success",
      rateLimited: false,
      results: [
        result(1, "updated", 12, 14),
        result(2, "unchanged", 8, 8),
        result(3, "skipped_blank", 10, 10),
        result(4, "failed", 6, 6, "request_failed"),
      ],
    });
    const summary = screen.getByRole("status").textContent ?? "";
    expect(summary).toContain(
      "1 updated, 1 unchanged, 1 skipped (blank in OwnerRez), 1 failed",
    );
    expect(summary).toContain("FABRICATED Property 1: 12 → 14");
    expect(summary).toContain(
      "FABRICATED Property 3: kept 10 (OwnerRez has no value)",
    );
    expect(summary).toContain(
      "FABRICATED Property 4: not changed — couldn't read OwnerRez",
    );
    // Unchanged properties are counted, not listed.
    expect(summary).not.toContain("FABRICATED Property 2");
  });

  it("says when OwnerRez's request limit stopped the run", () => {
    renderWith({
      status: "success",
      rateLimited: true,
      results: [result(1, "failed", 8, 8, "rate_limited")],
    });
    expect(screen.getByRole("status").textContent).toContain(
      "request limit was reached",
    );
  });

  it("shows not-configured and failure states", () => {
    renderWith({ status: "not_configured" });
    expect(screen.getByText(/OwnerRez isn.t configured/)).toBeTruthy();
    cleanup();
    renderWith({ status: "failure", error: "Forbidden" });
    expect(screen.getByText("Sync failed: Forbidden")).toBeTruthy();
  });
});
