import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createCleaningSchedule: vi.fn(),
  assignCleaningScheduleCleaner: vi.fn(),
  markCleanerNotified: vi.fn(),
  completeCleaningSchedule: vi.fn(),
  cancelCleaningSchedule: vi.fn(),
  markCleaningScheduleMissed: vi.fn(),
  rescheduleCleaningSchedule: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: m.getCurrentUser,
}));
vi.mock("./services/cleaning.service", () => ({
  createCleaningSchedule: m.createCleaningSchedule,
  assignCleaningScheduleCleaner: m.assignCleaningScheduleCleaner,
  completeCleaningSchedule: m.completeCleaningSchedule,
  cancelCleaningSchedule: m.cancelCleaningSchedule,
  markCleaningScheduleMissed: m.markCleaningScheduleMissed,
  rescheduleCleaningSchedule: m.rescheduleCleaningSchedule,
}));
vi.mock("./services/cleaner-notifications.service", () => ({
  markCleanerNotified: m.markCleanerNotified,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@stayw/auth", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { ForbiddenError } from "@stayw/auth";

import {
  assignCleaningScheduleCleanerAction,
  cancelCleaningScheduleAction,
  completeCleaningScheduleAction,
  createCleaningScheduleAction,
  markCleanerNotifiedAction,
  markCleaningScheduleMissedAction,
  rescheduleCleaningScheduleAction,
  type CleaningFormState,
} from "./actions";
import { CleaningRuleError } from "./lib/errors";

const actor = { userId: "user-1" };
const IDLE: CleaningFormState = { status: "idle" };
const PROPERTY = "22222222-2222-2222-2222-222222222222";
const SCHEDULE = "55555555-5555-5555-5555-555555555555";
const SAM = "44444444-4444-4444-4444-444444444444";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const createFields = {
  propertyId: PROPERTY,
  reservationId: "",
  cleaningType: "TURNOVER",
  scheduledDate: "2026-10-10",
  scheduledStartTime: "",
  scheduledEndTime: "",
};

beforeEach(() => {
  vi.resetAllMocks();
  m.getCurrentUser.mockResolvedValue(actor);
});

describe("createCleaningScheduleAction", () => {
  it("passes an explicit cleanerId through and reports success", async () => {
    const state = await createCleaningScheduleAction(
      IDLE,
      form({ ...createFields, cleanerId: SAM }),
    );

    expect(m.createCleaningSchedule).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ propertyId: PROPERTY, cleanerId: SAM }),
    );
    expect(state).toEqual({
      status: "success",
      message: "Cleaning scheduled.",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/cleaning");
  });

  it("passes cleanerId as undefined when the form has no cleaner field (service applies the default)", async () => {
    await createCleaningScheduleAction(IDLE, form(createFields));

    expect(
      m.createCleaningSchedule.mock.calls[0]![1].cleanerId,
    ).toBeUndefined();
  });

  it('passes "" (explicitly no cleaner) through unchanged', async () => {
    await createCleaningScheduleAction(
      IDLE,
      form({ ...createFields, cleanerId: "" }),
    );

    expect(m.createCleaningSchedule.mock.calls[0]![1].cleanerId).toBe("");
  });

  it("shows a CleaningRuleError message as-is (e.g. admin-only / inactive cleaner)", async () => {
    m.createCleaningSchedule.mockRejectedValueOnce(
      new CleaningRuleError("Sam is inactive. Choose an active cleaner."),
    );

    const state = await createCleaningScheduleAction(
      IDLE,
      form({ ...createFields, cleanerId: SAM }),
    );

    expect(state).toEqual({
      status: "error",
      message: "Sam is inactive. Choose an active cleaner.",
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid cleanerId before calling the service", async () => {
    const state = await createCleaningScheduleAction(
      IDLE,
      form({ ...createFields, cleanerId: "not-a-uuid" }),
    );

    expect(state.status).toBe("validation_error");
    expect(m.createCleaningSchedule).not.toHaveBeenCalled();
  });
});

describe("assignCleaningScheduleCleanerAction", () => {
  it("assigns and reports the new cleaner", async () => {
    m.assignCleaningScheduleCleaner.mockResolvedValueOnce({
      changed: true,
      cleanerName: "Sam",
    });

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: SAM }),
    );

    expect(m.assignCleaningScheduleCleaner).toHaveBeenCalledWith(actor, {
      scheduleId: SCHEDULE,
      cleanerId: SAM,
    });
    expect(state).toEqual({
      status: "success",
      message: "Cleaner set to Sam.",
    });
  });

  it("requires a cleaner to be chosen", async () => {
    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: "" }),
    );

    expect(state).toEqual({
      status: "validation_error",
      message: "Choose a cleaner.",
    });
    expect(m.assignCleaningScheduleCleaner).not.toHaveBeenCalled();
  });

  it("maps a ForbiddenError to a fixed permission message", async () => {
    m.assignCleaningScheduleCleaner.mockRejectedValueOnce(
      new ForbiddenError("cleaning_schedules:update"),
    );

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: SAM }),
    );

    expect(state).toEqual({
      status: "error",
      message: "You don't have permission to change cleanings.",
    });
  });

  it("never shows an unexpected error's message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.assignCleaningScheduleCleaner.mockRejectedValueOnce(
      new Error("relation cleaning_schedules does not exist"),
    );

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: SAM }),
    );

    expect(state).toEqual({
      status: "error",
      message: "Something went wrong saving this change. Please try again.",
    });
    spy.mockRestore();
  });
});

describe("assignCleaningScheduleCleanerAction — clear (Needs cleaner)", () => {
  it('maps the picker\'s "none" to cleanerId null and reports the clear', async () => {
    m.assignCleaningScheduleCleaner.mockResolvedValueOnce({
      changed: true,
      cleanerName: null,
    });

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: "none" }),
    );

    expect(m.assignCleaningScheduleCleaner).toHaveBeenCalledWith(actor, {
      scheduleId: SCHEDULE,
      cleanerId: null,
    });
    expect(state).toEqual({
      status: "success",
      message: "Cleaner cleared — this cleaning needs a cleaner.",
    });
  });

  it("reports a no-op clear on an already-unassigned job", async () => {
    m.assignCleaningScheduleCleaner.mockResolvedValueOnce({
      changed: false,
      cleanerName: null,
    });

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: "none" }),
    );

    expect(state).toEqual({
      status: "success",
      message: "This cleaning already needs a cleaner.",
    });
  });

  it("shows the refusal for a MISSED job as-is", async () => {
    m.assignCleaningScheduleCleaner.mockRejectedValueOnce(
      new CleaningRuleError(
        "This cleaning is missed, so its cleaner can't be changed.",
      ),
    );

    const state = await assignCleaningScheduleCleanerAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: "none" }),
    );

    expect(state).toEqual({
      status: "error",
      message: "This cleaning is missed, so its cleaner can't be changed.",
    });
  });
});

describe("markCleanerNotifiedAction (Cleaner Phase 5.2)", () => {
  const ALEX_ID = "33333333-3333-3333-3333-333333333333";

  it("records the notification and reports it", async () => {
    m.markCleanerNotified.mockResolvedValueOnce({
      cleanerName: "Alex",
      notifiedAt: new Date(),
    });

    const state = await markCleanerNotifiedAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: ALEX_ID }),
    );

    expect(m.markCleanerNotified).toHaveBeenCalledWith(actor, {
      scheduleId: SCHEDULE,
      cleanerId: ALEX_ID,
    });
    expect(state).toEqual({
      status: "success",
      message: "Recorded: Alex was notified.",
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/cleaning");
  });

  it("validates input before calling the service", async () => {
    const state = await markCleanerNotifiedAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: "" }),
    );

    expect(state.status).toBe("validation_error");
    expect(m.markCleanerNotified).not.toHaveBeenCalled();
  });

  it("shows a refusal (e.g. not admin / cleaner changed) as-is", async () => {
    m.markCleanerNotified.mockRejectedValueOnce(
      new CleaningRuleError(
        "Only an admin can record that a cleaner was notified.",
      ),
    );

    const state = await markCleanerNotifiedAction(
      IDLE,
      form({ scheduleId: SCHEDULE, cleanerId: ALEX_ID }),
    );

    expect(state).toEqual({
      status: "error",
      message: "Only an admin can record that a cleaner was notified.",
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("lifecycle actions (2026-10-07)", () => {
  const cases: Array<{
    name: string;
    action: (formData: FormData) => Promise<void>;
    service: ReturnType<typeof vi.fn>;
    fields: Record<string, string>;
  }> = [
    {
      name: "completeCleaningScheduleAction",
      action: completeCleaningScheduleAction,
      service: m.completeCleaningSchedule,
      fields: { scheduleId: SCHEDULE },
    },
    {
      name: "cancelCleaningScheduleAction",
      action: cancelCleaningScheduleAction,
      service: m.cancelCleaningSchedule,
      fields: { scheduleId: SCHEDULE },
    },
    {
      name: "markCleaningScheduleMissedAction",
      action: markCleaningScheduleMissedAction,
      service: m.markCleaningScheduleMissed,
      fields: { scheduleId: SCHEDULE },
    },
    {
      name: "rescheduleCleaningScheduleAction",
      action: rescheduleCleaningScheduleAction,
      service: m.rescheduleCleaningSchedule,
      fields: { scheduleId: SCHEDULE, scheduledDate: "2026-10-12" },
    },
  ];

  it.each(cases)(
    "$name runs the service and refreshes /cleaning and /",
    async ({ action, service, fields }) => {
      service.mockResolvedValueOnce({});

      await action(form(fields));

      expect(service).toHaveBeenCalledWith(
        actor,
        SCHEDULE,
        ...(fields.scheduledDate
          ? [{ scheduledDate: new Date("2026-10-12") }]
          : []),
      );
      expect(m.revalidatePath).toHaveBeenCalledWith("/cleaning");
      expect(m.revalidatePath).toHaveBeenCalledWith("/");
    },
  );

  it.each(cases)(
    "$name: a rule refusal (stale page) doesn't throw — it refreshes so the real status shows",
    async ({ action, service, fields }) => {
      service.mockRejectedValueOnce(
        new CleaningRuleError("This cleaning is already completed."),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(action(form(fields))).resolves.toBeUndefined();

      expect(m.revalidatePath).toHaveBeenCalledWith("/cleaning");
      warn.mockRestore();
    },
  );

  it.each(cases)(
    "$name: any other error still throws",
    async ({ action, service, fields }) => {
      service.mockRejectedValueOnce(new ForbiddenError("nope"));

      await expect(action(form(fields))).rejects.toThrow();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
