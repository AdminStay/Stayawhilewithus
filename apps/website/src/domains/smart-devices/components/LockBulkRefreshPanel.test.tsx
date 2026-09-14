// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LockBulkRefreshPanel } from "./LockBulkRefreshPanel";

afterEach(cleanup);

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i + 1}`,
    propertyName: `Property ${i + 1}`,
    name: `Lock ${i + 1}`,
    lastSyncedAt: new Date("2026-09-01T00:00:00.000Z"),
  }));
}

function idsSubmittedTo(action: ReturnType<typeof vi.fn>, callIndex = 0) {
  const formData = action.mock.calls[callIndex]?.[1] as FormData;
  return formData.getAll("smartDeviceId");
}

function allCheckboxes() {
  return screen.getAllByRole("checkbox") as HTMLInputElement[];
}

describe("LockBulkRefreshPanel — starts with zero locks selected", () => {
  it("renders every row's checkbox unchecked on first render — nothing is preselected", () => {
    const action = vi.fn();
    render(<LockBulkRefreshPanel rows={makeRows(3)} action={action} />);

    const boxes = allCheckboxes();
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box.checked).toBe(false);
  });

  it("shows the plain, unqualified 'Start bulk refresh' label (no count) and keeps it disabled with zero selected", () => {
    const action = vi.fn();
    render(<LockBulkRefreshPanel rows={makeRows(2)} action={action} />);

    const startButton = screen.getByRole("button", {
      name: "Start bulk refresh",
    });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking Start with nothing selected never invokes the action — the disabled attribute is the real guard, not just label text", () => {
    const action = vi.fn();
    render(<LockBulkRefreshPanel rows={makeRows(2)} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Start bulk refresh" }));

    expect(action).not.toHaveBeenCalled();
  });

  it("'Select all' requires an explicit operator click — selection stays empty until it is actually clicked", () => {
    const action = vi.fn();
    render(<LockBulkRefreshPanel rows={makeRows(3)} action={action} />);

    // Before any interaction: still zero selected.
    for (const box of allCheckboxes()) expect(box.checked).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Start bulk refresh",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    for (const box of allCheckboxes()) expect(box.checked).toBe(true);
    expect(
      screen.getByRole("button", { name: /Start bulk refresh \(3 devices/ }),
    ).toBeTruthy();
  });
});

describe("LockBulkRefreshPanel — manual per-row selection", () => {
  it("selecting two specific rows (never clicking Select all) submits only those two ids, in no more and no fewer", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "success",
      outcomes: [
        { smartDeviceId: "id-1", result: "success" },
        { smartDeviceId: "id-3", result: "success" },
      ],
    });
    const rows = makeRows(4);

    render(<LockBulkRefreshPanel rows={rows} action={action} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Property 1 —/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Property 3 —/ }));
    // Rows 2 and 4 are deliberately left unchecked.
    fireEvent.click(screen.getByRole("button", { name: /Start bulk refresh/ }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(idsSubmittedTo(action)).toEqual(["id-1", "id-3"]);
  });

  it("submits only the rows still checked — unchecking a row (e.g. one already refreshed manually) excludes it from the group", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "success",
      outcomes: [
        { smartDeviceId: "id-1", result: "success" },
        { smartDeviceId: "id-2", result: "success" },
      ],
    });
    const rows = makeRows(3);

    render(<LockBulkRefreshPanel rows={rows} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    // id-3 was already refreshed manually — exclude it from this run.
    fireEvent.click(screen.getByRole("checkbox", { name: /Property 3 —/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start bulk refresh/ }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(idsSubmittedTo(action)).toEqual(["id-1", "id-2"]);
  });
});

describe("LockBulkRefreshPanel — checklist shows Last synced for verification", () => {
  it("renders each row's property, lock name, and Last synced value from the page-supplied data, with no loading state (no extra query)", () => {
    const action = vi.fn();
    const rows = [
      {
        id: "id-1",
        propertyName: "Aloha by the Sea",
        name: "Aloha Backup - Front Door",
        lastSyncedAt: new Date("2026-09-10T12:00:00.000Z"),
      },
      {
        id: "id-2",
        propertyName: "Bahamas",
        name: "Bahamas - Front Door",
        lastSyncedAt: null,
      },
    ];

    render(<LockBulkRefreshPanel rows={rows} action={action} />);

    expect(
      screen.getByText(
        `Aloha by the Sea — Aloha Backup - Front Door — Last synced: ${new Date(
          "2026-09-10T12:00:00.000Z",
        ).toLocaleString()}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Bahamas — Bahamas - Front Door — Last synced: —"),
    ).toBeTruthy();
  });

  it("does not use Last synced to filter or preselect anything — a stale/never-synced row is still present and still unchecked by default", () => {
    const action = vi.fn();
    const rows = [
      {
        id: "id-1",
        propertyName: "Stale Property",
        name: "Stale Lock",
        lastSyncedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    ];

    render(<LockBulkRefreshPanel rows={rows} action={action} />);

    const box = screen.getByRole("checkbox", { name: /Stale Property/ });
    expect((box as HTMLInputElement).checked).toBe(false);
  });
});

describe("LockBulkRefreshPanel — sequential groups, capped at 5, operator-gated", () => {
  it("splits a 6-device selection into a 5 + 1 group pair, and does not submit the second group until the operator confirms after the first completes", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstCall = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const action = vi
      .fn()
      .mockReturnValueOnce(firstCall)
      .mockResolvedValueOnce({
        status: "success",
        outcomes: [{ smartDeviceId: "id-6", result: "success" }],
      });
    const rows = makeRows(6);

    render(<LockBulkRefreshPanel rows={rows} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Start bulk refresh/ }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(idsSubmittedTo(action, 0)).toEqual([
      "id-1",
      "id-2",
      "id-3",
      "id-4",
      "id-5",
    ]);
    expect(screen.getByText(/Group 1 of 2/)).toBeTruthy();
    expect(screen.getByText(/Refreshing…/)).toBeTruthy();

    // Group 2 must not fire while group 1 is still in flight, and there is
    // no "Refresh next group" control to even click yet.
    expect(
      screen.queryByRole("button", { name: /Refresh next group/ }),
    ).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);

    resolveFirst({
      status: "success",
      outcomes: [
        { smartDeviceId: "id-1", result: "success" },
        { smartDeviceId: "id-2", result: "success" },
        { smartDeviceId: "id-3", result: "success" },
        { smartDeviceId: "id-4", result: "success" },
        { smartDeviceId: "id-5", result: "success" },
      ],
    });

    const continueButton = await screen.findByRole("button", {
      name: /Refresh next group/,
    });
    // Still not auto-continued — the operator must click, proven twice: once
    // right after group 1 resolves (here) and once more explicitly below by
    // waiting an extra tick with no click and re-asserting the same count.
    expect(action).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(action).toHaveBeenCalledTimes(1);

    fireEvent.click(continueButton);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(idsSubmittedTo(action, 1)).toEqual(["id-6"]);
  });
});

describe("LockBulkRefreshPanel — failures are reported, never silently skipped", () => {
  it("renders a per-device provider_failure result inline within its group, alongside other devices' real success", async () => {
    const action = vi.fn().mockResolvedValue({
      status: "success",
      outcomes: [
        { smartDeviceId: "id-1", result: "success" },
        {
          smartDeviceId: "id-2",
          result: "provider_failure",
          error: "August API 401",
        },
      ],
    });

    render(<LockBulkRefreshPanel rows={makeRows(2)} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Start bulk refresh/ }));

    expect(
      await screen.findByText(/Provider error \(August API 401\)/),
    ).toBeTruthy();
    expect(screen.getByText(/Refreshed$/)).toBeTruthy();
  });

  it("renders a whole-group failure (e.g. a top-level 401/RBAC error before any per-device result) clearly, distinct from a per-device outcome", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ status: "failure", error: "ForbiddenError" });

    render(<LockBulkRefreshPanel rows={makeRows(1)} action={action} />);

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Start bulk refresh/ }));

    expect(await screen.findByText(/ForbiddenError/)).toBeTruthy();
    expect(screen.getByText(/Group 1 of 1.*Failed/)).toBeTruthy();
  });
});
