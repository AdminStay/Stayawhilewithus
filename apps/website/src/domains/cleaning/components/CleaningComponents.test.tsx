// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CleaningCleanerCell } from "./CleaningCleanerCell";
import { CreateCleaningScheduleForm } from "./CreateCleaningScheduleForm";
import { cleanerOptionGroups, isTeamOnly } from "./cleaner-options";

afterEach(cleanup);

const action = vi.fn();

const ALEX = { id: "c-alex", name: "Alex" };
const SAM = { id: "c-sam", name: "Sam" };
const KRIS = { id: "c-kris", name: "Kris" };
const LOLIS = { id: "c-lolis", name: "Lolis" };
const ACTIVE = [ALEX, KRIS, LOLIS, SAM];

const PRIMARY_PROPERTY = { primary: ALEX, teamMembers: [] };
const TEAM_ONLY = { primary: null, teamMembers: [KRIS, LOLIS] };

function optionLabels(select: HTMLSelectElement) {
  return Array.from(select.options).map((o) => o.textContent);
}

describe("cleanerOptionGroups / isTeamOnly", () => {
  it("lists the property's primary/team first (labelled), then other ACTIVE cleaners", () => {
    expect(cleanerOptionGroups(TEAM_ONLY, ACTIVE)).toEqual([
      {
        label: "At this property",
        options: [
          { ...KRIS, label: "Kris (team)" },
          { ...LOLIS, label: "Lolis (team)" },
        ],
      },
      {
        label: "Other active cleaners",
        options: [
          { ...ALEX, label: "Alex" },
          { ...SAM, label: "Sam" },
        ],
      },
    ]);
  });

  it("only offers ACTIVE cleaners — a primary missing from the active list is left out", () => {
    const groups = cleanerOptionGroups(PRIMARY_PROPERTY, [SAM]);
    expect(groups).toEqual([
      { label: "Other active cleaners", options: [{ ...SAM, label: "Sam" }] },
    ]);
  });

  it("team-only means team members and no primary", () => {
    expect(isTeamOnly(TEAM_ONLY)).toBe(true);
    expect(isTeamOnly(PRIMARY_PROPERTY)).toBe(false);
    expect(isTeamOnly({ primary: null, teamMembers: [] })).toBe(false);
    expect(isTeamOnly(undefined)).toBe(false);
  });
});

describe("CleaningCleanerCell", () => {
  const base = {
    scheduleId: "s1",
    propertyName: "Harbor House",
    activeCleaners: ACTIVE,
    action,
  };

  it("shows the job's stored cleaner; no picker without permission", () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        propertyCleaners={PRIMARY_PROPERTY}
        canChange={false}
      />,
    );

    expect(screen.getByText("Alex")).toBeTruthy();
    expect(screen.queryByText("Needs cleaner")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it('shows "Needs cleaner" when the job has no cleaner', () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={null}
        propertyCleaners={undefined}
        canChange={false}
      />,
    );

    expect(screen.getByText("Needs cleaner")).toBeTruthy();
  });

  it("marks a stored cleaner who has since been deactivated", () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={{ ...SAM, status: "INACTIVE" }}
        propertyCleaners={PRIMARY_PROPERTY}
        canChange={false}
      />,
    );

    expect(screen.getByText("Inactive")).toBeTruthy();
  });

  it.each(["Sandy Nudes", "Roseate Madre"])(
    "%s: shows the team with no primary, needs a cleaner, and offers Kris or Lolis — none pre-selected",
    (propertyName) => {
      render(
        <CleaningCleanerCell
          {...base}
          propertyName={propertyName}
          cleaner={null}
          propertyCleaners={TEAM_ONLY}
          canChange
        />,
      );

      expect(screen.getByText("Needs cleaner")).toBeTruthy();
      expect(screen.getByText(/Team: Kris, Lolis/)).toBeTruthy();
      expect(screen.getByText(/no primary/)).toBeTruthy();
      expect(screen.queryByText(/\(primary\)/)).toBeNull();

      const select = screen.getByRole("combobox", {
        name: `Cleaner for this cleaning at ${propertyName}`,
      }) as HTMLSelectElement;
      expect(optionLabels(select)).toEqual(
        expect.arrayContaining(["Kris (team)", "Lolis (team)"]),
      );
      expect(select.value).toBe("");
      expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy();
    },
  );

  it("pre-selects the job's current cleaner and offers Change", () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={{ ...KRIS, status: "ACTIVE" }}
        propertyCleaners={TEAM_ONLY}
        canChange
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(KRIS.id);
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it('offers "Needs cleaner (clear assignment)" on an assigned job, alongside the other active cleaners', () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={{ ...KRIS, status: "ACTIVE" }}
        propertyCleaners={TEAM_ONLY}
        canChange
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const clear = Array.from(select.options).find(
      (o) => o.textContent === "Needs cleaner (clear assignment)",
    );
    expect(clear?.value).toBe("none");
    expect(clear?.disabled).toBe(false);
    // assigned → different active cleaner remains possible
    expect(optionLabels(select)).toEqual(
      expect.arrayContaining(["Lolis (team)", "Alex", "Sam"]),
    );
    // Team display unchanged
    expect(screen.getByText(/Team: Kris, Lolis/)).toBeTruthy();
  });

  it("offers no clear option on a job that already needs a cleaner", () => {
    render(
      <CleaningCleanerCell
        {...base}
        cleaner={null}
        propertyCleaners={TEAM_ONLY}
        canChange
      />,
    );

    expect(
      optionLabels(screen.getByRole("combobox") as HTMLSelectElement),
    ).not.toContain("Needs cleaner (clear assignment)");
  });

  it("still offers clearing when no other active cleaner exists", () => {
    render(
      <CleaningCleanerCell
        {...base}
        activeCleaners={[]}
        cleaner={{ ...SAM, status: "INACTIVE" }}
        propertyCleaners={undefined}
        canChange
      />,
    );

    expect(
      optionLabels(screen.getByRole("combobox") as HTMLSelectElement),
    ).toContain("Needs cleaner (clear assignment)");
  });

  it("renders no phone number anywhere", () => {
    const { container } = render(
      <CleaningCleanerCell
        {...base}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        propertyCleaners={TEAM_ONLY}
        canChange
      />,
    );

    expect(container.textContent).not.toMatch(/\d{3}.?\d{4}|•/);
  });
});

describe("CreateCleaningScheduleForm", () => {
  const properties = [
    { id: "p-primary", name: "Harbor House" },
    { id: "p-sandy", name: "Sandy Nudes" },
    { id: "p-none", name: "Empty Cottage" },
  ];
  const cleaners = {
    propertyCleaners: { "p-primary": PRIMARY_PROPERTY, "p-sandy": TEAM_ONLY },
    activeCleaners: ACTIVE,
    canChoose: true,
  };

  function choose(propertyId: string) {
    fireEvent.change(screen.getByLabelText("Property"), {
      target: { value: propertyId },
    });
  }

  it("pre-selects the property's current PRIMARY as the cleaner", () => {
    render(
      <CreateCleaningScheduleForm
        properties={properties}
        reservations={[]}
        cleaners={cleaners}
        action={action}
      />,
    );
    choose("p-primary");

    const select = screen.getByLabelText("Cleaner") as HTMLSelectElement;
    expect(select.value).toBe(ALEX.id);
    expect(screen.getByText("Default: Alex (current primary).")).toBeTruthy();
  });

  it("team-only property: shows the team, selects nobody automatically, and offers Kris or Lolis", () => {
    render(
      <CreateCleaningScheduleForm
        properties={properties}
        reservations={[]}
        cleaners={cleaners}
        action={action}
      />,
    );
    choose("p-sandy");

    const select = screen.getByLabelText("Cleaner") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText(/Team: Kris, Lolis — no primary/)).toBeTruthy();
    expect(optionLabels(select)).toEqual(
      expect.arrayContaining(["Kris (team)", "Lolis (team)"]),
    );

    fireEvent.change(select, { target: { value: LOLIS.id } });
    expect(select.value).toBe(LOLIS.id);
  });

  it("re-defaults when the property changes (never carries a team member over)", () => {
    render(
      <CreateCleaningScheduleForm
        properties={properties}
        reservations={[]}
        cleaners={cleaners}
        action={action}
      />,
    );
    choose("p-sandy");
    fireEvent.change(screen.getByLabelText("Cleaner"), {
      target: { value: KRIS.id },
    });
    choose("p-none");

    expect((screen.getByLabelText("Cleaner") as HTMLSelectElement).value).toBe(
      "",
    );
    expect(screen.getByText(/no cleaner assigned/)).toBeTruthy();
  });

  it("a non-admin sees the default and submits it explicitly, with no picker", () => {
    const { container } = render(
      <CreateCleaningScheduleForm
        properties={properties}
        reservations={[]}
        cleaners={{ ...cleaners, canChoose: false }}
        action={action}
      />,
    );
    choose("p-primary");

    expect(screen.queryByRole("combobox", { name: "Cleaner" })).toBeNull();
    const hidden = container.querySelector(
      'input[name="cleanerId"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe(ALEX.id);
  });

  it("without cleaners:read there is no cleaner field at all (server applies the default)", () => {
    const { container } = render(
      <CreateCleaningScheduleForm
        properties={properties}
        reservations={[]}
        action={action}
      />,
    );
    choose("p-primary");

    expect(container.querySelector('[name="cleanerId"]')).toBeNull();
  });
});
