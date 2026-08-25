import {
  KNOWN_NAME_VARIANTS,
  REGION_PROPERTY_MAP,
  UNKNOWN_REGION,
  type NotionRegion,
} from "../config/notion-region-reference";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Built once at module load: every canonical property name and every known
// variant, normalized, mapped to its region. Exact-match lookup only — no
// substring/fuzzy matching, so a listing is never assigned a region by
// resemblance.
const NORMALIZED_NAME_TO_REGION = new Map<string, NotionRegion>();

for (const [region, properties] of Object.entries(REGION_PROPERTY_MAP) as [
  NotionRegion,
  readonly string[],
][]) {
  for (const property of properties) {
    NORMALIZED_NAME_TO_REGION.set(normalize(property), region);
  }
}

for (const [variant, canonicalName] of Object.entries(KNOWN_NAME_VARIANTS)) {
  const region = NORMALIZED_NAME_TO_REGION.get(normalize(canonicalName));
  if (region) {
    NORMALIZED_NAME_TO_REGION.set(normalize(variant), region);
  }
}

/**
 * Resolves a Notion listing's `name` to a region using only the confirmed
 * 38-property reference table and its documented/observed exact-name
 * variants (see notion-region-reference.ts) — never inferred from address,
 * property name similarity, OwnerRez data, or a nearby mapped property.
 * Anything not an exact (case/whitespace-normalized) match returns
 * "Unknown / Unassigned".
 */
export function resolveRegion(name: string): string {
  return NORMALIZED_NAME_TO_REGION.get(normalize(name)) ?? UNKNOWN_REGION;
}
