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

export const updatePropertyStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ONBOARDING", "OFFBOARDED"]),
});

export type UpdatePropertyStatusInput = z.infer<
  typeof updatePropertyStatusSchema
>;

/**
 * maxOccupancy changes independently of everything else on a Property —
 * bed arrangements get reconfigured over time. Deliberately its own
 * schema/service/action (not folded into a general "edit property" form)
 * so it's obvious this touches nothing else, in particular no relationship
 * to AUGUST_PROPERTY_MAP/SmartDevice: that mapping is keyed by the
 * property's id, which never changes when occupancy does.
 */
export const updatePropertyOccupancySchema = z.object({
  maxOccupancy: z.number().int().min(1),
});

export type UpdatePropertyOccupancyInput = z.infer<
  typeof updatePropertyOccupancySchema
>;
