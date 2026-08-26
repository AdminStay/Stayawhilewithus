import { z } from "zod";

/**
 * Input shape only — deliberately does not validate that the pairing is
 * approved (that requires a DB read, which a zod schema can't do). Approval
 * is enforced entirely in ownerrez-link.service.ts against
 * APPROVED_OWNERREZ_LINKS, keyed off the property's own DB-loaded
 * internalCode, never off anything in this input.
 */
export const confirmOwnerRezLinkSchema = z.object({
  propertyId: z.string().uuid(),
  ownerRezPropertyId: z.string().min(1),
});

export type ConfirmOwnerRezLinkInput = z.infer<
  typeof confirmOwnerRezLinkSchema
>;
