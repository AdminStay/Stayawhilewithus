import { z } from "zod";

/**
 * Deliberately the only input this action ever accepts — which OwnerRez
 * property to create from. Every actual Property field (name, address,
 * bedroomCount, etc.) is derived server-side from a fresh
 * OwnerrezClient.getProperty() call in createPropertyFromOwnerRez(), never
 * trusted from a form value — so there is no field here to tamper with
 * beyond picking a different (still real) OwnerRez id.
 */
export const createPropertyFromOwnerRezSchema = z.object({
  ownerRezPropertyId: z.string().min(1),
});

export type CreatePropertyFromOwnerRezInput = z.infer<
  typeof createPropertyFromOwnerRezSchema
>;
