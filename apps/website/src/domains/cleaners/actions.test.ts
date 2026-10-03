import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createCleaner: vi.fn(),
  updateCleaner: vi.fn(),
  setCleanerStatus: vi.fn(),
  addCleanerContact: vi.fn(),
  updateCleanerContact: vi.fn(),
  removeCleanerContact: vi.fn(),
  setPrimaryCleaner: vi.fn(),
  addTeamMember: vi.fn(),
  endCleanerAssignment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: m.getCurrentUser,
}));
vi.mock("./services/cleaners.service", () => ({
  createCleaner: m.createCleaner,
  updateCleaner: m.updateCleaner,
  setCleanerStatus: m.setCleanerStatus,
  addCleanerContact: m.addCleanerContact,
  updateCleanerContact: m.updateCleanerContact,
  removeCleanerContact: m.removeCleanerContact,
}));
vi.mock("./services/cleaner-assignments.service", () => ({
  setPrimaryCleaner: m.setPrimaryCleaner,
  addTeamMember: m.addTeamMember,
  endCleanerAssignment: m.endCleanerAssignment,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@stayw/auth", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { ForbiddenError } from "@stayw/auth";

import {
  addCleanerContactAction,
  assignCleanerAction,
  createCleanerAction,
  endCleanerAssignmentAction,
  removeCleanerContactAction,
  type CleanerFormState,
} from "./actions";
import { CleanerRuleError } from "./lib/errors";

const actor = { userId: "user-1" };
const IDLE: CleanerFormState = { status: "idle" };
const P = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.getCurrentUser.mockResolvedValue(actor);
});

describe("createCleanerAction", () => {
  it("normalizes the phone before calling the service and revalidates both pages", async () => {
    m.createCleaner.mockResolvedValueOnce({ name: "Alex" });

    const result = await createCleanerAction(
      IDLE,
      formData({ name: "Alex", phone: "305-555-0123", notes: "" }),
    );

    expect(m.createCleaner).toHaveBeenCalledWith(actor, {
      name: "Alex",
      phone: "+13055550123",
      notes: "",
    });
    expect(result).toEqual({ status: "success", message: "Alex added." });
    expect(m.revalidatePath).toHaveBeenCalledWith("/cleaners");
    expect(m.revalidatePath).toHaveBeenCalledWith("/properties");
  });

  it("invalid input never reaches the service", async () => {
    const result = await createCleanerAction(
      IDLE,
      formData({ name: "Alex", phone: "12", notes: "" }),
    );
    expect(result.status).toBe("validation_error");
    expect(m.createCleaner).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("a DB error is replaced by a generic message (no internals reach the browser)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.createCleaner.mockRejectedValueOnce(
      new Error('relation "cleaners" column secret_detail'),
    );
    const result = await createCleanerAction(
      IDLE,
      formData({ name: "Alex", phone: "3055550123", notes: "" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Something went wrong saving this change. Please try again.",
    });
    spy.mockRestore();
  });

  it("a permission refusal gets a fixed, readable message", async () => {
    m.createCleaner.mockRejectedValueOnce(
      new ForbiddenError("cleaners:manage"),
    );
    const result = await createCleanerAction(
      IDLE,
      formData({ name: "Alex", phone: "3055550123", notes: "" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "You don't have permission to manage cleaners.",
    });
  });
});

describe("assignCleanerAction", () => {
  it("role PRIMARY routes to setPrimaryCleaner", async () => {
    const result = await assignCleanerAction(
      IDLE,
      formData({ propertyId: P, cleanerId: C, role: "PRIMARY" }),
    );
    expect(m.setPrimaryCleaner).toHaveBeenCalledWith(actor, {
      propertyId: P,
      cleanerId: C,
      role: "PRIMARY",
    });
    expect(m.addTeamMember).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("role TEAM_MEMBER routes to addTeamMember", async () => {
    await assignCleanerAction(
      IDLE,
      formData({ propertyId: P, cleanerId: C, role: "TEAM_MEMBER" }),
    );
    expect(m.addTeamMember).toHaveBeenCalled();
    expect(m.setPrimaryCleaner).not.toHaveBeenCalled();
  });

  it("a rule refusal's own message is shown", async () => {
    m.setPrimaryCleaner.mockRejectedValueOnce(
      new CleanerRuleError(
        "Alex is inactive. Reactivate them before assigning.",
      ),
    );
    const result = await assignCleanerAction(
      IDLE,
      formData({ propertyId: P, cleanerId: C, role: "PRIMARY" }),
    );
    expect(result).toEqual({
      status: "error",
      message: "Alex is inactive. Reactivate them before assigning.",
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("endCleanerAssignmentAction", () => {
  it("ends the assignment by id", async () => {
    const result = await endCleanerAssignmentAction(
      IDLE,
      formData({ assignmentId: P }),
    );
    expect(m.endCleanerAssignment).toHaveBeenCalledWith(actor, {
      assignmentId: P,
    });
    expect(result.status).toBe("success");
  });
});

describe("backup contact actions", () => {
  it("add normalizes the phone and passes name/relationship through", async () => {
    const result = await addCleanerContactAction(
      IDLE,
      formData({
        cleanerId: C,
        phone: "941-555-0199",
        name: "Jordan",
        relationship: "Sister",
        notes: "",
      }),
    );
    expect(m.addCleanerContact).toHaveBeenCalledWith(actor, {
      cleanerId: C,
      phone: "+19415550199",
      name: "Jordan",
      relationship: "Sister",
      notes: "",
    });
    expect(result).toEqual({
      status: "success",
      message: "Backup contact added.",
    });
  });

  it("add with an unusable phone never reaches the service", async () => {
    const result = await addCleanerContactAction(
      IDLE,
      formData({
        cleanerId: C,
        phone: "12",
        name: "",
        relationship: "",
        notes: "",
      }),
    );
    expect(result.status).toBe("validation_error");
    expect(m.addCleanerContact).not.toHaveBeenCalled();
  });

  it("remove passes the contact id", async () => {
    await removeCleanerContactAction(IDLE, formData({ id: P }));
    expect(m.removeCleanerContact).toHaveBeenCalledWith(actor, { id: P });
  });
});
