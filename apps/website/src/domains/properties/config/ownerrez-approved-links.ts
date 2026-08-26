/**
 * The complete, closed set of OwnerRez <-> StayWhile property links a human
 * has explicitly reviewed and approved for Phase B's one-at-a-time "Confirm
 * Link" write path. This is an allow-list, not a matching rule: plain data,
 * no logic, no DB/HTTP calls. `ownerrez-link.service.ts` treats this array
 * as the sole source of truth for what may ever be linked — a property
 * whose internalCode has no entry here cannot be linked through that
 * service no matter what a request submits.
 *
 * Miramar Bliss (MIRAMAR-BLISS) is deliberately absent: its three OwnerRez
 * candidates (389173 "Miramar Bliss", 410682 "Miramar Bliss II", 480401
 * "Miramar-Bliss") remain genuinely ambiguous (see HANDOFF.md Increment 58)
 * and have not been approved. Adding it here is the only way it could ever
 * become linkable — a deliberate, separate, future code change, never an
 * inferred or default choice.
 *
 * `ownerRezPropertyId` matches the string convention already used on
 * Property.ownerRezPropertyId (OwnerRez's own id is numeric; StayWhile
 * stores it as a string). `ownerRezPropertyName` is a human-reviewed label
 * for confirmation UI and audit context only — it is never compared against
 * anything and plays no role in matching or authorization.
 */
export interface ApprovedOwnerRezLink {
  propertyInternalCode: string;
  ownerRezPropertyId: string;
  ownerRezPropertyName: string;
}

export const APPROVED_OWNERREZ_LINKS: readonly ApprovedOwnerRezLink[] = [
  {
    propertyInternalCode: "AQUA-PALM",
    ownerRezPropertyId: "386471",
    ownerRezPropertyName: "Aqua Palm",
  },
  {
    propertyInternalCode: "BAHAMAS",
    ownerRezPropertyId: "377839",
    ownerRezPropertyName: "The Bahamas",
  },
  {
    propertyInternalCode: "BONJOUR-AMI",
    ownerRezPropertyId: "432997",
    ownerRezPropertyName: "Bonjour AMI",
  },
  {
    propertyInternalCode: "ISLAND-TIDES",
    ownerRezPropertyId: "355021",
    ownerRezPropertyName: "Island Tides",
  },
  {
    propertyInternalCode: "OCEAN-PEARL",
    ownerRezPropertyId: "431354",
    ownerRezPropertyName: "Ocean Pearl",
  },
  {
    propertyInternalCode: "SANDY-NUDES",
    ownerRezPropertyId: "355024",
    ownerRezPropertyName: "Sandy Nudes",
  },
] as const;
