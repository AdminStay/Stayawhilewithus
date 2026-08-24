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
  // Everything below is confirmed 2026-08-20 against a real live
  // GET /v2/properties response (see HANDOFF.md Increment 37) — not
  // guessed from OwnerRez's docs. Only present on `listProperties()`
  // results and `getProperty()`'s detail response; `internal_code` is a
  // second stable matching key alongside `id`/`key`. No `amenities` field
  // exists on this endpoint.
  external_name?: string;
  internal_code?: string;
  is_snoozed?: boolean;
  address?: {
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };
  property_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  bathrooms_full?: number;
  bathrooms_half?: number;
  max_guests?: number;
  max_adults?: number;
  max_children?: number;
  max_pets?: number;
  check_in?: string;
  check_out?: string;
  currency_code?: string;
  latitude?: number;
  longitude?: number;
  owner_id?: number;
  public_url?: string;
  thumbnail_url?: string;
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
  next_page?: string | null;
}
