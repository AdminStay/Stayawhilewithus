"use server";

import { revalidatePath } from "next/cache";

import { confirmOwnerRezLinkSchema } from "./schemas/ownerrez-link.schema";
import { createPropertyFromOwnerRezSchema } from "./schemas/ownerrez-onboarding.schema";
import {
  createPropertySchema,
  updatePropertyOccupancySchema,
  updatePropertyStatusSchema,
} from "./schemas/properties.schema";
import { confirmOwnerRezLink } from "./services/ownerrez-link.service";
import {
  syncMaxGuestsFromOwnerRez,
  type MaxGuestsSyncPropertyResult,
} from "./services/ownerrez-max-guests-sync.service";
import { createPropertyFromOwnerRez } from "./services/ownerrez-onboarding.service";
import {
  createProperty,
  deleteProperty,
  updatePropertyOccupancy,
  updatePropertyStatus,
} from "./services/properties.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

export async function createPropertyAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createPropertySchema.parse({
    name: formData.get("name"),
    internalCode: formData.get("internalCode"),
    addressLine1: formData.get("addressLine1"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country"),
    propertyType: formData.get("propertyType"),
    bedroomCount: Number(formData.get("bedroomCount")),
    bathroomCount: Number(formData.get("bathroomCount")),
    maxOccupancy: Number(formData.get("maxOccupancy")),
    timezone: formData.get("timezone"),
  });

  await createProperty(actor, input);
  revalidatePath("/properties");
}

export async function updatePropertyStatusAction(formData: FormData) {
  const actor = await getCurrentUser();
  const propertyId = formData.get("propertyId") as string;

  const input = updatePropertyStatusSchema.parse({
    status: formData.get("status"),
  });

  await updatePropertyStatus(actor, propertyId, input);
  revalidatePath("/properties");
}

export async function updatePropertyOccupancyAction(formData: FormData) {
  const actor = await getCurrentUser();
  const propertyId = formData.get("propertyId") as string;

  const input = updatePropertyOccupancySchema.parse({
    maxOccupancy: Number(formData.get("maxOccupancy")),
  });

  await updatePropertyOccupancy(actor, propertyId, input);
  revalidatePath("/properties");
}

export async function deletePropertyAction(formData: FormData) {
  const actor = await getCurrentUser();
  const propertyId = formData.get("propertyId") as string;

  await deleteProperty(actor, propertyId);
  revalidatePath("/properties");
}

/**
 * One confirmation per submission — the form this binds to
 * (OwnerRezConfirmLinkPanel) never submits more than one
 * propertyId/ownerRezPropertyId pair per request, and this action has no
 * array/bulk input shape to accept one even if a request tried. All real
 * validation (approval, current link state, exact-id match) happens inside
 * confirmOwnerRezLink() — this action is just the form-data-to-typed-input
 * boundary, same as every other action in this file.
 */
export async function confirmOwnerRezLinkAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = confirmOwnerRezLinkSchema.parse({
    propertyId: formData.get("propertyId"),
    ownerRezPropertyId: formData.get("ownerRezPropertyId"),
  });

  await confirmOwnerRezLink(actor, input);
  revalidatePath("/properties/ownerrez");
}

/**
 * Renders instead of any real error's own message whenever that error isn't
 * one of createPropertyFromOwnerRez()'s own deliberately-thrown, human-authored
 * Errors (duplicate/missing-field/RBAC messages — all already safe to show
 * verbatim, and already relied on elsewhere in this app). Never includes a
 * stack trace, a raw Prisma validation dump, or any provider/HTTP detail.
 */
const GENERIC_CREATE_ERROR =
  "Something went wrong creating this property. Try again, or check with an admin if this keeps happening.";

/**
 * Duck-typed on the error's own constructor name — same convention already
 * used by isUniqueConstraintViolation() (ownerrez-link.service.ts, checking
 * `err.code === "P2002"`) rather than importing Prisma's error classes for
 * an `instanceof` check. Prisma's own client errors (a schema/type mismatch
 * surfacing as PrismaClientValidationError, a DB-level failure as
 * PrismaClientKnownRequestError/PrismaClientInitializationError/
 * PrismaClientRustPanicError) are never our own authored copy — their
 * messages can be long, technical dumps of the attempted query/arguments.
 * Everything else thrown by createPropertyFromOwnerRez() is a plain
 * `new Error("...")` with a message this codebase wrote itself (duplicate
 * checks, missing-required-field list, RBAC denial) and that's already
 * safe to render as-is.
 */
const PRISMA_CLIENT_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientValidationError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
]);

function isPrismaClientError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return PRISMA_CLIENT_ERROR_NAMES.has(err.constructor?.name ?? "");
}

export type CreatePropertyFromOwnerRezActionState =
  | { status: "idle" }
  | { status: "success"; propertyId: string; propertyName: string }
  | { status: "failure"; error: string };

/**
 * One creation per submission — no array/bulk input shape exists here or
 * in createPropertyFromOwnerRezSchema. The only values this action forwards
 * are which OwnerRez property to create from, and an optional admin-chosen
 * timezone; every actual Property field is derived server-side inside
 * createPropertyFromOwnerRez() from a fresh OwnerRez fetch, never from this
 * form. createPropertyFromOwnerRez()'s own validation (duplicate checks,
 * required-field checks, the timezone-fallback allowlist check, the DB's
 * own unique constraints) is completely unchanged — this wrapper only
 * decides how a thrown error reaches the screen instead of crashing the
 * whole page to Next.js's generic error boundary, the same catch-and-report
 * pattern already proven by runDiscovery() in the smart-devices domain.
 * An empty/absent `timezoneOverride` is normalized to `undefined` here
 * (never an empty string) so a row that doesn't need it never trips the
 * schema's `.min(1)` check with a raw Zod error.
 */
export async function createPropertyFromOwnerRezAction(
  _prevState: CreatePropertyFromOwnerRezActionState,
  formData: FormData,
): Promise<CreatePropertyFromOwnerRezActionState> {
  try {
    const actor = await getCurrentUser();

    const input = createPropertyFromOwnerRezSchema.parse({
      ownerRezPropertyId: formData.get("ownerRezPropertyId"),
      timezoneOverride: formData.get("timezoneOverride") || undefined,
    });

    const property = await createPropertyFromOwnerRez(actor, input);
    revalidatePath("/properties/ownerrez");
    return {
      status: "success",
      propertyId: property.id,
      propertyName: property.name,
    };
  } catch (err) {
    return {
      status: "failure",
      error:
        !isPrismaClientError(err) && err instanceof Error
          ? err.message
          : GENERIC_CREATE_ERROR,
    };
  }
}

export type SyncMaxGuestsActionState =
  | { status: "idle" }
  | { status: "not_configured" }
  | {
      status: "success";
      results: MaxGuestsSyncPropertyResult[];
      rateLimited: boolean;
    }
  | { status: "failure"; error: string };

const GENERIC_SYNC_ERROR =
  "Something went wrong syncing maximum guests from OwnerRez. Nothing further was changed; try again later.";

/**
 * "Sync max guests from OwnerRez" on /properties (2026-10-21). Takes no
 * input: which properties and which values are decided entirely
 * server-side by syncMaxGuestsFromOwnerRez() (linked properties only,
 * OwnerRez max_guests → maxOccupancy, nothing else). Per-property failures
 * come back in `results`; only an unexpected top-level error (RBAC denial,
 * database failure) lands here, rendered without Prisma/HTTP detail.
 */
export async function syncMaxGuestsFromOwnerRezAction(
  _prevState: SyncMaxGuestsActionState,
): Promise<SyncMaxGuestsActionState> {
  try {
    const actor = await getCurrentUser();
    const result = await syncMaxGuestsFromOwnerRez(actor);
    if (!result.configured) return { status: "not_configured" };
    if (result.counts.updated > 0) revalidatePath("/properties");
    return {
      status: "success",
      results: result.results,
      rateLimited: result.rateLimited,
    };
  } catch (err) {
    return {
      status: "failure",
      error:
        !isPrismaClientError(err) && err instanceof Error
          ? err.message
          : GENERIC_SYNC_ERROR,
    };
  }
}
