"use server";

import { ForbiddenError } from "@stayw/auth";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { CleanerRuleError } from "./lib/errors";
import {
  addCleanerContactSchema,
  assignCleanerSchema,
  createCleanerSchema,
  endCleanerAssignmentSchema,
  removeCleanerContactSchema,
  setCleanerStatusSchema,
  updateCleanerContactSchema,
  updateCleanerSchema,
} from "./schemas/cleaners.schema";
import {
  addTeamMember,
  endCleanerAssignment,
  setPrimaryCleaner,
} from "./services/cleaner-assignments.service";
import {
  addCleanerContact,
  createCleaner,
  removeCleanerContact,
  setCleanerStatus,
  updateCleaner,
  updateCleanerContact,
} from "./services/cleaners.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Same discriminated-result convention as resources/actions.ts: an
 * expected, user-fixable outcome (bad phone, inactive cleaner, already
 * assigned, no permission) comes back as a message instead of crashing to
 * the dashboard's error boundary. Only CleanerRuleError messages (written
 * by us for the user) and a fixed permission message are ever shown; any
 * other error is logged server-side and replaced by a generic string, so
 * DB/schema detail never reaches the browser.
 */
export type CleanerFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "validation_error"; message: string }
  | { status: "error"; message: string };

const GENERIC_ERROR_MESSAGE =
  "Something went wrong saving this change. Please try again.";
const FORBIDDEN_MESSAGE = "You don't have permission to manage cleaners.";

async function run<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: Record<string, FormDataEntryValue | null>,
  label: string,
  fn: (input: T) => Promise<string>,
): Promise<CleanerFormState> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  let message: string;
  try {
    message = await fn(parsed.data);
  } catch (err) {
    if (err instanceof CleanerRuleError) {
      return { status: "error", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return { status: "error", message: FORBIDDEN_MESSAGE };
    }
    console.error(`${label} failed:`, err);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/cleaners");
  revalidatePath("/properties");
  return { status: "success", message };
}

export async function createCleanerAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    createCleanerSchema,
    {
      name: formData.get("name"),
      phone: formData.get("phone"),
      notes: formData.get("notes"),
    },
    "createCleanerAction",
    async (input) => {
      const actor = await getCurrentUser();
      const cleaner = await createCleaner(actor, input);
      return `${cleaner.name} added.`;
    },
  );
}

export async function updateCleanerAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    updateCleanerSchema,
    {
      id: formData.get("id"),
      name: formData.get("name"),
      phone: formData.get("phone"),
      notes: formData.get("notes"),
    },
    "updateCleanerAction",
    async (input) => {
      const actor = await getCurrentUser();
      await updateCleaner(actor, input);
      return "Changes saved.";
    },
  );
}

export async function setCleanerStatusAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    setCleanerStatusSchema,
    { id: formData.get("id"), status: formData.get("status") },
    "setCleanerStatusAction",
    async (input) => {
      const actor = await getCurrentUser();
      const cleaner = await setCleanerStatus(actor, input);
      return `${cleaner.name} is now ${cleaner.status === "ACTIVE" ? "active" : "inactive"}.`;
    },
  );
}

/** One action for both roles: PRIMARY → setPrimaryCleaner (also "Make primary"), TEAM_MEMBER → addTeamMember. */
export async function assignCleanerAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    assignCleanerSchema,
    {
      propertyId: formData.get("propertyId"),
      cleanerId: formData.get("cleanerId"),
      role: formData.get("role"),
    },
    "assignCleanerAction",
    async (input) => {
      const actor = await getCurrentUser();
      if (input.role === "PRIMARY") {
        await setPrimaryCleaner(actor, input);
        return "Primary cleaner set.";
      }
      await addTeamMember(actor, input);
      return "Team member added.";
    },
  );
}

export async function endCleanerAssignmentAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    endCleanerAssignmentSchema,
    { assignmentId: formData.get("assignmentId") },
    "endCleanerAssignmentAction",
    async (input) => {
      const actor = await getCurrentUser();
      await endCleanerAssignment(actor, input);
      return "Removed from this property.";
    },
  );
}

const contactFields = (formData: FormData) => ({
  phone: formData.get("phone"),
  name: formData.get("name"),
  relationship: formData.get("relationship"),
  notes: formData.get("notes"),
});

export async function addCleanerContactAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    addCleanerContactSchema,
    { cleanerId: formData.get("cleanerId"), ...contactFields(formData) },
    "addCleanerContactAction",
    async (input) => {
      const actor = await getCurrentUser();
      await addCleanerContact(actor, input);
      return "Backup contact added.";
    },
  );
}

export async function updateCleanerContactAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    updateCleanerContactSchema,
    { id: formData.get("id"), ...contactFields(formData) },
    "updateCleanerContactAction",
    async (input) => {
      const actor = await getCurrentUser();
      await updateCleanerContact(actor, input);
      return "Backup contact saved.";
    },
  );
}

export async function removeCleanerContactAction(
  _prevState: CleanerFormState,
  formData: FormData,
): Promise<CleanerFormState> {
  return run(
    removeCleanerContactSchema,
    { id: formData.get("id") },
    "removeCleanerContactAction",
    async (input) => {
      const actor = await getCurrentUser();
      await removeCleanerContact(actor, input);
      return "Backup contact removed.";
    },
  );
}
