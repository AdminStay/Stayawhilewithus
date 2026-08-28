import { z } from "zod";

/**
 * The only inputs this action ever accepts: which OwnerRez property to
 * create from, and an optional admin-selected timezone. Every actual
 * Property field (name, address, bedroomCount, etc.) is derived
 * server-side from a fresh OwnerrezClient.getProperty() call in
 * createPropertyFromOwnerRez(), never trusted from a form value — so there
 * is no field here to tamper with beyond picking a different (still real)
 * OwnerRez id.
 *
 * `timezoneOverride` is deliberately a loose, non-empty string here (not
 * the curated enum) — the curated-allowlist check happens inside
 * createPropertyFromOwnerRez() itself, where a rejection can carry a clear,
 * human-authored message naming the exact allowed zones, rather than a raw
 * Zod enum-mismatch dump reaching the UI. It is used only as a fallback
 * when OwnerRez's own `time_zone` is missing — never to override a real
 * OwnerRez value.
 */
export const createPropertyFromOwnerRezSchema = z.object({
  ownerRezPropertyId: z.string().min(1),
  timezoneOverride: z.string().min(1).optional(),
});

export type CreatePropertyFromOwnerRezInput = z.infer<
  typeof createPropertyFromOwnerRezSchema
>;
