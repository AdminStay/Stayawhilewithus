/**
 * Michelle's 38-property regional structure, transcribed verbatim from
 * HANDOFF.md's "Meeting reference" section. This is a known-subset,
 * human-confirmed reference — NOT proven to cover StayWhile's full
 * OwnerRez portfolio (58 properties, confirmed live 2026-08-26). Any
 * property not explicitly listed here must resolve to "Unknown /
 * Unassigned" — never inferred from address, property name, OwnerRez
 * data, or a nearby mapped property. Do not extend this table without the
 * same explicit, human-confirmed standard already applied to
 * AUGUST_PROPERTY_MAP / CIELO_PROPERTY_MAP.
 */
export const NOTION_REGIONS = [
  "SRQ",
  "Largo",
  "St. Augustine",
  "Panhandle",
  "Destin",
  "SPI (South Padre Island)",
] as const;

export type NotionRegion = (typeof NOTION_REGIONS)[number];

export const UNKNOWN_REGION = "Unknown / Unassigned";

export const REGION_PROPERTY_MAP: Record<NotionRegion, readonly string[]> = {
  SRQ: [
    "Aqua Palm",
    "Bonjour AMI",
    "Camingo",
    "Casa del Mar",
    "Champion Retreat",
    "Coco Vista",
    "Driftwood Cottage",
    "Florisun",
    "Lakeshore",
    "Lucky Charm",
    "Mahalo",
    "Maison de la Mer",
    "Majestic Isla",
    "Moonlit Cove",
    "Moroccan Moon",
    "Once Upon a Pond",
    "Palm Haven",
    "Paradise Awaits",
    "Picasa",
    "Riverside Château",
    "Robinson Recluse",
    "Royal Eden",
    "Royal Palms",
    "The Bahamas",
  ],
  Largo: ["Ocean Pearl"],
  "St. Augustine": ["Magnolia"],
  Panhandle: ["Aloha by the Sea", "Island SOS", "Islafront"],
  Destin: [
    "Bird of Paradise",
    "Casa Blanca",
    "Miramar Bliss",
    "Surfside Solace",
  ],
  "SPI (South Padre Island)": [
    "Las Sirenas",
    "Orion's Landing",
    "Roseate Madre",
    "Sandy Nudes",
  ],
};

/**
 * Exact, literal name variants that refer to a property already listed in
 * REGION_PROPERTY_MAP above — never fuzzy/substring matching. Each entry
 * maps a variant string to the canonical name it stands for.
 *
 * - `BOP` → Bird of Paradise: documented alias (HANDOFF.md, recorded prior
 *   to this implementation).
 * - `BOP (Birds of Paradise)` and `Birds of Paradise` → Bird of Paradise:
 *   observed real Notion display-name variant, recorded in HANDOFF.md
 *   Increment 56 (2026-08-26) per explicit user confirmation, before use
 *   here.
 * - `Miramar Bliss 2` → Miramar Bliss: documented alias (HANDOFF.md,
 *   recorded prior to this implementation).
 *
 * These aliases are matching/search aids only. They never rename or modify
 * any Notion or OwnerRez source record.
 */
export const KNOWN_NAME_VARIANTS: Record<string, string> = {
  BOP: "Bird of Paradise",
  "BOP (Birds of Paradise)": "Bird of Paradise",
  "Birds of Paradise": "Bird of Paradise",
  "Miramar Bliss 2": "Miramar Bliss",
};
