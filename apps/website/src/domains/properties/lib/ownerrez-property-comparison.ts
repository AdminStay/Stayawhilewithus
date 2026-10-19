/**
 * OwnerRez-versus-StayWhile property comparison (2026-10-16). Pure and
 * display-only: describes how a linked StayWhile Property's stored values
 * compare with OwnerRez's own property detail. It never decides what to do
 * about a difference — there is no "apply", "clear" or "update" outcome
 * anywhere in this module, and a value missing from OwnerRez is reported as
 * "Missing in OwnerRez" (StayWhile keeps its value), never as an instruction.
 *
 * OwnerRez values are derived exactly the way createPropertyFromOwnerRez()
 * (ownerrez-onboarding.service.ts) derives them when creating a property —
 * address.street1 → addressLine1, bathrooms_full + bathrooms_half × 0.5 →
 * bathroomCount, max_guests → maxOccupancy, time_zone used as-is — so the
 * comparison and creation always agree on what "OwnerRez's value" means.
 *
 * No normalization beyond trimming and letter case/spacing: "FL" vs
 * "Florida" and "34209" vs "34209-1234" are reported as Differs, never
 * matched up automatically.
 */
import type { OwnerrezPropertyDetail } from "@stayw/integrations/ownerrez";

export type ComparisonStatus =
  | "match"
  | "formatting_only"
  | "differs"
  | "missing_in_ownerrez"
  | "missing_in_staywhile"
  | "ownerrez_unavailable";

export const COMPARISON_STATUS_LABEL: Record<ComparisonStatus, string> = {
  match: "Match",
  formatting_only: "Formatting only",
  differs: "Differs",
  missing_in_ownerrez: "Missing in OwnerRez",
  missing_in_staywhile: "Missing in StayWhile",
  ownerrez_unavailable: "OwnerRez data unavailable",
};

export const COMPARISON_STATUSES = Object.keys(
  COMPARISON_STATUS_LABEL,
) as ComparisonStatus[];

export type ComparedField =
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "bedrooms"
  | "bathrooms"
  | "maxGuests"
  | "timezone";

export const COMPARED_FIELD_LABEL: Record<ComparedField, string> = {
  addressLine1: "Street address (line 1)",
  addressLine2: "Street address (line 2)",
  city: "City",
  state: "State",
  postalCode: "Postcode",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  maxGuests: "Maximum guests",
  timezone: "Timezone",
};

/** The StayWhile side: exactly the stored columns being compared. */
export interface StayWhileComparableValues {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  bedroomCount: number | null;
  bathroomCount: number | null;
  maxOccupancy: number | null;
  timezone: string | null;
}

export interface FieldComparison {
  field: ComparedField;
  label: string;
  /** Display strings, exactly as stored (null = empty). */
  stayWhile: string | null;
  ownerRez: string | null;
  status: ComparisonStatus;
}

type Value = string | number | null | undefined;

function isEmpty(value: Value): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return value.trim() === "";
}

function display(value: Value): string | null {
  if (isEmpty(value)) return null;
  return typeof value === "number" ? String(value) : value!.trim();
}

/** Case- and spacing-insensitive form, for "Formatting only" only. */
function loose(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function compareValues(stayWhile: Value, ownerRez: Value): ComparisonStatus {
  const swEmpty = isEmpty(stayWhile);
  const orEmpty = isEmpty(ownerRez);
  // Both sides empty (e.g. no address line 2 anywhere): they agree.
  if (swEmpty && orEmpty) return "match";
  if (orEmpty) return "missing_in_ownerrez";
  if (swEmpty) return "missing_in_staywhile";
  if (typeof stayWhile === "number" || typeof ownerRez === "number") {
    return Number(stayWhile) === Number(ownerRez) ? "match" : "differs";
  }
  const sw = stayWhile as string;
  const or = ownerRez as string;
  if (sw.trim() === or.trim()) return "match";
  if (loose(sw) === loose(or)) return "formatting_only";
  return "differs";
}

/** OwnerRez's values, mapped the same way createPropertyFromOwnerRez() maps them. */
export function ownerRezComparableValues(
  detail: OwnerrezPropertyDetail,
): Record<ComparedField, Value> {
  const hasBathrooms =
    detail.bathrooms_full != null || detail.bathrooms_half != null;
  return {
    addressLine1: detail.address?.street1,
    addressLine2: detail.address?.street2,
    city: detail.address?.city,
    state: detail.address?.state,
    postalCode: detail.address?.postal_code,
    bedrooms: detail.bedrooms,
    bathrooms: hasBathrooms
      ? (detail.bathrooms_full ?? 0) + (detail.bathrooms_half ?? 0) * 0.5
      : null,
    maxGuests: detail.max_guests,
    timezone: detail.time_zone,
  };
}

function stayWhileFieldValues(
  values: StayWhileComparableValues,
): Record<ComparedField, Value> {
  return {
    addressLine1: values.addressLine1,
    addressLine2: values.addressLine2,
    city: values.city,
    state: values.state,
    postalCode: values.postalCode,
    bedrooms: values.bedroomCount,
    bathrooms: values.bathroomCount,
    maxGuests: values.maxOccupancy,
    timezone: values.timezone,
  };
}

/**
 * One row per compared field. `detail` null means OwnerRez's data couldn't
 * be fetched for this property: every field is then "OwnerRez data
 * unavailable", with StayWhile's value still shown.
 */
export function compareOwnerRezProperty(
  stayWhile: StayWhileComparableValues,
  detail: OwnerrezPropertyDetail | null,
): FieldComparison[] {
  const sw = stayWhileFieldValues(stayWhile);
  const or = detail ? ownerRezComparableValues(detail) : null;
  return (Object.keys(COMPARED_FIELD_LABEL) as ComparedField[]).map(
    (field) => ({
      field,
      label: COMPARED_FIELD_LABEL[field],
      stayWhile: display(sw[field]),
      ownerRez: or ? display(or[field]) : null,
      status: or ? compareValues(sw[field], or[field]) : "ownerrez_unavailable",
    }),
  );
}

/**
 * Why OwnerRez's detail isn't available for a row. Deliberately a fixed
 * set — the raw error (which can carry request details) is never passed
 * through to the page or a log.
 */
export type OwnerRezUnavailableReason =
  "invalid_link_id" | "not_found" | "rate_limited" | "request_failed";

export const OWNERREZ_UNAVAILABLE_REASON_LABEL: Record<
  OwnerRezUnavailableReason,
  string
> = {
  invalid_link_id:
    "The stored OwnerRez id isn't a valid OwnerRez property number — nothing was requested.",
  not_found: "OwnerRez returned no property for this id.",
  rate_limited:
    "Stopped by the OwnerRez request limit before this property was read. Try again in a few minutes.",
  request_failed: "The OwnerRez request failed.",
};

export interface OwnerRezPropertyComparisonRow {
  property: {
    id: string;
    name: string;
    internalCode: string;
    status: string;
    ownerRezPropertyId: string;
  };
  /** OwnerRez's own name for the property, when its detail was read. */
  ownerRezName: string | null;
  unavailableReason: OwnerRezUnavailableReason | null;
  fields: FieldComparison[];
  counts: Record<ComparisonStatus, number>;
}

/** Counts per status, every status present (0 when none). */
export function countComparisonStatuses(
  fields: readonly FieldComparison[],
): Record<ComparisonStatus, number> {
  const counts = Object.fromEntries(
    COMPARISON_STATUSES.map((s) => [s, 0]),
  ) as Record<ComparisonStatus, number>;
  for (const f of fields) counts[f.status] += 1;
  return counts;
}
