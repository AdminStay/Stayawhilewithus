"use server";

import { revalidatePath } from "next/cache";

import { createPropertySchema } from "./schemas/properties.schema";
import { createProperty } from "./services/properties.service";

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
