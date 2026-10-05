import type { CleaningFormState } from "../actions";

/**
 * Plain data shapes for the cleaner parts of /cleaning (Cleaner Phase 4).
 * ids + names only — no phone number is ever passed to these components.
 */
export interface CleanerOption {
  id: string;
  name: string;
}

export interface PropertyCleaners {
  primary: CleanerOption | null;
  teamMembers: CleanerOption[];
}

/**
 * A cleaning server action, passed down from the Server Component page as
 * a prop rather than imported by the client component — same reason as
 * cleaners/components/types.ts.
 */
export type CleaningAction = (
  prevState: CleaningFormState,
  formData: FormData,
) => Promise<CleaningFormState>;

export const INITIAL_CLEANING_FORM_STATE: CleaningFormState = {
  status: "idle",
};

/** A property with team members but no PRIMARY (e.g. Sandy Nudes today). */
export function isTeamOnly(property: PropertyCleaners | undefined): boolean {
  return (
    property !== undefined &&
    property.primary === null &&
    property.teamMembers.length > 0
  );
}

export interface CleanerOptionGroup {
  label: string;
  options: Array<CleanerOption & { label: string }>;
}

/**
 * Picker groups for one property: its current primary / team members first
 * (labelled), then every other ACTIVE cleaner. Only ACTIVE cleaners are
 * offered; a primary or team member who isn't in `activeCleaners` is left
 * out. Nothing is pre-selected here — callers choose the value.
 */
export function cleanerOptionGroups(
  property: PropertyCleaners | undefined,
  activeCleaners: CleanerOption[],
): CleanerOptionGroup[] {
  const activeIds = new Set(activeCleaners.map((c) => c.id));
  const atProperty: CleanerOptionGroup["options"] = [];
  if (property?.primary && activeIds.has(property.primary.id)) {
    atProperty.push({
      ...property.primary,
      label: `${property.primary.name} (primary)`,
    });
  }
  for (const member of property?.teamMembers ?? []) {
    if (activeIds.has(member.id)) {
      atProperty.push({ ...member, label: `${member.name} (team)` });
    }
  }
  const atPropertyIds = new Set(atProperty.map((c) => c.id));
  const others = activeCleaners
    .filter((c) => !atPropertyIds.has(c.id))
    .map((c) => ({ ...c, label: c.name }));

  return [
    ...(atProperty.length > 0
      ? [{ label: "At this property", options: atProperty }]
      : []),
    ...(others.length > 0
      ? [{ label: "Other active cleaners", options: others }]
      : []),
  ];
}
