"use server";

import { revalidatePath } from "next/cache";

import {
  createResourceLinkSchema,
  deleteResourceLinkSchema,
  updateResourceLinkSchema,
} from "./schemas/resource-links.schema";
import {
  createResourceLink,
  deleteResourceLink,
  updateResourceLink,
} from "./services/resource-links.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Discriminated result instead of a thrown error — same "never crash to
 * the dashboard's generic error boundary for an expected, user-fixable
 * outcome" convention already used for Notion's edit path (see
 * integrations/actions.ts's UpdateNotionFieldActionState). Before this,
 * createResourceLinkSchema.parse()/updateResourceLinkSchema.parse() threw
 * straight out of a plain <form action={fn}>, which propagates to
 * app/(dashboard)/error.tsx's generic boundary for something as ordinary
 * as a blank name or a non-http(s) URL. `message` is deliberately a single
 * general string, not a per-field map — this fixes the crash, it doesn't
 * add new per-field UI.
 */
export type ResourceLinkFormState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "validation_error"; message: string }
  | { status: "error"; message: string };

/**
 * Never derived from the caught error — a real Prisma/DB failure's own
 * `.message` can legitimately contain schema/column/connection detail that
 * must never reach the browser. The real error is still logged
 * server-side (console.error) for debugging; only this fixed, safe string
 * ever reaches the client.
 */
const GENERIC_ERROR_MESSAGE =
  "Something went wrong saving this resource. Please try again.";

export async function createResourceLinkAction(
  _prevState: ResourceLinkFormState,
  formData: FormData,
): Promise<ResourceLinkFormState> {
  const parsed = createResourceLinkSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    description: formData.get("description"),
    category: formData.get("category"),
    propertyId: formData.get("propertyId"),
  });
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const actor = await getCurrentUser();
    await createResourceLink(actor, parsed.data);
  } catch (err) {
    console.error("createResourceLinkAction failed:", err);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/resources");
  return { status: "success" };
}

export async function updateResourceLinkAction(
  _prevState: ResourceLinkFormState,
  formData: FormData,
): Promise<ResourceLinkFormState> {
  const parsed = updateResourceLinkSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    url: formData.get("url"),
    description: formData.get("description"),
    category: formData.get("category"),
    propertyId: formData.get("propertyId"),
  });
  if (!parsed.success) {
    return {
      status: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const actor = await getCurrentUser();
    await updateResourceLink(actor, parsed.data);
  } catch (err) {
    console.error("updateResourceLinkAction failed:", err);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }

  revalidatePath("/resources");
  return { status: "success" };
}

/**
 * Deliberately UNCHANGED behavior — reviewed per explicit instruction, no
 * defect found: `id` is always a hidden-input value copied straight from
 * an existing row (never user-typed), so there is no real "user fixes
 * their input and resubmits" scenario here the way there is for
 * create/update. Not converted to the discriminated-result pattern; not
 * redesigned.
 */
export async function deleteResourceLinkAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = deleteResourceLinkSchema.parse({
    id: formData.get("id"),
  });

  await deleteResourceLink(actor, input.id);
  revalidatePath("/resources");
}
