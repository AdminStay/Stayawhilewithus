// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LockVerificationRow } from "../lib/lock-verification";

import { LockVerificationPanel } from "./LockVerificationPanel";

afterEach(cleanup);

const verified = {
  status: "VERIFIED" as const,
  verifiedAt: "2026-09-25T18:09:00.000Z",
};
const awaiting = { status: "AWAITING_OPS" as const, verifiedAt: null };
const healthy = { status: "HEALTHY" as const, reasons: [] };
const blocked = (outcome: string) => ({
  status: "COMMAND_BLOCKED" as const,
  reasons: [
    `Last remote command ${outcome} — needs an in-person check and an admin reset before any remote command`,
  ],
});

function row(
  propertyName: string,
  overrides: Partial<LockVerificationRow> = {},
): LockVerificationRow {
  return {
    smartDeviceId: `id-${propertyName}`,
    propertyName,
    lockName: "Front Door",
    verification: awaiting,
    condition: healthy,
    connectivity: "ONLINE",
    batteryLevel: 70,
    doorCondition: "Closed",
    ...overrides,
  };
}

// Shaped like the current fleet's known states (fixture names, not ids).
const ROWS: LockVerificationRow[] = [
  row("Aqua Palm", { verification: verified }),
  row("Driftwood", { verification: verified }),
  row("Royal Palms", {
    verification: verified,
    condition: { status: "NEEDS_ATTENTION", reasons: ["⚠ Calibration needed"] },
    doorCondition: "Calibration needed",
  }),
  row("Once Upon a Pond", { verification: verified }),
  row("Moroccan Moon", {
    verification: verified,
    condition: { status: "NEEDS_ATTENTION", reasons: ["Lock state unknown"] },
    connectivity: "UNKNOWN",
  }),
  row("Coco Vista", { condition: blocked("AMBIGUOUS") }),
  row("Orion's Landing", { condition: blocked("AMBIGUOUS") }),
  row("Majestic Isla", { condition: blocked("FAILED") }),
  row("Florisun", {
    verification: { status: "NOT_VERIFIED_ON_HOLD", verifiedAt: null },
    condition: {
      status: "ON_HOLD",
      reasons: ["Out of service: Lock replacement required"],
    },
  }),
  row("Lucky Charm", {
    verification: { status: "NOT_VERIFIED_ON_HOLD", verifiedAt: null },
    condition: {
      status: "ON_HOLD",
      reasons: ["Excluded from testing: Connect error"],
    },
  }),
  row("Mahalo"),
  row("Picasa"),
];

function renderPanel(rows = ROWS) {
  return render(
    <LockVerificationPanel
      rows={rows}
      generatedAt="2026-09-29T12:00:00.000Z"
    />,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

describe("LockVerificationPanel (2026-09-29)", () => {
  it("shows verification and current condition as two separate columns — a verified lock can be degraded", () => {
    renderPanel();
    const royal = within(rowOf("Royal Palms"));
    expect(royal.getByText("Verified")).toBeTruthy();
    expect(royal.getByText("Needs attention")).toBeTruthy();
    expect(royal.getByText("⚠ Calibration needed")).toBeTruthy();

    const moroccan = within(rowOf("Moroccan Moon"));
    expect(moroccan.getByText("Verified")).toBeTruthy();
    expect(moroccan.getByText("Needs attention")).toBeTruthy();

    const mahalo = within(rowOf("Mahalo"));
    expect(mahalo.getByText("Awaiting Ops verification")).toBeTruthy();
    expect(mahalo.getByText("Healthy")).toBeTruthy();
    expect(mahalo.getByText("Online")).toBeTruthy();
  });

  it("special states stay truthful: blocks and holds shown with their reasons", () => {
    renderPanel();
    for (const name of ["Coco Vista", "Orion's Landing"]) {
      const r = within(rowOf(name));
      expect(r.getByText("Command blocked")).toBeTruthy();
      expect(r.getByText(/Last remote command AMBIGUOUS/)).toBeTruthy();
      expect(r.getByText("Awaiting Ops verification")).toBeTruthy();
    }
    expect(
      within(rowOf("Majestic Isla")).getByText(/Last remote command FAILED/),
    ).toBeTruthy();
    const florisun = within(rowOf("Florisun"));
    expect(florisun.getByText("On hold")).toBeTruthy();
    expect(florisun.getByText("Not verified (on hold)")).toBeTruthy();
    expect(
      florisun.getByText("Out of service: Lock replacement required"),
    ).toBeTruthy();
    expect(
      within(rowOf("Lucky Charm")).getByText(
        "Excluded from testing: Connect error",
      ),
    ).toBeTruthy();
  });

  it("summary counts for both axes", () => {
    renderPanel();
    const counts = screen.getByLabelText("Verification and condition counts");
    expect(counts.textContent).toContain("Verified5");
    expect(counts.textContent).toContain("Awaiting Ops verification5");
    expect(counts.textContent).toContain("Not verified (on hold)2");
    expect(counts.textContent).toContain("Healthy5");
    expect(counts.textContent).toContain("Needs attention2");
    expect(counts.textContent).toContain("Command blocked3");
    expect(counts.textContent).toContain("On hold2");
  });

  it("filters by verification, by condition, and by 'Needs Ops follow-up'", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Filter by verification"), {
      target: { value: "VERIFIED" },
    });
    expect(screen.getByText("5 of 12 locks")).toBeTruthy();
    expect(screen.queryByText("Mahalo")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter by condition"), {
      target: { value: "NEEDS_ATTENTION" },
    });
    expect(screen.getByText("2 of 12 locks")).toBeTruthy();
    expect(screen.getByText("Royal Palms")).toBeTruthy();
    expect(screen.queryByText("Driftwood")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter by condition"), {
      target: { value: "ALL" },
    });
    fireEvent.change(screen.getByLabelText("Filter by verification"), {
      target: { value: "OPS_FOLLOW_UP" },
    });
    // 7 unverified + 2 verified-needing-attention.
    expect(screen.getByText("9 of 12 locks")).toBeTruthy();
    expect(screen.queryByText("Aqua Palm")).toBeNull();
    expect(screen.getByText("Royal Palms")).toBeTruthy();
  });

  it("copies the Ops checklist: unverified + verified-needing-attention only, no ids", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Ops verification checklist (9)",
      }),
    );
    await waitFor(() => expect(screen.getByText("Copied.")).toBeTruthy());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("Locks needing Ops verification or attention: 9");
    expect(text).toContain("Mahalo — Front Door");
    expect(text).toContain("Royal Palms — Front Door");
    expect(text).not.toContain("Aqua Palm");
    expect(text).not.toContain("Driftwood");
    expect(text).not.toContain("id-");
  });

  it("is read-only: the only button is the checklist copy", () => {
    renderPanel();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Copy Ops verification checklist (9)",
    ]);
  });
});
