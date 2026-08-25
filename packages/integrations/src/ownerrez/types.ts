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
