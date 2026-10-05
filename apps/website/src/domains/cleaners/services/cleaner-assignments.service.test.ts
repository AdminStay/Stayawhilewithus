import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    property: { findMany: vi.fn(), findUnique: vi.fn() },
    cleaner: { findUnique: vi.fn() },
    propertyCleanerAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // Present only so tests can prove assignment changes never touch
    // cleanings (Cleaner Phase 4, Option A).
    cleaningSchedule: {
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { mockPrisma };
});

vi.mock("@stayw/database", () => ({ prisma: mockPrisma }));
vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: vi.fn() }));

import { assertPermission, hasPermission } from "@stayw/auth";

import { CleanerRuleError } from "../lib/errors";

import {
  addTeamMember,
  endCleanerAssignment,
  findCurrentPrimaryCleanerId,
  listCurrentCleanerSummaries,
  listCurrentPropertyCleanerOptions,
  listPropertyCleanerAssignments,
  setPrimaryCleaner,
} from "./cleaner-assignments.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };
const PROPERTY = "22222222-2222-2222-2222-222222222222";
const ALEX = "33333333-3333-3333-3333-333333333333";
const SAM = "44444444-4444-4444-4444-444444444444";

const property = (overrides: Record<string, unknown> = {}) => ({
  id: PROPERTY,
  name: "Harbor House",
  status: "ONBOARDING",
  deletedAt: null,
  ...overrides,
});
const cleaner = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id === ALEX ? "Alex" : "Sam",
  phone: "+13055550123",
  status: "ACTIVE",
  notes: null,
  ...overrides,
});
const current = (
  id: string,
  cleanerId: string,
  role: "PRIMARY" | "TEAM_MEMBER",
) => ({
  id,
  propertyId: PROPERTY,
  cleanerId,
  role,
  endedAt: null,
  cleaner: { id: cleanerId, name: cleanerId === ALEX ? "Alex" : "Sam" },
});

function givenTargets(p: unknown = property(), c: unknown = cleaner(ALEX)) {
  mockPrisma.property.findUnique.mockResolvedValueOnce(p);
  mockPrisma.cleaner.findUnique.mockResolvedValueOnce(c);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
  );
  mockPrisma.propertyCleanerAssignment.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new-row",
      ...data,
    }),
  );
});

describe("permissions", () => {
  it.each([
    [
      "setPrimaryCleaner",
      () => setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ],
    [
      "addTeamMember",
      () => addTeamMember(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ],
    [
      "endCleanerAssignment",
      () => endCleanerAssignment(actor, { assignmentId: "a1" }),
    ],
  ])(
    "%s requires cleaners:manage and writes nothing without it",
    async (_n, call) => {
      vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(call()).rejects.toThrow();
      expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:manage");
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it("reads require cleaners:read", async () => {
    vi.mocked(assertPermission).mockRejectedValue(new Error("Forbidden"));
    await expect(listPropertyCleanerAssignments(actor)).rejects.toThrow();
    await expect(listCurrentCleanerSummaries(actor)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(mockPrisma.property.findMany).not.toHaveBeenCalled();
    expect(
      mockPrisma.propertyCleanerAssignment.findMany,
    ).not.toHaveBeenCalled();
  });
});

describe("setPrimaryCleaner", () => {
  it("first primary on a property: creates one PRIMARY row, ends nothing, audits", async () => {
    givenTargets();
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([]);

    await setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: ALEX });

    expect(mockPrisma.propertyCleanerAssignment.update).not.toHaveBeenCalled();
    expect(mockPrisma.propertyCleanerAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyId: PROPERTY,
        cleanerId: ALEX,
        role: "PRIMARY",
        assignedByUserId: actor.userId,
      }),
    });
    expect(vi.mocked(recordAudit).mock.calls[0]).toEqual([
      expect.objectContaining({
        action: "property_cleaner.primary_set",
        beforeState: { primaryCleanerId: null, primaryCleanerName: null },
        afterState: { primaryCleanerId: ALEX, primaryCleanerName: "Alex" },
      }),
      mockPrisma,
    ]);
  });

  it("changing the primary ENDS the old row (kept as history) and starts a new one", async () => {
    givenTargets(property(), cleaner(SAM));
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      current("old-primary", ALEX, "PRIMARY"),
    ]);

    await setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: SAM });

    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalledTimes(
      1,
    );
    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalledWith({
      where: { id: "old-primary" },
      data: { endedAt: expect.any(Date), endedByUserId: actor.userId },
    });
    expect(mockPrisma.propertyCleanerAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cleanerId: SAM, role: "PRIMARY" }),
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      beforeState: { primaryCleanerId: ALEX, primaryCleanerName: "Alex" },
      metadata: {
        endedAssignmentIds: ["old-primary"],
        promotedFromTeam: false,
      },
    });
  });

  it("changing the primary does NOT change any existing cleaning's cleanerId (Option A)", async () => {
    givenTargets(property(), cleaner(SAM));
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      current("old-primary", ALEX, "PRIMARY"),
    ]);

    await setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: SAM });

    // Existing jobs keep their stored cleaner: nothing reads, moves or
    // bulk-updates cleanings when the property's PRIMARY changes.
    for (const fn of Object.values(mockPrisma.cleaningSchedule)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("ending or adding an assignment does NOT touch cleanings either", async () => {
    givenTargets(property(), cleaner(SAM));
    mockPrisma.propertyCleanerAssignment.findFirst.mockResolvedValueOnce(null);
    await addTeamMember(actor, { propertyId: PROPERTY, cleanerId: SAM });

    mockPrisma.propertyCleanerAssignment.findUnique.mockResolvedValueOnce({
      ...current("old-primary", ALEX, "PRIMARY"),
      property: { id: PROPERTY, name: "Harbor House" },
    });
    await endCleanerAssignment(actor, { assignmentId: "old-primary" });

    for (const fn of Object.values(mockPrisma.cleaningSchedule)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("promoting a team member (a team with no primary yet) ends their team row and creates PRIMARY", async () => {
    givenTargets(property(), cleaner(SAM));
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      current("alex-team", ALEX, "TEAM_MEMBER"),
      current("sam-team", SAM, "TEAM_MEMBER"),
    ]);

    await setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: SAM });

    // Only Sam's team row ends; Alex stays on the team.
    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalledTimes(
      1,
    );
    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sam-team" } }),
    );
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      metadata: { promotedFromTeam: true, endedAssignmentIds: ["sam-team"] },
    });
  });

  it("refuses when the cleaner is already the primary", async () => {
    givenTargets();
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      current("p", ALEX, "PRIMARY"),
    ]);
    await expect(
      setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ).rejects.toThrow(/already the primary/);
    expect(mockPrisma.propertyCleanerAssignment.create).not.toHaveBeenCalled();
  });

  it.each([
    ["INACTIVE", property({ status: "INACTIVE" })],
    ["OFFBOARDED", property({ status: "OFFBOARDED" })],
    ["soft-deleted", property({ deletedAt: new Date() })],
    ["missing", null],
  ])("refuses a %s property", async (_label, p) => {
    givenTargets(p);
    await expect(
      setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ).rejects.toThrow(/Active or Onboarding/);
    expect(mockPrisma.propertyCleanerAssignment.create).not.toHaveBeenCalled();
  });

  it("refuses an inactive cleaner", async () => {
    givenTargets(property(), cleaner(ALEX, { status: "INACTIVE" }));
    await expect(
      setPrimaryCleaner(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ).rejects.toThrow(/inactive/);
    expect(mockPrisma.propertyCleanerAssignment.create).not.toHaveBeenCalled();
  });

  it("turns a database unique-index race (P2002) into a readable refresh message", async () => {
    givenTargets();
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([]);
    mockPrisma.propertyCleanerAssignment.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const err = await setPrimaryCleaner(actor, {
      propertyId: PROPERTY,
      cleanerId: ALEX,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CleanerRuleError);
    expect((err as Error).message).toMatch(/just changed by someone else/);
  });
});

describe("addTeamMember", () => {
  it("adds a TEAM_MEMBER row without touching the primary", async () => {
    givenTargets(property(), cleaner(SAM));
    mockPrisma.propertyCleanerAssignment.findFirst.mockResolvedValueOnce(null);

    await addTeamMember(actor, { propertyId: PROPERTY, cleanerId: SAM });

    expect(mockPrisma.propertyCleanerAssignment.update).not.toHaveBeenCalled();
    expect(mockPrisma.propertyCleanerAssignment.create).toHaveBeenCalledWith({
      data: {
        propertyId: PROPERTY,
        cleanerId: SAM,
        role: "TEAM_MEMBER",
        assignedByUserId: actor.userId,
      },
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "property_cleaner.team_member_added",
    });
  });

  it("refuses a cleaner already current on the property in any role", async () => {
    givenTargets();
    mockPrisma.propertyCleanerAssignment.findFirst.mockResolvedValueOnce(
      current("p", ALEX, "PRIMARY"),
    );
    await expect(
      addTeamMember(actor, { propertyId: PROPERTY, cleanerId: ALEX }),
    ).rejects.toThrow(/already assigned to Harbor House \(primary\)/);
    expect(mockPrisma.propertyCleanerAssignment.create).not.toHaveBeenCalled();
  });
});

describe("endCleanerAssignment", () => {
  it("ends a current assignment (kept as history) and audits it", async () => {
    mockPrisma.propertyCleanerAssignment.findUnique.mockResolvedValueOnce({
      ...current("a1", SAM, "TEAM_MEMBER"),
      property: { id: PROPERTY, name: "Harbor House" },
    });

    await endCleanerAssignment(actor, { assignmentId: "a1" });

    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { endedAt: expect.any(Date), endedByUserId: actor.userId },
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "property_cleaner.assignment_ended",
      beforeState: { cleanerName: "Sam", role: "TEAM_MEMBER" },
    });
  });

  it("refuses an already-ended assignment", async () => {
    mockPrisma.propertyCleanerAssignment.findUnique.mockResolvedValueOnce({
      ...current("a1", SAM, "TEAM_MEMBER"),
      endedAt: new Date(),
      property: { id: PROPERTY, name: "Harbor House" },
    });
    await expect(
      endCleanerAssignment(actor, { assignmentId: "a1" }),
    ).rejects.toThrow(/already ended/);
    expect(mockPrisma.propertyCleanerAssignment.update).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  const assignmentRow = (
    id: string,
    role: "PRIMARY" | "TEAM_MEMBER",
    cleanerId: string,
    startedAt: string,
    endedAt: string | null = null,
  ) => ({
    id,
    role,
    startedAt: new Date(startedAt),
    endedAt: endedAt ? new Date(endedAt) : null,
    cleaner: cleaner(cleanerId),
    assignedBy: {
      firstName: "Ops",
      lastName: "Admin",
      email: "ops@example.com",
    },
    endedBy: endedAt
      ? { firstName: null, lastName: null, email: "ops@example.com" }
      : null,
  });

  it("listPropertyCleanerAssignments: operational properties only; splits primary / team / history; masks phones for read-only", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    mockPrisma.property.findMany.mockResolvedValueOnce([
      {
        id: PROPERTY,
        name: "Harbor House",
        internalCode: "HH",
        status: "ONBOARDING",
        deletedAt: null,
        cleanerAssignments: [
          assignmentRow("t2", "TEAM_MEMBER", SAM, "2026-10-02"),
          assignmentRow("t1", "TEAM_MEMBER", ALEX, "2026-10-01"),
          assignmentRow("old", "PRIMARY", ALEX, "2026-09-01", "2026-09-30"),
        ],
      },
    ]);

    const [row] = await listPropertyCleanerAssignments(actor);

    expect(mockPrisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { deletedAt: null, status: { in: ["ACTIVE", "ONBOARDING"] } },
            { cleanerAssignments: { some: { endedAt: null } } },
          ],
        },
      }),
    );
    expect(row!.assignable).toBe(true);
    expect(row!.primary).toBeNull();
    expect(row!.teamMembers.map((t) => t.cleaner.name)).toEqual([
      "Alex",
      "Sam",
    ]);
    expect(row!.history.map((h) => h.id)).toEqual(["old"]);
    expect(row!.history[0]!.endedByName).toBe("ops@example.com");
    expect(row!.teamMembers[0]!.cleaner.phoneDisplay).toBe("•••• 0123");
    expect(JSON.stringify(row)).not.toContain("3055550123");
  });

  it("a non-operational property that still has cleaners is listed AFTER operational ones, marked not assignable", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    const prop = (name: string, status: string, deletedAt: Date | null) => ({
      id: name,
      name,
      internalCode: name,
      status,
      deletedAt,
      cleanerAssignments: [
        assignmentRow(`${name}-a`, "PRIMARY", ALEX, "2026-10-01"),
      ],
    });
    // Prisma returns them by name; the service puts assignable ones first.
    mockPrisma.property.findMany.mockResolvedValueOnce([
      prop("Alpha Lodge", "OFFBOARDED", null),
      prop("Beta House", "ACTIVE", null),
      prop("Gamma Cabin", "ACTIVE", new Date()),
      prop("Zeta Villa", "ONBOARDING", null),
    ]);

    const rows = await listPropertyCleanerAssignments(actor);

    expect(rows.map((r) => [r.property.name, r.assignable])).toEqual([
      ["Beta House", true],
      ["Zeta Villa", true],
      ["Alpha Lodge", false],
      ["Gamma Cabin", false],
    ]);
    expect(rows[3]!.property.deleted).toBe(true);
    // Its current cleaner is still there to be removed.
    expect(rows[2]!.primary?.id).toBe("Alpha Lodge-a");
  });

  it("endCleanerAssignment still works on an Offboarded property (the leftover-cleaner fix)", async () => {
    mockPrisma.propertyCleanerAssignment.findUnique.mockResolvedValueOnce({
      ...current("a1", ALEX, "PRIMARY"),
      property: { id: PROPERTY, name: "Old Villa" },
    });
    await endCleanerAssignment(actor, { assignmentId: "a1" });
    expect(mockPrisma.property.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.propertyCleanerAssignment.update).toHaveBeenCalled();
  });

  it("listCurrentCleanerSummaries: names only, grouped by property", async () => {
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      { propertyId: "p1", role: "PRIMARY", cleaner: { name: "Alex" } },
      { propertyId: "p1", role: "TEAM_MEMBER", cleaner: { name: "Sam" } },
      { propertyId: "p2", role: "TEAM_MEMBER", cleaner: { name: "Sam" } },
    ]);

    const summaries = await listCurrentCleanerSummaries(actor);

    expect(mockPrisma.propertyCleanerAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endedAt: null } }),
    );
    expect(summaries).toEqual({
      p1: { primary: "Alex", teamMembers: ["Sam"] },
      p2: { primary: null, teamMembers: ["Sam"] },
    });
  });
});

describe("Cleaner Phase 4 lookups", () => {
  it("findCurrentPrimaryCleanerId: current, ACTIVE PRIMARY only — via the caller's transaction client", async () => {
    const tx = {
      propertyCleanerAssignment: {
        findFirst: vi.fn().mockResolvedValueOnce({ cleanerId: ALEX }),
      },
    };

    const id = await findCurrentPrimaryCleanerId(tx as never, PROPERTY);

    expect(id).toBe(ALEX);
    expect(tx.propertyCleanerAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        propertyId: PROPERTY,
        endedAt: null,
        role: "PRIMARY",
        cleaner: { status: "ACTIVE" },
      },
      select: { cleanerId: true },
    });
    expect(
      mockPrisma.propertyCleanerAssignment.findFirst,
    ).not.toHaveBeenCalled();
  });

  it("findCurrentPrimaryCleanerId: null when there is no current PRIMARY (team-only or unassigned)", async () => {
    const tx = {
      propertyCleanerAssignment: {
        findFirst: vi.fn().mockResolvedValueOnce(null),
      },
    };
    expect(await findCurrentPrimaryCleanerId(tx as never, PROPERTY)).toBeNull();
  });

  it("listCurrentPropertyCleanerOptions: requires cleaners:read; ids + names only, grouped by property", async () => {
    mockPrisma.propertyCleanerAssignment.findMany.mockResolvedValueOnce([
      {
        propertyId: "p1",
        role: "PRIMARY",
        cleaner: { id: ALEX, name: "Alex" },
      },
      {
        propertyId: "p2",
        role: "TEAM_MEMBER",
        cleaner: { id: "k", name: "Kris" },
      },
      {
        propertyId: "p2",
        role: "TEAM_MEMBER",
        cleaner: { id: "l", name: "Lolis" },
      },
    ]);

    const options = await listCurrentPropertyCleanerOptions(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(mockPrisma.propertyCleanerAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endedAt: null },
        select: {
          propertyId: true,
          role: true,
          cleaner: { select: { id: true, name: true } },
        },
      }),
    );
    expect(options).toEqual({
      p1: { primary: { id: ALEX, name: "Alex" }, teamMembers: [] },
      p2: {
        primary: null,
        teamMembers: [
          { id: "k", name: "Kris" },
          { id: "l", name: "Lolis" },
        ],
      },
    });
  });
});
