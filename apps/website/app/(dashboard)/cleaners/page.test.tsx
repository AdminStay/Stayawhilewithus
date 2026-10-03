// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listCleaners: vi.fn(),
  listPropertyCleanerAssignments: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));
vi.mock("@/domains/cleaners/services/cleaners.service", () => ({
  listCleaners: m.listCleaners,
}));
vi.mock("@/domains/cleaners/services/cleaner-assignments.service", () => ({
  listPropertyCleanerAssignments: m.listPropertyCleanerAssignments,
}));
vi.mock("@/domains/cleaners/actions", () => ({
  addCleanerContactAction: vi.fn(),
  removeCleanerContactAction: vi.fn(),
  updateCleanerContactAction: vi.fn(),
  assignCleanerAction: vi.fn(),
  createCleanerAction: vi.fn(),
  endCleanerAssignmentAction: vi.fn(),
  setCleanerStatusAction: vi.fn(),
  updateCleanerAction: vi.fn(),
}));

import CleanersPage from "./page";

afterEach(cleanup);

const row = (
  name: string,
  primary: boolean,
  team: number,
  assignable = true,
) => ({
  property: {
    id: name,
    name,
    internalCode: name,
    status: assignable ? "ACTIVE" : "OFFBOARDED",
    deleted: false,
  },
  assignable,
  primary: primary
    ? {
        id: `${name}-p`,
        role: "PRIMARY",
        startedAt: new Date(),
        endedAt: null,
        cleaner: {
          id: "c1",
          name: "Alex",
          status: "ACTIVE",
          phoneDisplay: "•••• 0123",
        },
        assignedByName: null,
        endedByName: null,
      }
    : null,
  teamMembers: Array.from({ length: team }, (_, i) => ({
    id: `${name}-t${i}`,
    role: "TEAM_MEMBER",
    startedAt: new Date(),
    endedAt: null,
    cleaner: {
      id: `t${i}`,
      name: `Member ${i}`,
      status: "ACTIVE",
      phoneDisplay: "•••• 0000",
    },
    assignedByName: null,
    endedByName: null,
  })),
  history: [],
});

beforeEach(() => {
  m.listCleaners.mockReset();
  m.listPropertyCleanerAssignments.mockReset().mockResolvedValue([
    row("Harbor House", true, 0),
    row("Dune Cottage", false, 2),
    row("Bay Loft", false, 0),
    // Leftover cleaner on an offboarded property: listed, never counted.
    row("Old Villa", false, 1, false),
  ]);
});

describe("CleanersPage", () => {
  it("shows Add cleaner and the summary counts for a cleaners:manage holder", async () => {
    m.listCleaners.mockResolvedValue({
      canManage: true,
      cleaners: [
        {
          id: "c1",
          name: "Alex",
          status: "ACTIVE",
          notes: null,
          phone: "+13055550123",
          phoneDisplay: "(305) 555-0123",
          currentAssignments: [],
          backupContacts: [],
        },
      ],
    });

    render(await CleanersPage());

    expect(screen.getByRole("button", { name: /add cleaner/i })).toBeTruthy();
    expect(
      screen.getByText(
        "1 active cleaner · 1 property without a cleaner · 1 without a primary",
      ),
    ).toBeTruthy();
  });

  it("hides every write control for a read-only viewer", async () => {
    m.listCleaners.mockResolvedValue({ canManage: false, cleaners: [] });

    render(await CleanersPage());

    expect(screen.queryByRole("button", { name: /add cleaner/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /assign/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
