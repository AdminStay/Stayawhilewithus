// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCommandEvidence } from "../lib/lock-verification-evidence";
import { buildVerificationTrackerRow } from "../lib/lock-verification-tracker";

import { LockVerificationTracker } from "./LockVerificationTracker";

afterEach(cleanup);

const row = (
  propertyName: string,
  commands: Record<string, unknown>[],
  lastCommandOutcome: string | null = null,
) => {
  const evidence = buildCommandEvidence(
    commands.map((afterState, i) => ({
      afterState,
      metadata: null,
      occurredAt: new Date(Date.UTC(2026, 8, 25, 15, i)),
      actorName: "Kenny",
    })),
  );
  return buildVerificationTrackerRow({
    base: {
      smartDeviceId: `id-${propertyName}`,
      propertyName,
      lockName: "Front Door",
      verification: { status: "AWAITING_OPS", verifiedAt: null },
      condition: { status: "HEALTHY", reasons: [] },
      connectivity: "UNKNOWN",
      batteryLevel: 50,
      doorCondition: "Closed",
    },
    firstVerifiedAt: evidence.find((e) => e.result === "SUCCEEDED")?.at ?? null,
    operationalHold: null,
    lastCommandOutcome,
    mapped: true,
    lockState: "unknown",
    commands: evidence,
    ops: [],
    availability: lastCommandOutcome ? "BLOCKED_AMBIGUOUS" : "NOT_ONLINE",
  });
};

const ROWS = [
  row("Driftwood", [{ operation: "LOCK", result: "SUCCEEDED" }]),
  row("Coco Vista", [{ operation: "LOCK", result: "AMBIGUOUS" }], "AMBIGUOUS"),
  row("Untested", []),
];

function rowFor(name: string) {
  const tr = screen.getByText(name).closest("tr");
  if (!tr) throw new Error(name);
  return tr;
}

describe("LockVerificationTracker (2026-09-30)", () => {
  it("shows each direction honestly and Verified with only one direction passed", () => {
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
      />,
    );
    const drift = rowFor("Driftwood");
    expect(within(drift).getByText("StayWhile: Passed")).toBeTruthy();
    expect(within(drift).getByText("StayWhile: Not tested")).toBeTruthy();
    expect(within(drift).getByText("Verified")).toBeTruthy();
    const coco = rowFor("Coco Vista");
    expect(within(coco).getByText("StayWhile: Ambiguous")).toBeTruthy();
    expect(
      within(coco).getByText("Not verified — needs attention"),
    ).toBeTruthy();
    expect(
      within(coco).getByText(/Last remote command AMBIGUOUS/),
    ).toBeTruthy();
    expect(
      within(coco).getByText(
        "Remote control: Blocked — last command ambiguous",
      ),
    ).toBeTruthy();
    expect(
      within(rowFor("Untested")).getByText("No evidence yet"),
    ).toBeTruthy();
    expect(
      within(rowFor("Untested")).getByText("Connectivity unknown"),
    ).toBeTruthy();
    expect(within(rowFor("Untested")).getByText("State unknown")).toBeTruthy();
  });

  it("read-only viewers get no recording or command controls", () => {
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /record evidence/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^(lock|unlock|test)/i }),
    ).toBeNull();
  });

  it("admins get 'Record evidence' per lock; it's only a form (no command action is passed in)", () => {
    const recordAction = vi.fn();
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
        recordAction={recordAction}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: /record evidence/i }),
    ).toHaveLength(3);
    expect(recordAction).not.toHaveBeenCalled();
  });

  it("expands a lock's verification history, newest first, with who did it", () => {
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
      />,
    );
    fireEvent.click(
      within(rowFor("Coco Vista")).getByRole("button", { name: "History (1)" }),
    );
    const history = screen.getByRole("list", {
      name: "Verification history for Coco Vista — Front Door",
    });
    expect(within(history).getByText("Remote LOCK: Ambiguous")).toBeTruthy();
    expect(within(history).getByText("by Kenny")).toBeTruthy();
  });

  it("counts and filters by overall status", () => {
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
      />,
    );
    const counts = screen.getByLabelText("Verification counts");
    expect(within(counts).getByText("Verified").nextSibling?.textContent).toBe(
      "1",
    );
    fireEvent.change(screen.getByLabelText("Filter by verification"), {
      target: { value: "VERIFIED" },
    });
    expect(screen.getByText("1 of 3 locks")).toBeTruthy();
    expect(screen.queryByText("Coco Vista")).toBeNull();
  });

  it("copies the Ops checklist without ids", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <LockVerificationTracker
        rows={ROWS}
        generatedAt="2026-09-30T15:00:00Z"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Copy Ops verification checklist \(2\)/,
      }),
    );
    await screen.findByText("Copied.");
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("Coco Vista — Front Door");
    expect(text).toContain("Not verified — needs attention");
    expect(text).not.toContain("id-");
  });
});
