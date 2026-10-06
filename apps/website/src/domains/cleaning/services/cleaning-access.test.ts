import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
  getPermissionScope: vi.fn(),
  hasAnyScope: (scope: { global: boolean; propertyIds: string[] }) =>
    scope.global || scope.propertyIds.length > 0,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/platform/auth/is-global-admin", () => ({ hasGlobalRole: vi.fn() }));

import {
  assertPermission,
  ForbiddenError,
  getPermissionScope,
  hasPermission,
} from "@stayw/auth";

import {
  assertCleaningPropertyPermission,
  canChangeCleaningCleaner,
  CLEANER_CHANGE_ROLE_NAMES,
  cleaningScopeWhere,
  hasCleaningPermissionAnywhere,
} from "./cleaning-access";

import { hasGlobalRole } from "@/platform/auth/is-global-admin";

const actor = { userId: "u1" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CLEANER_CHANGE_ROLE_NAMES (Admin + Staff decision, 2026-10-07)", () => {
  it("is admin only today — the Staff role is deferred and not invented", () => {
    expect(CLEANER_CHANGE_ROLE_NAMES).toEqual(["admin"]);
  });
});

describe("canChangeCleaningCleaner", () => {
  it("needs cleaning_schedules:update AND a global role from the list", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(hasGlobalRole).mockResolvedValue(true);

    expect(await canChangeCleaningCleaner(actor)).toBe(true);
    expect(hasPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(hasGlobalRole).toHaveBeenCalledWith(actor, ["admin"]);
  });

  it("ops_manager / cleaner: hold the permission, not the role → false", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(hasGlobalRole).mockResolvedValue(false);

    expect(await canChangeCleaningCleaner(actor)).toBe(false);
  });

  it("without the permission → false (role not even checked)", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    expect(await canChangeCleaningCleaner(actor)).toBe(false);
    expect(hasGlobalRole).not.toHaveBeenCalled();
  });
});

describe("cleaningScopeWhere", () => {
  it("global grant → no filter", async () => {
    vi.mocked(getPermissionScope).mockResolvedValue({
      global: true,
      propertyIds: [],
    });
    expect(await cleaningScopeWhere(actor, "cleaning_schedules:read")).toEqual(
      {},
    );
  });

  it("property-scoped grant → only those properties", async () => {
    vi.mocked(getPermissionScope).mockResolvedValue({
      global: false,
      propertyIds: ["p1", "p2"],
    });
    expect(await cleaningScopeWhere(actor, "cleaning_schedules:read")).toEqual({
      propertyId: { in: ["p1", "p2"] },
    });
  });

  it("no grant anywhere → ForbiddenError (callers never query)", async () => {
    vi.mocked(getPermissionScope).mockResolvedValue({
      global: false,
      propertyIds: [],
    });
    await expect(
      cleaningScopeWhere(actor, "cleaning_schedules:read"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("hasCleaningPermissionAnywhere / assertCleaningPropertyPermission", () => {
  it("true for a global or any property-scoped grant, false for none", async () => {
    vi.mocked(getPermissionScope)
      .mockResolvedValueOnce({ global: false, propertyIds: ["p1"] })
      .mockResolvedValueOnce({ global: false, propertyIds: [] });

    expect(
      await hasCleaningPermissionAnywhere(actor, "cleaning_schedules:update"),
    ).toBe(true);
    expect(
      await hasCleaningPermissionAnywhere(actor, "cleaning_schedules:update"),
    ).toBe(false);
  });

  it("checks the permission for the given property (global grants also match)", async () => {
    await assertCleaningPropertyPermission(
      actor,
      "cleaning_schedules:update",
      "p1",
    );
    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
      { propertyId: "p1" },
    );
  });
});
