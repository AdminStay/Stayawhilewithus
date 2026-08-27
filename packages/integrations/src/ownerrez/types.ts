// OwnerRez v2 API credentials. The API uses HTTP Basic Auth: the account
// username as the Basic Auth user, and an API token (generated in OwnerRez's
// UI under Settings > API) as the password — not a bearer token.
export interface OwnerrezCredentials {
  username: string;
  token: string;
}

// Shapes below follow OwnerRez v2's documented REST resources
// (https://api.ownerreservations.com/v2). Only the fields StayWhile
// currently reads are modeled — extend as real usage demands more.
export interface OwnerrezProperty {
  id: number;
  name: string;
  key: string;
  // Confirmed 2026-08-21 against real Production data: OwnerRez's actual
  // field is `active`, not `is_active` (the latter was an unverified
  // assumption that silently deserialized to `undefined` on every real
  // property). Matches OwnerRez's own `active` query filter on this same
  // endpoint and its `active` field on the sibling `listing_sites` resource.
  active: boolean;
  // A second stable matching key, confirmed present on real /properties
  // list responses. Used only for read-only match-report bucketing
  // (property_ids -> StayWhile internalCode) — never for a name-based
  // guess, and never written back to OwnerRez.
  internal_code?: string;
}

// GET /properties/{id} (the single-property detail endpoint) returns a much
// richer PropertyViewModel than the list endpoint above. Field names
// confirmed 2026-08-28 against OwnerRez's own live API documentation
// (https://api.ownerreservations.com/help/v2/properties/get-properties-id)
// — not guessed, per this file's own established discipline (`active` vs
// `is_active`, `next_page_url` vs `next_page` were both previously wrong
// guesses caught only by checking real docs/data). Every field here is
// optional: this type only documents what the endpoint can return, not a
// guarantee any specific property has all of them populated — a caller
// creating a StayWhile Property from this data must check for missing
// required fields itself, never assume presence.
export interface OwnerrezPropertyAddress {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface OwnerrezPropertyDetail extends OwnerrezProperty {
  address?: OwnerrezPropertyAddress;
  latitude?: number;
  longitude?: number;
  time_zone?: string;
  property_type?: string;
  bedrooms?: number;
  bathrooms_full?: number;
  bathrooms_half?: number;
  max_guests?: number;
}

export interface OwnerrezBooking {
  id: number;
  property_id: number;
  guest_id: number;
  status: string;
  arrival: string;
  departure: string;
  guests_adults: number;
  guests_children: number;
  guests_pets: number;
  total_amount: number;
  created_utc: string;
  updated_utc: string;
}

export interface OwnerrezGuest {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
}

export interface OwnerrezPage<T> {
  items: T[];
  // Confirmed 2026-08-26 against OwnerRez's live OpenAPI spec and real
  // Production responses: the real field is `next_page_url`, not `next_page`
  // (the previous name here). Under the old name, pagination could never
  // actually be followed — the real field was silently ignored on every
  // call. A null value means there are no more pages.
  next_page_url?: string | null;
  // Present on /properties responses (PageableListOfPropertyViewModel):
  // total records in the FULL collection, not just this page. Not present
  // on /bookings responses.
  count?: number;
  // Server-controlled page size — OwnerRez does not document a request
  // param to change this on either /properties or /bookings.
  limit?: number;
  offset?: number;
}
