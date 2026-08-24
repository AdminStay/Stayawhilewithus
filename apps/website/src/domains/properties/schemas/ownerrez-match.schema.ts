import { z } from "zod";

/**
 * ownerRezPropertyId is stored as a string on Property (see schema.prisma)
 * even though OwnerRez's own id is numeric — String(orProperty.id) is the
 * stored convention, matched consistently in ownerrez-sync.service.ts.
 */
export const confirmOwnerRezPropertyMatchSchema = z.object({
  propertyId: z.string().uuid(),
  ownerRezPropertyId: z.string().min(1),
});

export type ConfirmOwnerRezPropertyMatchInput = z.infer<
  typeof confirmOwnerRezPropertyMatchSchema
>;
