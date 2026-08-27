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
 * One creation per submission — no array/bulk input shape exists here or
 * in createPropertyFromOwnerRezSchema. The only value this action forwards
 * is which OwnerRez property to create from; every actual Property field
 * is derived server-side inside createPropertyFromOwnerRez() from a fresh
 * OwnerRez fetch, never from this form.
 */
export async function createPropertyFromOwnerRezAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = createPropertyFromOwnerRezSchema.parse({
    ownerRezPropertyId: formData.get("ownerRezPropertyId"),
  });

  await createPropertyFromOwnerRez(actor, input);
  revalidatePath("/properties/ownerrez");
}
