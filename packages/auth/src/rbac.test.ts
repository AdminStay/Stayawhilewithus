import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    userRole: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@stayw/database";

import { ForbiddenError } from "./errors";
import {
  assertPermission,
  getEffectivePermissions,
  hasPermission,
} from "./rbac";

function mockUserRoles(
  roles: Array<{ propertyId: string | null; permissionKeys: string[] }>,
) {
  vi.mocked(prisma.userRole.findMany).mockResolvedValue(
    roles.map((r) => ({
      role: {
        rolePermissions: r.permissionKeys.map((key) => ({
          permission: { key },
        })),
      },
      propertyId: r.propertyId,
    })) as never,
  );
}

/**
 * A faithful fake of `prisma.userRole.findMany` that actually evaluates the
 * `where` clause getEffectivePermissions() constructs (userId, AND[{OR:
 * propertyId branches}, {OR: expiresAt branches}]) against an in-memory
 * fixture — unlike mockUserRoles() above, which returns whatever it's told
 * regardless of the query. That shortcut can't catch a real filtering
 * regression (e.g. the expiresAt fix, or property-scoping correctness);
 * this can, because it exercises the actual query-construction logic, not
 * just hasPermission()'s post-processing of an assumed-correct result.
 */
interface FixtureUserRole {
  userId: string;
  propertyId: string | null;
  expiresAt: Date | null;
  permissionKeys: string[];
}

function matchesOrBranch(
  role: FixtureUserRole,
  branch: Record<string, unknown>,
): boolean {
  const keys = Object.keys(branch);
  if (keys.length === 0) return true; // empty object == unconditional match, same as real Prisma
  return keys.every((key) => {
    if (key === "propertyId") {
      return role.propertyId === (branch.propertyId as string | null);
    }
    if (key === "expiresAt") {
      const cond = branch.expiresAt as null | { gt: Date };
      if (cond === null) return role.expiresAt === null;
      return (
        role.expiresAt !== null && role.expiresAt.getTime() > cond.gt.getTime()
      );
    }
    return false;
  });
}

function mockUserRolesFixture(fixture: FixtureUserRole[]) {
  // `as never` on the whole implementation, matching mockUserRoles() above
  // — Prisma's real findMany return type is branded (PrismaPromise, not a
  // plain Promise), which a hand-written async implementation can never
  // structurally satisfy. The fixture-matching logic itself is fully typed
  // above (matchesOrBranch, FixtureUserRole) — only this final assignment
  // needs the escape hatch.
  vi.mocked(prisma.userRole.findMany).mockImplementation(((args: {
    where: {
      userId: string;
      AND: Array<{ OR: Array<Record<string, unknown>> }>;
    };
  }) => {
    const matched = fixture.filter(
      (role) =>
        role.userId === args.where.userId &&
        args.where.AND.every((clause) =>
          clause.OR.some((branch) => matchesOrBranch(role, branch)),
        ),
    );
    return Promise.resolve(
      matched.map((role) => ({
        role: {
          rolePermissions: role.permissionKeys.map((key) => ({
            permission: { key },
          })),
        },
        propertyId: role.propertyId,
      })),
    );
  }) as never);
}

describe("hasPermission", () => {
  it("grants access via a global role", async () => {
    mockUserRoles([{ propertyId: null, permissionKeys: ["properties:read"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(true);
  });

  it("denies access when the permission is absent", async () => {
    mockUserRoles([{ propertyId: null, permissionKeys: ["properties:read"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:delete"),
    ).resolves.toBe(false);
  });

  it("grants access via a property-scoped role when propertyId matches", async () => {
    mockUserRoles([{ propertyId: "prop-1", permissionKeys: ["tasks:update"] }]);
    await expect(
      hasPermission({ userId: "u1" }, "tasks:update", { propertyId: "prop-1" }),
    ).resolves.toBe(true);
  });
});

describe("getEffectivePermissions — exact query shape sent to Prisma", () => {
  // Complements the behavioral suite below: this proves the literal `where`
  // structure, not just its observed effect through a fixture. Uses exact
  // `.toEqual` (not arrayContaining) specifically so a stray extra branch —
  // like the old `{}` leak — would fail this test even if some behavioral
  // case happened not to exercise it.
  it("without opts.propertyId: global branch present, property branch ABSENT (not an empty placeholder), expiry filter present", async () => {
    mockUserRoles([]);
    await getEffectivePermissions({ userId: "u1" });

    const call = vi.mocked(prisma.userRole.findMany).mock.calls[0]![0]!;
    expect(call.where).toEqual({
      userId: "u1",
      AND: [
        { OR: [{ propertyId: null }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      ],
    });
  });

  it("with opts.propertyId: global branch AND the specific property branch both present, expiry filter present", async () => {
    mockUserRoles([]);
    await getEffectivePermissions({ userId: "u1" }, { propertyId: "prop-1" });

    const call = vi.mocked(prisma.userRole.findMany).mock.calls[0]![0]!;
    expect(call.where).toEqual({
      userId: "u1",
      AND: [
        { OR: [{ propertyId: null }, { propertyId: "prop-1" }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      ],
    });
  });
});

describe("getEffectivePermissions — scope and expiry, evaluated against a real fixture (not a canned return value)", () => {
  const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const FAR_PAST = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  it("1. global role + expiresAt=null -> granted", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: null,
        expiresAt: null,
        permissionKeys: ["properties:read"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(true);
  });

  it("2. global role + future expiresAt -> granted", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: null,
        expiresAt: FAR_FUTURE,
        permissionKeys: ["properties:read"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(true);
  });

  it("3. global role + past expiresAt -> denied", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: null,
        expiresAt: FAR_PAST,
        permissionKeys: ["properties:read"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(false);
  });

  it("4. property-scoped role + matching property -> granted", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: null,
        permissionKeys: ["thermostats:manage"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage", {
        propertyId: "prop-1",
      }),
    ).resolves.toBe(true);
  });

  it("5. property-scoped role + different property -> denied", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: null,
        permissionKeys: ["thermostats:manage"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage", {
        propertyId: "prop-2",
      }),
    ).resolves.toBe(false);
  });

  it("6. property-scoped role + future expiry -> granted", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: FAR_FUTURE,
        permissionKeys: ["thermostats:manage"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage", {
        propertyId: "prop-1",
      }),
    ).resolves.toBe(true);
  });

  it("7. property-scoped role + past expiry -> denied, even when checked against its own property", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: FAR_PAST,
        permissionKeys: ["thermostats:manage"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage", {
        propertyId: "prop-1",
      }),
    ).resolves.toBe(false);
  });

  it("8. multiple roles -> union only of the still-valid, in-scope permissions", async () => {
    mockUserRolesFixture([
      // Valid global role.
      {
        userId: "u1",
        propertyId: null,
        expiresAt: null,
        permissionKeys: ["properties:read"],
      },
      // Valid role scoped to a DIFFERENT property than the one checked below
      // — must not contribute to the result.
      {
        userId: "u1",
        propertyId: "prop-2",
        expiresAt: null,
        permissionKeys: ["tasks:manage"],
      },
      // Valid role scoped to the property actually being checked.
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: null,
        permissionKeys: ["thermostats:manage"],
      },
      // Expired role — must not contribute to the result even though it's
      // otherwise in-scope for prop-1.
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: FAR_PAST,
        permissionKeys: ["smart_devices:update"],
      },
      // A different user's role must never leak into u1's result.
      {
        userId: "u2",
        propertyId: null,
        expiresAt: null,
        permissionKeys: ["users:manage"],
      },
    ]);

    const granted = await getEffectivePermissions(
      { userId: "u1" },
      { propertyId: "prop-1" },
    );

    expect(granted).toEqual(new Set(["properties:read", "thermostats:manage"]));
  });

  it("9. one expired role + one active role -> only the active role's permissions", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: null,
        expiresAt: FAR_PAST,
        permissionKeys: ["properties:delete"],
      },
      {
        userId: "u1",
        propertyId: null,
        expiresAt: null,
        permissionKeys: ["properties:read"],
      },
    ]);

    await expect(
      hasPermission({ userId: "u1" }, "properties:read"),
    ).resolves.toBe(true);
    await expect(
      hasPermission({ userId: "u1" }, "properties:delete"),
    ).resolves.toBe(false);
  });

  it("10. a no-property request does not accidentally include unrelated property-scoped roles", async () => {
    mockUserRolesFixture([
      {
        userId: "u1",
        propertyId: "prop-1",
        expiresAt: null,
        permissionKeys: ["thermostats:manage"],
      },
    ]);

    // Before the fix, `opts.propertyId ? {propertyId: opts.propertyId} :
    // {}` degraded to an unconditional-match empty object when propertyId
    // was omitted, so this incorrectly resolved to `true`. Fixed by
    // spreading the second OR branch in only when opts.propertyId is set,
    // instead of substituting `{}` — see rbac.ts.
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage"),
    ).resolves.toBe(false);
  });
});

describe("mockUserRolesFixture / matchesOrBranch — fidelity to real Prisma `where` semantics", () => {
  const baseRole: FixtureUserRole = {
    userId: "u1",
    propertyId: null,
    expiresAt: null,
    permissionKeys: [],
  };

  it("an empty object branch ({}) matches unconditionally — same as Prisma, where a WhereInput with zero keys imposes no constraint", () => {
    expect(matchesOrBranch({ ...baseRole, propertyId: "prop-9" }, {})).toBe(
      true,
    );
  });

  it("{ propertyId: null } matches only a row whose propertyId is actually null, not merely falsy", () => {
    expect(
      matchesOrBranch({ ...baseRole, propertyId: null }, { propertyId: null }),
    ).toBe(true);
    expect(
      matchesOrBranch(
        { ...baseRole, propertyId: "prop-1" },
        {
          propertyId: null,
        },
      ),
    ).toBe(false);
  });

  it("{ expiresAt: { gt: Date } } is a strict greater-than, matching SQL's `>` — equal-to-cutoff does not pass", () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    expect(
      matchesOrBranch(
        { ...baseRole, expiresAt: new Date(cutoff.getTime() + 1) },
        { expiresAt: { gt: cutoff } },
      ),
    ).toBe(true);
    expect(
      matchesOrBranch(
        { ...baseRole, expiresAt: cutoff },
        {
          expiresAt: { gt: cutoff },
        },
      ),
    ).toBe(false);
    expect(
      matchesOrBranch(
        { ...baseRole, expiresAt: new Date(cutoff.getTime() - 1) },
        { expiresAt: { gt: cutoff } },
      ),
    ).toBe(false);
  });

  it("the fixture matcher is actually being exercised, not silently bypassed: a mismatched property genuinely denies, proving the where clause is really being evaluated rather than always granting", async () => {
    mockUserRolesFixture([
      {
        ...baseRole,
        propertyId: "prop-1",
        permissionKeys: ["thermostats:manage"],
      },
    ]);
    await expect(
      hasPermission({ userId: "u1" }, "thermostats:manage", {
        propertyId: "prop-2",
      }),
    ).resolves.toBe(false);
  });
});

describe("assertPermission", () => {
  it("throws ForbiddenError when access is denied", async () => {
    mockUserRoles([]);
    await expect(
      assertPermission({ userId: "u1" }, "properties:delete"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("resolves silently when access is granted", async () => {
    mockUserRoles([
      { propertyId: null, permissionKeys: ["properties:delete"] },
    ]);
    await expect(
      assertPermission({ userId: "u1" }, "properties:delete"),
    ).resolves.toBeUndefined();
  });
});
