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
  is_active: boolean;
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
