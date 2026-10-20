// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHasPermission,
  mockCanSyncMaxGuests,
  mockListProperties,
  mockSyncAction,
} = vi.hoisted(() => ({
  mockHasPermission: vi.fn(),
  mockCanSyncMaxGuests: vi.fn(),
  mockListProperties: vi.fn(),
  mockSyncAction: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: mockHasPermission,
}));

// Server-only, so stubbed under jsdom. Which roles it allows (admin yes;
// ops_manager and read_only no) is proven in max-guests-sync-access.test.ts
// against the real rule; here, the page must show the button exactly when
// it says yes.
vi.mock("@/domains/properties/services/max-guests-sync-access", () => ({
  canSyncMaxGuests: mockCanSyncMaxGuests,
}));

vi.mock("@/domains/properties/services/properties.service", () => ({
  listProperties: mockListProperties,
}));

vi.mock("@/domains/cleaners/services/cleaner-assignments.service", () => ({
  listCurrentCleanerSummaries: vi.fn().mockResolvedValue({}),
}));

// The page only passes these server actions through; the sync's own
// server-side check is in syncMaxGuestsFromOwnerRez() (assertCanSyncMaxGuests).
vi.mock("@/domains/properties/actions", () => ({
  syncMaxGuestsFromOwnerRezAction: mockSyncAction,
  createPropertyAction: vi.fn(),
  deletePropertyAction: vi.fn(),
  updatePropertyOccupancyAction: vi.fn(),
  updatePropertyStatusAction: vi.fn(),
}));

import PropertiesPage from "./page";

const SYNC_BUTTON = { name: /sync max guests from ownerrez/i };

/**
 * As seeded: admin holds every permission; ops_manager holds
 * properties:update; read_only holds properties:read. canSyncMaxGuests is
 * true only for admin.
 */
const ROLES = {
  admin: { keys: null, canSync: true },
  ops_manager: {
    keys: ["properties:read", "properties:update"],
    canSync: false,
  },
  read_only: { keys: ["properties:read"], canSync: false },
} as const;

function actAs(role: keyof typeof ROLES) {
  const r = ROLES[role];
  mockHasPermission.mockImplementation(
    async (_actor, key: string) =>
      r.keys === null || (r.keys as readonly string[]).includes(key),
  );
  mockCanSyncMaxGuests.mockResolvedValue(r.canSync);
}

async function renderPage() {
  render(await PropertiesPage({ searchParams: Promise.resolve({}) }));
}

afterEach(cleanup);

beforeEach(() => {
  mockListProperties.mockReset().mockResolvedValue([]);
  mockHasPermission.mockReset();
  mockCanSyncMaxGuests.mockReset();
  mockSyncAction.mockReset();
});

describe("PropertiesPage — max-guests sync button is admin only (2026-10-21)", () => {
  it("shows the sync button to an admin", async () => {
    actAs("admin");

    await renderPage();

    expect(mockCanSyncMaxGuests).toHaveBeenCalledWith({ userId: "user-1" });
    expect(screen.getByRole("button", SYNC_BUTTON)).toBeTruthy();
  });

  it("hides the sync button from ops_manager, despite properties:update", async () => {
    actAs("ops_manager");

    await renderPage();

    expect(screen.queryByRole("button", SYNC_BUTTON)).toBeNull();
    expect(mockSyncAction).not.toHaveBeenCalled();
    // The rest of the page still renders.
    expect(screen.getByRole("heading", { name: "Properties" })).toBeTruthy();
  });

  it("hides the sync button without properties:update (read_only)", async () => {
    actAs("read_only");

    await renderPage();

    expect(screen.queryByRole("button", SYNC_BUTTON)).toBeNull();
    expect(mockSyncAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Properties" })).toBeTruthy();
  });
});
