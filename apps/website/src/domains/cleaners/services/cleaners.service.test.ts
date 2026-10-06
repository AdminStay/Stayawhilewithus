import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    cleaner: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    propertyCleanerAssignment: { count: vi.fn() },
    cleaningSchedule: { count: vi.fn() },
    cleanerContact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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
  addCleanerContact,
  createCleaner,
  listActiveCleanerOptions,
  listCleaners,
  removeCleanerContact,
  setCleanerStatus,
  updateCleaner,
  updateCleanerContact,
} from "./cleaners.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };
const ID = "11111111-1111-1111-1111-111111111111";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: "Alex Rivera",
  phone: "+13055550123",
  status: "ACTIVE",
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
  );
});

describe("listCleaners — server-side phone masking", () => {
  it("requires cleaners:read and returns no data without it", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(listCleaners(actor)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(mockPrisma.cleaner.findMany).not.toHaveBeenCalled();
  });

  it("a viewer WITHOUT cleaners:manage gets a masked phone and never the full number", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([
      row({
        assignments: [
          {
            id: "a1",
            role: "PRIMARY",
            property: { id: "p1", name: "Harbor House" },
          },
        ],
      }),
    ]);

    const { cleaners, canManage } = await listCleaners(actor);

    expect(hasPermission).toHaveBeenCalledWith(actor, "cleaners:manage");
    expect(canManage).toBe(false);
    expect(cleaners[0]).toMatchObject({
      phone: null,
      phoneDisplay: "•••• 0123",
      currentAssignments: [
        { id: "a1", role: "PRIMARY", property: { name: "Harbor House" } },
      ],
    });
    expect(JSON.stringify(cleaners)).not.toContain("3055550123");
  });

  it("a cleaners:manage holder gets the full number (for editing) and a formatted display", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([row()]);

    const { cleaners } = await listCleaners(actor);

    expect(cleaners[0]).toMatchObject({
      phone: "+13055550123",
      phoneDisplay: "(305) 555-0123",
    });
  });

  it("loads only CURRENT assignments, active cleaners first", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([]);
    await listCleaners(actor);
    expect(mockPrisma.cleaner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ status: "asc" }, { name: "asc" }],
        include: expect.objectContaining({
          assignments: expect.objectContaining({ where: { endedAt: null } }),
        }),
      }),
    );
  });
});

describe("createCleaner / updateCleaner", () => {
  const input = { name: "Alex Rivera", phone: "+13055550123", notes: "" };

  it("requires cleaners:manage and writes nothing without it", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(createCleaner(actor, input)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:manage");
    expect(mockPrisma.cleaner.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("creates the cleaner and audits it in the same transaction with only the last 4 digits", async () => {
    mockPrisma.cleaner.create.mockResolvedValueOnce(row());

    await createCleaner(actor, input);

    expect(mockPrisma.cleaner.create).toHaveBeenCalledWith({
      data: { name: "Alex Rivera", phone: "+13055550123", notes: null },
    });
    const [audit, client] = vi.mocked(recordAudit).mock.calls[0]!;
    expect(client).toBe(mockPrisma);
    expect(audit).toMatchObject({
      action: "cleaner.created",
      entityType: "Cleaner",
      entityId: ID,
      afterState: { phoneLast4: "0123" },
    });
    expect(JSON.stringify(audit)).not.toContain("3055550123");
  });

  it("update audits before and after, both masked", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.cleaner.update.mockResolvedValueOnce(
      row({ phone: "+13055559876" }),
    );

    await updateCleaner(actor, { ...input, id: ID, phone: "+13055559876" });

    const [audit] = vi.mocked(recordAudit).mock.calls[0]!;
    expect(audit).toMatchObject({
      action: "cleaner.updated",
      beforeState: { phoneLast4: "0123" },
      afterState: { phoneLast4: "9876" },
    });
    expect(JSON.stringify(audit)).not.toMatch(/3055550123|3055559876/);
  });

  it("update of a missing cleaner is a readable refusal", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(null);
    await expect(
      updateCleaner(actor, { ...input, id: ID }),
    ).rejects.toBeInstanceOf(CleanerRuleError);
    expect(mockPrisma.cleaner.update).not.toHaveBeenCalled();
  });
});

describe("setCleanerStatus — deactivate, never delete", () => {
  it("refuses to deactivate a cleaner who still has current assignments", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.propertyCleanerAssignment.count.mockResolvedValueOnce(2);

    await expect(
      setCleanerStatus(actor, { id: ID, status: "INACTIVE" }),
    ).rejects.toThrow(/still assigned to 2 properties/);
    expect(mockPrisma.propertyCleanerAssignment.count).toHaveBeenCalledWith({
      where: { cleanerId: ID, endedAt: null },
    });
    expect(mockPrisma.cleaner.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses to deactivate a cleaner who is still the stored cleaner on open cleanings (2026-10-07)", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.propertyCleanerAssignment.count.mockResolvedValueOnce(0);
    mockPrisma.cleaningSchedule.count.mockResolvedValueOnce(3);

    await expect(
      setCleanerStatus(actor, { id: ID, status: "INACTIVE" }),
    ).rejects.toThrow(/still the cleaner on 3 open cleanings/);
    // Open = SCHEDULED / IN_PROGRESS; completed, cancelled and missed jobs
    // don't block deactivation.
    expect(mockPrisma.cleaningSchedule.count).toHaveBeenCalledWith({
      where: { cleanerId: ID, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    });
    expect(mockPrisma.cleaner.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("names a single open cleaning in the singular", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.propertyCleanerAssignment.count.mockResolvedValueOnce(0);
    mockPrisma.cleaningSchedule.count.mockResolvedValueOnce(1);

    await expect(
      setCleanerStatus(actor, { id: ID, status: "INACTIVE" }),
    ).rejects.toThrow(
      /still the cleaner on 1 open cleaning\. Reassign or clear it/,
    );
  });

  it("deactivates a cleaner with no assignments and no open cleanings, and audits cleaner.deactivated", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.propertyCleanerAssignment.count.mockResolvedValueOnce(0);
    mockPrisma.cleaningSchedule.count.mockResolvedValueOnce(0);
    mockPrisma.cleaner.update.mockResolvedValueOnce(
      row({ status: "INACTIVE" }),
    );

    await setCleanerStatus(actor, { id: ID, status: "INACTIVE" });

    expect(mockPrisma.cleaner.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { status: "INACTIVE" },
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "cleaner.deactivated",
    });
  });

  it("reactivates without checking assignments", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(
      row({ status: "INACTIVE" }),
    );
    mockPrisma.cleaner.update.mockResolvedValueOnce(row());

    await setCleanerStatus(actor, { id: ID, status: "ACTIVE" });

    expect(mockPrisma.propertyCleanerAssignment.count).not.toHaveBeenCalled();
    expect(mockPrisma.cleaningSchedule.count).not.toHaveBeenCalled();
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "cleaner.reactivated",
    });
  });

  it("refuses a no-op status change", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    await expect(
      setCleanerStatus(actor, { id: ID, status: "ACTIVE" }),
    ).rejects.toThrow(/already active/);
  });
});

describe("backup contacts", () => {
  const CONTACT = "55555555-5555-5555-5555-555555555555";
  const contactRow = (overrides: Record<string, unknown> = {}) => ({
    id: CONTACT,
    cleanerId: ID,
    phone: "+19415550199",
    name: "Jordan",
    relationship: "Sister",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  const input = {
    cleanerId: ID,
    phone: "+19415550199",
    name: "Jordan",
    relationship: "Sister",
    notes: "",
  };

  it("listCleaners masks backup numbers exactly like the primary for a read-only viewer", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([
      row({
        backupContacts: [
          contactRow(),
          contactRow({
            id: "b2",
            name: null,
            relationship: null,
            phone: "+14485550100",
          }),
        ],
      }),
    ]);

    const { cleaners } = await listCleaners(actor);

    expect(cleaners[0]!.backupContacts).toEqual([
      expect.objectContaining({
        name: "Jordan",
        relationship: "Sister",
        phone: null,
        phoneDisplay: "•••• 0199",
      }),
      expect.objectContaining({
        name: null,
        relationship: null,
        phone: null,
        phoneDisplay: "•••• 0100",
      }),
    ]);
    expect(JSON.stringify(cleaners)).not.toMatch(/9415550199|4485550100/);
    expect(mockPrisma.cleaner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          backupContacts: { orderBy: { createdAt: "asc" } },
        }),
      }),
    );
  });

  it("listCleaners gives a manager the full backup number", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([
      row({ backupContacts: [contactRow()] }),
    ]);
    const { cleaners } = await listCleaners(actor);
    expect(cleaners[0]!.backupContacts[0]).toMatchObject({
      phone: "+19415550199",
      phoneDisplay: "(941) 555-0199",
    });
  });

  it("add requires cleaners:manage and writes nothing without it", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(addCleanerContact(actor, input)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:manage");
    expect(mockPrisma.cleanerContact.create).not.toHaveBeenCalled();
  });

  it("add creates the contact (blank name/relationship stored as null) and audits last 4 only", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.cleanerContact.create.mockResolvedValueOnce(
      contactRow({ name: null, relationship: null }),
    );

    await addCleanerContact(actor, { ...input, name: "", relationship: "" });

    expect(mockPrisma.cleanerContact.create).toHaveBeenCalledWith({
      data: {
        cleanerId: ID,
        phone: "+19415550199",
        name: null,
        relationship: null,
        notes: null,
      },
    });
    const [audit, client] = vi.mocked(recordAudit).mock.calls[0]!;
    expect(client).toBe(mockPrisma);
    expect(audit).toMatchObject({
      action: "cleaner.contact_added",
      entityType: "CleanerContact",
      afterState: { phoneLast4: "0199" },
    });
    expect(JSON.stringify(audit)).not.toContain("9415550199");
  });

  it("add refuses the cleaner's own primary number", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    await expect(
      addCleanerContact(actor, { ...input, phone: "+13055550123" }),
    ).rejects.toThrow(/already Alex Rivera's primary phone/);
    expect(mockPrisma.cleanerContact.create).not.toHaveBeenCalled();
  });

  it("add turns a duplicate backup number (DB unique, P2002) into a readable message", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.cleanerContact.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const err = await addCleanerContact(actor, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CleanerRuleError);
    expect((err as Error).message).toMatch(/already listed as a backup/);
  });

  it("update audits before/after (masked) and refuses the primary number", async () => {
    mockPrisma.cleanerContact.findUnique.mockResolvedValueOnce({
      ...contactRow(),
      cleaner: row(),
    });
    mockPrisma.cleanerContact.update.mockResolvedValueOnce(
      contactRow({ phone: "+19415550142" }),
    );
    await updateCleanerContact(actor, {
      ...input,
      id: CONTACT,
      phone: "+19415550142",
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "cleaner.contact_updated",
      beforeState: { phoneLast4: "0199" },
      afterState: { phoneLast4: "0142" },
    });

    mockPrisma.cleanerContact.findUnique.mockResolvedValueOnce({
      ...contactRow(),
      cleaner: row(),
    });
    await expect(
      updateCleanerContact(actor, {
        ...input,
        id: CONTACT,
        phone: "+13055550123",
      }),
    ).rejects.toThrow(/primary phone/);
  });

  it("remove deletes the contact and audits it; an already-removed one is a readable refusal", async () => {
    mockPrisma.cleanerContact.findUnique.mockResolvedValueOnce({
      ...contactRow(),
      cleaner: { id: ID, name: "Alex Rivera" },
    });
    await removeCleanerContact(actor, { id: CONTACT });
    expect(mockPrisma.cleanerContact.delete).toHaveBeenCalledWith({
      where: { id: CONTACT },
    });
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toMatchObject({
      action: "cleaner.contact_removed",
      beforeState: { phoneLast4: "0199", name: "Jordan" },
    });

    mockPrisma.cleanerContact.findUnique.mockResolvedValueOnce(null);
    await expect(removeCleanerContact(actor, { id: CONTACT })).rejects.toThrow(
      /already removed/,
    );
  });

  it("updateCleaner refuses a primary number that is already one of the cleaner's backups", async () => {
    mockPrisma.cleaner.findUnique.mockResolvedValueOnce(row());
    mockPrisma.cleanerContact.count.mockResolvedValueOnce(1);
    await expect(
      updateCleaner(actor, {
        id: ID,
        name: "Alex Rivera",
        phone: "+19415550199",
        notes: "",
      }),
    ).rejects.toThrow(/already one of this cleaner's backup contacts/);
    expect(mockPrisma.cleaner.update).not.toHaveBeenCalled();
  });
});

describe("listActiveCleanerOptions (Cleaner Phase 4 picker)", () => {
  it("requires cleaners:read and returns ACTIVE cleaners as id + name only — no phone selected", async () => {
    mockPrisma.cleaner.findMany.mockResolvedValueOnce([
      { id: "c1", name: "Alex" },
    ]);

    const options = await listActiveCleanerOptions(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(mockPrisma.cleaner.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    expect(options).toEqual([{ id: "c1", name: "Alex" }]);
  });
});
