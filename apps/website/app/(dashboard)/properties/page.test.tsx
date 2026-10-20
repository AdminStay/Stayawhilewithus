// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHasPermission, mockListProperties, mockSyncAction } = vi.hoisted(
  () => ({
    mockHasPermission: vi.fn(),
    mockListProperties: vi.fn(),
    mockSyncAction: vi.fn(),
  }),
);

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@stayw/auth", () => ({
  hasPermission: mockHasPermission,
}));

vi.mock("@/domains/properties/services/properties.service", () => ({
  listProperties: mockListProperties,
}));

vi.mock("@/domains/cleaners/services/cleaner-assignments.service", () => ({
  listCurrentCleanerSummaries: vi.fn().mockResolvedValue({}),
}));

// The page only passes these server actions through; the sync action's own
// RBAC lives in syncMaxGuestsFromOwnerRez() (assertPermission).
vi.mock("@/domains/properties/actions", () => ({
  syncMaxGuestsFromOwnerRezAction: mockSyncAction,
  createPropertyAction: vi.fn(),
  deletePropertyAction: vi.fn(),
  updatePropertyOccupancyAction: vi.fn(),
  updatePropertyStatusAction: vi.fn(),
}));

import PropertiesPage from "./page";

const SYNC_BUTTON = { name: /sync max guests from ownerrez/i };

async function renderPage() {
  render(await PropertiesPage({ searchParams: Promise.resolve({}) }));
}

afterEach(cleanup);

beforeEach(() => {
  mockListProperties.mockReset().mockResolvedValue([]);
  mockHasPermission.mockReset();
  mockSyncAction.mockReset();
});

describe("PropertiesPage — max-guests sync button authorization (2026-10-21)", () => {
  it("shows the sync button when the actor holds properties:update", async () => {
    mockHasPermission.mockImplementation(
      async (_actor, key) => key === "properties:update",
    );

    await renderPage();

    expect(mockHasPermission).toHaveBeenCalledWith(
      { userId: "user-1" },
      "properties:update",
    );
    expect(screen.getByRole("button", SYNC_BUTTON)).toBeTruthy();
  });

  it("hides the sync button without properties:update (e.g. read_only), and never runs the sync", async () => {
    // read_only holds properties:read (and cleaners:read is irrelevant here).
    mockHasPermission.mockImplementation(
      async (_actor, key) => key === "properties:read",
    );

    await renderPage();

    expect(screen.queryByRole("button", SYNC_BUTTON)).toBeNull();
    expect(mockSyncAction).not.toHaveBeenCalled();
    // The rest of the page still renders.
    expect(screen.getByRole("heading", { name: "Properties" })).toBeTruthy();
  });
});
