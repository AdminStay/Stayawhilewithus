/**
 * Full stored address for display on /properties (2026-10-20).
 *
 * Display only: formats the address fields already stored on the StayWhile
 * Property — no OwnerRez lookup, no write. Values are trimmed but otherwise
 * shown exactly as stored: no state-name or ZIP/ZIP+4 normalization, and no
 * placeholder is ever invented for a blank field — blanks are reported in
 * `missing` instead.
 */

export type StoredPropertyAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type AddressPart = "street" | "city" | "state" | "postalCode";

export const ADDRESS_PART_LABEL: Record<AddressPart, string> = {
  street: "street",
  city: "city",
  state: "state",
  postalCode: "postal code",
};

export type FormattedPropertyAddress = {
  /** Non-empty lines to render, in order; empty when nothing is stored. */
  lines: string[];
  /** Required parts that are blank. Address line 2 is optional, never listed. */
  missing: AddressPart[];
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatStoredPropertyAddress(
  address: StoredPropertyAddress,
): FormattedPropertyAddress {
  const street = clean(address.addressLine1);
  const line2 = clean(address.addressLine2);
  const city = clean(address.city);
  const state = clean(address.state);
  const postalCode = clean(address.postalCode);

  // "City, ST 12345" built only from the parts that exist, so a blank part
  // never leaves a stray comma or space.
  const statePostal = [state, postalCode].filter(Boolean).join(" ");
  const locality = [city, statePostal || null].filter(Boolean).join(", ");

  const lines = [street, line2, locality || null].filter(
    (line): line is string => line !== null,
  );

  const missing: AddressPart[] = [];
  if (!street) missing.push("street");
  if (!city) missing.push("city");
  if (!state) missing.push("state");
  if (!postalCode) missing.push("postalCode");

  return { lines, missing };
}
