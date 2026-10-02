/**
 * Human-readable property names for OwnerRez data shown live (dashboard
 * home's OwnerRez card, /ownerrez) instead of OwnerRez's numeric property
 * ids (Meeting #6, 2026-10-02). Matching is only ever by the exact OwnerRez
 * property id — never by name. An id with no known name stays visibly
 * labelled with its number rather than guessed.
 */

export type OwnerRezPropertyNames = Record<string, string>;

/** id → name, from any list of { OwnerRez id, name } pairs; entries without an id are skipped. */
export function ownerRezPropertyNameMap(
  properties: Array<{
    ownerRezPropertyId: string | number | null | undefined;
    name: string;
  }>,
): OwnerRezPropertyNames {
  const names: OwnerRezPropertyNames = {};
  for (const p of properties) {
    if (p.ownerRezPropertyId === null || p.ownerRezPropertyId === undefined) {
      continue;
    }
    const id = String(p.ownerRezPropertyId);
    if (id !== "" && p.name.trim() !== "") names[id] = p.name;
  }
  return names;
}

export function ownerRezPropertyLabel(
  ownerRezPropertyId: string | number,
  names: OwnerRezPropertyNames,
  unknownPrefix = "Unlinked OwnerRez property",
): string {
  return (
    names[String(ownerRezPropertyId)] ??
    `${unknownPrefix} #${ownerRezPropertyId}`
  );
}
