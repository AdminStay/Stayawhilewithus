import { z } from "zod";

export const createPropertySchema = z.object({
  name: z.string().min(1).max(200),
  internalCode: z.string().min(1).max(50),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  propertyType: z.enum(["HOUSE", "APARTMENT", "CONDO", "CABIN", "OTHER"]),
  bedroomCount: z.number().int().min(0),
  bathroomCount: z.number().min(0),
  maxOccupancy: z.number().int().min(1),
  timezone: z.string().min(1),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
