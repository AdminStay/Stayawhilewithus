import { assertPermission, hasPermission } from "@stayw/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanSyncMaxGuests,
  canSyncMaxGuests,
  MAX_GUESTS_SYNC_ADMIN_ONLY_ERROR,
} from "./max-guests-sync-access";

import { hasGlobalRole } from "@/platform/auth/is-global-admin";

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock("@/platform/auth/is-global-admin", () => ({ hasGlobalRole: vi.fn() }));

const actor = { userId: "user-1" };

/** Role → (holds properties:update, holds the global admin role), as seeded. */
const ROLES = {
  admin: { update: true, admin: true },
  ops_manager: { update: true, admin: false },
  read_only: { update: false, admin: false },
} as const;

function actAs(role: keyof typeof ROLES) {
  const r = ROLES[role];
  vi.mocked(hasPermission).mockImplementation(
    async (_actor, key) => r.update && key === "properties:update",
  );
  vi.mocked(assertPermission).mockImplementation(async (_actor, key) => {
    if (!(r.update && key === "properties:update")) {
      throw new Error("Forbidden");
    }
  });
  vi.mocked(hasGlobalRole).mockImplementation(
    async (_actor, names) => r.admin && names.includes("admin"),
  );
}

beforeEach(() => vi.resetAllMocks());

describe("max-guests sync access — admins only (2026-10-21)", () => {
  it("admin may sync", async () => {
    actAs("admin");
    expect(await canSyncMaxGuests(actor)).toBe(true);
    await expect(assertCanSyncMaxGuests(actor)).resolves.toBeUndefined();
    expect(hasGlobalRole).toHaveBeenCalledWith(actor, ["admin"]);
  });

  it("ops_manager may not, despite holding properties:update", async () => {
    actAs("ops_manager");
    expect(await canSyncMaxGuests(actor)).toBe(false);
    await expect(assertCanSyncMaxGuests(actor)).rejects.toThrow(
      MAX_GUESTS_SYNC_ADMIN_ONLY_ERROR,
    );
  });

  it("a role without properties:update may not, and the role lookup isn't reached", async () => {
    actAs("read_only");
    expect(await canSyncMaxGuests(actor)).toBe(false);
    await expect(assertCanSyncMaxGuests(actor)).rejects.toThrow("Forbidden");
    expect(hasGlobalRole).not.toHaveBeenCalled();
  });

  it("the admin role alone isn't enough without properties:update", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(assertPermission).mockRejectedValue(new Error("Forbidden"));
    vi.mocked(hasGlobalRole).mockResolvedValue(true);
    expect(await canSyncMaxGuests(actor)).toBe(false);
    await expect(assertCanSyncMaxGuests(actor)).rejects.toThrow("Forbidden");
  });
});
