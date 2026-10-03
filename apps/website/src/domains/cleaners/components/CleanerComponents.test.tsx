// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentView,
  PropertyCleanerRow,
} from "../services/cleaner-assignments.service";
import type { CleanerView } from "../services/cleaners.service";

import { backupContactLabel, CleanerList } from "./CleanerList";
import { PropertyCleanerAssignments } from "./PropertyCleanerAssignments";
import { PropertyCleanerSummary } from "./PropertyCleanerSummary";

afterEach(cleanup);

const action = vi.fn();

const cleanerView = (overrides: Partial<CleanerView> = {}): CleanerView => ({
  id: "c1",
  name: "Alex Rivera",
  status: "ACTIVE",
  notes: null,
  phone: null,
  phoneDisplay: "•••• 0123",
  currentAssignments: [],
  backupContacts: [],
  ...overrides,
});

const contactActions = { add: action, update: action, remove: action };

const assignment = (
  id: string,
  name: string,
  role: "PRIMARY" | "TEAM_MEMBER",
): AssignmentView => ({
  id,
  role,
  startedAt: new Date("2026-10-01T12:00:00Z"),
  endedAt: null,
  cleaner: { id: `${id}-c`, name, status: "ACTIVE", phoneDisplay: "•••• 0123" },
  assignedByName: "Ops",
  endedByName: null,
});

const propertyRow = (
  overrides: Partial<PropertyCleanerRow> = {},
): PropertyCleanerRow => ({
  property: {
    id: "p1",
    name: "Harbor House",
    internalCode: "HH",
    status: "ACTIVE",
    deleted: false,
  },
  assignable: true,
  primary: null,
  teamMembers: [],
  history: [],
  ...overrides,
});

describe("CleanerList", () => {
  it("read-only: shows the masked phone and no Edit/Deactivate controls", () => {
    render(
      <CleanerList
        cleaners={[cleanerView()]}
        canManage={false}
        updateAction={action}
        setStatusAction={action}
        contactActions={contactActions}
      />,
    );
    expect(screen.getByText("•••• 0123")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
  });

  it("manage: Active cleaners get Deactivate, inactive ones get Reactivate", () => {
    render(
      <CleanerList
        cleaners={[
          cleanerView(),
          cleanerView({ id: "c2", name: "Sam Lee", status: "INACTIVE" }),
        ]}
        canManage
        updateAction={action}
        setStatusAction={action}
        contactActions={contactActions}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
  });

  it("lists current properties, marking team-member ones", () => {
    render(
      <CleanerList
        cleaners={[
          cleanerView({
            currentAssignments: [
              {
                id: "a1",
                role: "PRIMARY",
                property: { id: "p1", name: "Harbor House" },
              },
              {
                id: "a2",
                role: "TEAM_MEMBER",
                property: { id: "p2", name: "Dune Cottage" },
              },
            ],
          }),
        ]}
        canManage={false}
        updateAction={action}
        setStatusAction={action}
        contactActions={contactActions}
      />,
    );
    expect(screen.getByText("Harbor House, Dune Cottage (team)")).toBeTruthy();
  });
});

describe("PropertyCleanerAssignments", () => {
  it("a team with no primary shows 'Primary not set' and lists the team — never picks one", () => {
    render(
      <PropertyCleanerAssignments
        rows={[
          propertyRow({
            teamMembers: [
              assignment("t1", "Alex Rivera", "TEAM_MEMBER"),
              assignment("t2", "Sam Lee", "TEAM_MEMBER"),
            ],
          }),
        ]}
        activeCleaners={[]}
        canManage
        assignAction={action}
        endAction={action}
      />,
    );
    expect(screen.getByText("Primary not set")).toBeTruthy();
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    // Each team member can be made primary or removed.
    expect(
      screen.getAllByRole("button", { name: "Make primary" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("no cleaner at all shows 'No cleaner'", () => {
    render(
      <PropertyCleanerAssignments
        rows={[propertyRow()]}
        activeCleaners={[]}
        canManage={false}
        assignAction={action}
        endAction={action}
      />,
    );
    expect(screen.getByText("No cleaner")).toBeTruthy();
  });

  it("the assign picker excludes cleaners already on that property", () => {
    render(
      <PropertyCleanerAssignments
        rows={[
          propertyRow({ primary: assignment("p", "Alex Rivera", "PRIMARY") }),
        ]}
        activeCleaners={[
          { id: "p-c", name: "Alex Rivera" },
          { id: "c9", name: "Sam Lee" },
        ]}
        canManage
        assignAction={action}
        endAction={action}
      />,
    );
    const picker = screen.getByRole("combobox", {
      name: "Cleaner for Harbor House",
    });
    const options = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Choose cleaner…", "Sam Lee"]);
    // With a primary already set, the default role is Team member.
    expect(
      (
        screen.getByRole("combobox", {
          name: "Role at Harbor House",
        }) as HTMLSelectElement
      ).value,
    ).toBe("TEAM_MEMBER");
    // The primary has no "Make primary" button.
    expect(screen.queryByRole("button", { name: "Make primary" })).toBeNull();
  });

  it("read-only: no Assign column, no Make primary / Remove", () => {
    render(
      <PropertyCleanerAssignments
        rows={[
          propertyRow({ primary: assignment("p", "Alex Rivera", "PRIMARY") }),
        ]}
        activeCleaners={[{ id: "c9", name: "Sam Lee" }]}
        canManage={false}
        assignAction={action}
        endAction={action}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Assign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows ended assignments as history", () => {
    render(
      <PropertyCleanerAssignments
        rows={[
          propertyRow({
            history: [
              {
                ...assignment("h1", "Old Cleaner", "PRIMARY"),
                startedAt: new Date("2026-09-01T12:00:00Z"),
                endedAt: new Date("2026-09-30T12:00:00Z"),
                endedByName: "Ops",
              },
            ],
          }),
        ]}
        activeCleaners={[]}
        canManage={false}
        assignAction={action}
        endAction={action}
      />,
    );
    expect(screen.getByText("History (1)")).toBeTruthy();
    expect(
      screen.getByText(
        "Old Cleaner — primary, Sep 1, 2026 → Sep 30, 2026 (ended by Ops)",
      ),
    ).toBeTruthy();
  });
});

describe("PropertyCleanerSummary", () => {
  it.each([
    [undefined, "No cleaner"],
    [{ primary: null, teamMembers: [] }, "No cleaner"],
    [{ primary: "Alex", teamMembers: [] }, "Alex"],
    [{ primary: "Alex", teamMembers: ["Sam"] }, "Alex + Sam"],
    [
      { primary: null, teamMembers: ["Alex", "Sam"] },
      "Team: Alex, Sam (primary not set)",
    ],
  ])("%j → %s", (summary, text) => {
    const { container } = render(<PropertyCleanerSummary summary={summary} />);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(text);
  });
});

describe("CleanerList — backup contacts", () => {
  const backup = (overrides: Record<string, unknown> = {}) => ({
    id: "b1",
    name: null,
    relationship: null,
    notes: null,
    phone: null,
    phoneDisplay: "•••• 0177",
    ...overrides,
  });

  it.each([
    [{}, "Backup"],
    [{ name: "Jordan" }, "Jordan"],
    [{ relationship: "Sister" }, "(Sister)"],
    [{ name: "Jordan", relationship: "Sister" }, "Jordan (Sister)"],
  ])("labels %j as %s", (overrides, label) => {
    expect(backupContactLabel(backup(overrides) as never)).toBe(label);
  });

  it("read-only: lists every backup (masked) with no Add/Edit/Remove backup controls", () => {
    render(
      <CleanerList
        cleaners={[
          cleanerView({
            backupContacts: [
              backup(),
              backup({
                id: "b2",
                name: "Jordan",
                relationship: "Sister",
                phoneDisplay: "•••• 0188",
              }),
            ],
          }),
        ]}
        canManage={false}
        updateAction={action}
        setStatusAction={action}
        contactActions={contactActions}
      />,
    );
    expect(screen.getByText("Backup · •••• 0177")).toBeTruthy();
    expect(
      screen.getByText("Backup: Jordan (Sister) · •••• 0188"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /backup/i })).toBeNull();
  });

  it("manage: Add backup per cleaner, Edit/Remove backup per contact", () => {
    render(
      <CleanerList
        cleaners={[
          cleanerView({
            backupContacts: [
              backup({ phone: "+13055550177", phoneDisplay: "(305) 555-0177" }),
            ],
          }),
        ]}
        canManage
        updateAction={action}
        setStatusAction={action}
        contactActions={contactActions}
      />,
    );
    expect(screen.getByRole("button", { name: "Add backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit backup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove backup" })).toBeTruthy();
    expect(screen.getByText("Backup · (305) 555-0177")).toBeTruthy();
  });
});

describe("PropertyCleanerAssignments — inactive / offboarded property with leftover cleaners", () => {
  const leftover = (
    status: "INACTIVE" | "OFFBOARDED",
    deleted = false,
  ): PropertyCleanerRow =>
    propertyRow({
      property: {
        id: "p9",
        name: "Old Villa",
        internalCode: "OV",
        status,
        deleted,
      },
      assignable: false,
      primary: assignment("p", "Alex Rivera", "PRIMARY"),
      teamMembers: [assignment("t", "Sam Lee", "TEAM_MEMBER")],
    });

  it.each([
    ["INACTIVE", false, "Inactive property"],
    ["OFFBOARDED", false, "Offboarded property"],
    ["INACTIVE", true, "Removed property"],
  ] as const)(
    "%s (deleted=%s) is labelled %s and offers ONLY Remove",
    (status, deleted, label) => {
      render(
        <PropertyCleanerAssignments
          rows={[leftover(status, deleted)]}
          activeCleaners={[{ id: "c9", name: "Pat Kim" }]}
          canManage
          assignAction={action}
          endAction={action}
        />,
      );
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Make primary" })).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    },
  );
});
