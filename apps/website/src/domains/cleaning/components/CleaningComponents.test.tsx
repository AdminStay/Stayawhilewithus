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

describe("Copy cleaner message (Cleaner Phase 5.1)", () => {
  const MESSAGE = "Hi Alex, cleaning scheduled:\nProperty: Harbor House";
  const cellBase = {
    scheduleId: "s1",
    propertyName: "Harbor House",
    propertyCleaners: PRIMARY_PROPERTY,
    activeCleaners: ACTIVE,
    canChange: true,
    action,
  };

  function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }

  it("shows the action when the job has a cleaner and a message was provided", () => {
    render(
      <CleaningCleanerCell
        {...cellBase}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        cleanerMessage={MESSAGE}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Copy cleaner message" }),
    ).toBeTruthy();
  });

  it('shows "Needs cleaner" and no copy action when the job has no cleaner', () => {
    render(
      <CleaningCleanerCell
        {...cellBase}
        cleaner={null}
        cleanerMessage={MESSAGE}
      />,
    );

    expect(screen.getByText("Needs cleaner")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copy cleaner message" }),
    ).toBeNull();
  });

  it("shows no copy action when no message is provided (non-admin / closed job)", () => {
    render(
      <CleaningCleanerCell
        {...cellBase}
        canChange={false}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Copy cleaner message" }),
    ).toBeNull();
  });

  it("copies exactly the message to the clipboard and confirms, without submitting any form", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const submit = vi.fn((e: Event) => e.preventDefault());
    document.addEventListener("submit", submit);

    render(
      <CleaningCleanerCell
        {...cellBase}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        cleanerMessage={MESSAGE}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy cleaner message" }),
    );

    expect(writeText).toHaveBeenCalledWith(MESSAGE);
    expect(
      await screen.findByRole("button", { name: "Copied ✓" }),
    ).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    document.removeEventListener("submit", submit);
  });

  it("falls back to showing the text when the clipboard is blocked", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    render(
      <CleaningCleanerCell
        {...cellBase}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        cleanerMessage={MESSAGE}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy cleaner message" }),
    );

    expect(await screen.findByText(/Couldn't copy automatically/)).toBeTruthy();
    expect(screen.getByText(/Property: Harbor House/)).toBeTruthy();
  });
});

describe("Mark cleaner notified (Cleaner Phase 5.2)", () => {
  const cell = {
    scheduleId: "s1",
    propertyName: "Harbor House",
    propertyCleaners: PRIMARY_PROPERTY,
    activeCleaners: ACTIVE,
    canChange: true,
    action,
  };
  const MARK = { name: "Mark cleaner notified" };

  function hidden(container: HTMLElement, name: string) {
    return (
      container.querySelector(
        `input[type="hidden"][name="${name}"]`,
      ) as HTMLInputElement | null
    )?.value;
  }

  it('shows "Not notified yet" and posts the job and the cleaner shown', () => {
    const { container } = render(
      <CleaningCleanerCell
        {...cell}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        notification={{ latest: null, action }}
      />,
    );

    expect(screen.getByText("Not notified yet")).toBeTruthy();
    expect(screen.getByRole("button", MARK)).toBeTruthy();
    const form = screen.getByRole("button", MARK).closest("form")!;
    expect(hidden(form, "scheduleId")).toBe("s1");
    expect(hidden(form, "cleanerId")).toBe(ALEX.id);
    expect(container.textContent).not.toMatch(/\d{3}.?\d{4}|•/);
  });

  it("shows when and by whom the current cleaner was notified", () => {
    render(
      <CleaningCleanerCell
        {...cell}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        notification={{
          latest: {
            cleanerId: ALEX.id,
            cleanerName: "Alex",
            notifiedAtLabel: "Oct 6, 2026, 10:05 AM CDT",
            notifiedByName: "Michelle",
          },
          action,
        }}
      />,
    );

    expect(
      screen.getByText(/Notified ✓ Oct 6, 2026, 10:05 AM CDT · by Michelle/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mark notified again" }),
    ).toBeTruthy();
  });

  it("does not count a notice sent to a previous cleaner", () => {
    render(
      <CleaningCleanerCell
        {...cell}
        cleaner={{ ...ALEX, status: "ACTIVE" }}
        notification={{
          latest: {
            cleanerId: SAM.id,
            cleanerName: "Sam",
            notifiedAtLabel: "Oct 5, 2026, 9:00 AM CDT",
            notifiedByName: null,
          },
          action,
        }}
      />,
    );

    expect(
      screen.getByText(/Not notified yet — the last notice went to Sam/),
    ).toBeTruthy();
    expect(screen.getByRole("button", MARK)).toBeTruthy();
  });

  it("is not shown without a cleaner, or when not provided (non-admin / closed job)", () => {
    render(
      <>
        <CleaningCleanerCell
          {...cell}
          cleaner={null}
          notification={{ latest: null, action }}
        />
        <CleaningCleanerCell
          {...cell}
          cleaner={{ ...ALEX, status: "ACTIVE" }}
        />
      </>,
    );

    expect(screen.queryByRole("button", MARK)).toBeNull();
    expect(screen.queryByText("Not notified yet")).toBeNull();
  });
});
