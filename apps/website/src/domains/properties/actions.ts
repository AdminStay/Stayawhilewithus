"use server";

import { revalidatePath } from "next/cache";

import { confirmOwnerRezPropertyMatchSchema } from "./schemas/ownerrez-match.schema";
import {
  createPropertySchema,
  updatePropertyOccupancySchema,
  updatePropertyStatusSchema,
} from "./schemas/properties.schema";
import {
  confirmOwnerRezPropertyMatch,
  syncLinkedOwnerRezProperties,
} from "./services/ownerrez-sync.service";
import {
  createProperty,
  deleteProperty,
  updatePropertyOccupancy,
  updatePropertyStatus,
} from "./services/properties.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";

const OWNERREZ_SYNC_PAGE_PATH = "/properties/ownerrez";

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

export async function confirmOwnerRezPropertyMatchAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = confirmOwnerRezPropertyMatchSchema.parse({
    propertyId: formData.get("propertyId"),
    ownerRezPropertyId: formData.get("ownerRezPropertyId"),
  });

  await confirmOwnerRezPropertyMatch(actor, input);
  revalidatePath(OWNERREZ_SYNC_PAGE_PATH);
  revalidatePath("/properties");
}

export async function syncLinkedOwnerRezPropertiesAction() {
  const actor = await getCurrentUser();

  await syncLinkedOwnerRezProperties(actor);
  revalidatePath(OWNERREZ_SYNC_PAGE_PATH);
  revalidatePath("/properties");
}
