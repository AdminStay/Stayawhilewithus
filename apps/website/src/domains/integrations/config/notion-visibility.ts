/**
 * Per-page Notion visibility (2026-09-30, Meeting #5: read-only dashboard;
 * lockbox and owner information must not be broadly visible).
 *
 * Two levels only:
 *   - "standard"  → requires `notion:read`
 *   - "sensitive" → requires `notion:manage`
 *
 * A page's level comes from the approved root it lives under, resolved by
 * real Notion ids (never by title):
 *   - a LIBRARY row → that row's entry below; a row NOT listed here (a new
 *     or unknown entry) is sensitive until someone classifies it;
 *   - the SOPs root page and everything under it → standard;
 *   - a "View of Listings" row → standard (its own field-level
 *     standard/sensitive split still applies — notion-field-visibility.ts);
 *   - anything else the integration can see, or anything that can't be
 *     resolved → sensitive (fail closed).
 * An id in NOTION_SENSITIVE_PAGE_IDS is sensitive wherever it sits, and so
 * is everything beneath it.
 *
 * Classification only ever narrows access: nothing here grants a permission.
 */

export type NotionVisibility = "standard" | "sensitive";

/** The LIBRARY database id (its rows report this as their parent; the data source id is in notion-library.ts). */
export const NOTION_LIBRARY_DATABASE_ID =
  "e54961ca-c27c-4bbd-b4b3-a766d9b0dd64";

export interface NotionLibraryEntryVisibility {
  id: string;
  /** For humans reviewing this file only — matching is by id. */
  title: string;
  visibility: NotionVisibility;
}

/**
 * Every LIBRARY row that existed on 2026-09-30 (read-only listing). Sensitive
 * by default: Property Lockboxes Code and Owner Info (client instruction),
 * Owner's info for trash service (owner information), and the untitled row
 * (content unknown). Everything else keeps today's access (standard).
 * Changing any entry is a client decision.
 */
export const NOTION_LIBRARY_ENTRY_VISIBILITY: readonly NotionLibraryEntryVisibility[] =
  [
    {
      id: "3cd6058d-b989-80a9-a698-e8f525cab118",
      title: "(untitled)",
      visibility: "sensitive",
    },
    {
      id: "3a46058d-b989-80c5-a18e-e448f1edb1e7",
      title:
        "Software Directory - Thermostat, Lock and Camera, Noise Detection & Security Alarm and Garage (1)",
      visibility: "standard",
    },
    {
      id: "39e6058d-b989-80da-bc71-cd86625bca84",
      title: "Garage Per Property",
      visibility: "standard",
    },
    {
      id: "3936058d-b989-8005-98d7-ecd639302c28",
      title: "Training Manuals - New Hire Onboarding",
      visibility: "standard",
    },
    {
      id: "3786058d-b989-8040-950b-eb3d7f656f89",
      title: "Cynch Propane Account",
      visibility: "standard",
    },
    {
      id: "2b46058d-b989-80c4-a1d6-e746e4108a0f",
      title: "SOP",
      visibility: "standard",
    },
    {
      id: "26b6058d-b989-80a3-ba3a-c8825044c843",
      title: "Message Templates",
      visibility: "standard",
    },
    {
      id: "24f6058d-b989-80c6-959e-dcb319dabb42",
      title: "Service Pet Policy",
      visibility: "standard",
    },
    {
      id: "2306058d-b989-80cd-b43d-ece6cef76194",
      title: "SRQ Storage Unit",
      visibility: "standard",
    },
    {
      id: "1ed6058d-b989-806f-878b-c7ce246fd55b",
      title: "US Federal Holidays 2026",
      visibility: "standard",
    },
    {
      id: "44e93f90-6832-4382-aedb-4326b96250c3",
      title: "Pack N Play and Highchair",
      visibility: "standard",
    },
    {
      id: "10892c13-2b4e-4704-91a3-8b44f31ae13e",
      title: "QC Checklist",
      visibility: "standard",
    },
    {
      id: "a5bc71eb-5bdc-4863-8041-2827f52bb5db",
      title: "General FAQs",
      visibility: "standard",
    },
    {
      id: "18efaa2b-5ba9-4150-bd1d-028391c6d631",
      title: "OwnerRez Support Links",
      visibility: "standard",
    },
    {
      id: "5a8f6661-9641-4835-a541-db6b04c44374",
      title: "Owner Info",
      visibility: "sensitive",
    },
    {
      id: "a13891a9-4dc2-425c-8be0-3f9fb86587db",
      title: "Owner's info for trash service",
      visibility: "sensitive",
    },
    {
      id: "62b86a73-b7aa-4b35-80e3-5587b64b1f09",
      title: "Internet Connection",
      visibility: "standard",
    },
    {
      id: "11c01fc7-2267-491f-b282-64cd6fd03f25",
      title: "Cleaning Guidelines",
      visibility: "standard",
    },
    {
      id: "703f61c6-8065-42d8-87e1-82c47651eba1",
      title: "Trash Schedule",
      visibility: "standard",
    },
    {
      id: "5ce030b2-07b4-466b-85bf-b8aa37d3793c",
      title: "Lawn Care Schedule",
      visibility: "standard",
    },
    {
      id: "29019e39-0234-40e7-8d2f-a1129f508bb9",
      title: "HomeTech Warranty",
      visibility: "standard",
    },
    {
      id: "93fc2ac5-655d-4b52-9d9f-a47bda5f664d",
      title: "Recycling do’s and don’ts",
      visibility: "standard",
    },
    {
      id: "80fd97be-2a38-46e4-9754-0993aee6ac76",
      title: "Airbnb Age Requirements",
      visibility: "standard",
    },
    {
      id: "a05ae1c8-d877-424e-be25-602407881039",
      title: "TV Channels/Streaming Apps",
      visibility: "standard",
    },
    {
      id: "33d23c2e-5195-4d47-9ca3-6b9e68f94573",
      title: "Beach Access for each Property",
      visibility: "standard",
    },
    {
      id: "bcb8c42e-1bb1-4505-9f1e-9d581b87703b",
      title: "WIFI issues",
      visibility: "standard",
    },
    {
      id: "e8135770-45a8-4c44-b629-aacb4da0c07c",
      title: "KIDS Amenities",
      visibility: "standard",
    },
    {
      id: "7c06a053-cec7-47ea-ad15-ca6e819df34a",
      title: "Youtube Channel/ Videos",
      visibility: "standard",
    },
    {
      id: "7dae2e36-61ef-43d6-90e7-10c920f63d40",
      title: "Beach Gear/LOCATIONS",
      visibility: "standard",
    },
    {
      id: "80288254-9975-4f3f-99fa-e9f58f87770a",
      title: "Pool Cleaning Schedule",
      visibility: "standard",
    },
    {
      id: "b3bb913f-4b06-44bf-b87c-a692c00f4790",
      title: "Property Directory",
      visibility: "standard",
    },
    {
      id: "598204db-fcb1-49cd-8ab4-782846a44de5",
      title: "Service Providers List",
      visibility: "standard",
    },
    {
      id: "1f763623-7030-44d5-93e4-7ac0fce105aa",
      title: "Property Links per Booking Platform",
      visibility: "standard",
    },
    {
      id: "7cb0f158-800c-4b00-a1b3-b87c09aca016",
      title: "Vetting Guest",
      visibility: "standard",
    },
    {
      id: "e467f821-625a-4d08-83af-4ce25fa30dbd",
      title: "Cancellation Policy per Booking Platform",
      visibility: "standard",
    },
    {
      id: "455a3584-4d97-489d-8f8e-64d721bbc340",
      title: "Hot Tub/Pool Rules/ Schedule/ Fee",
      visibility: "standard",
    },
    {
      id: "a2d028ba-3af8-4b55-a4bd-e9254ae618f6",
      title: "Sending SP’s on Occuppied Properties",
      visibility: "standard",
    },
    {
      id: "ecccd45d-b3f1-4241-b050-333eca3c42d1",
      title: "Property Lockboxes Code",
      visibility: "sensitive",
    },
  ];

/**
 * Pages (anywhere) that are sensitive together with everything beneath
 * them, by real id. Empty today. The "Router and Thermostat Location" pages
 * under Property Directory stay standard (today's access) until Kenny/
 * Michelle say whether they hold Wi-Fi passwords; adding their ids here is
 * the one-line change if so.
 */
export const NOTION_SENSITIVE_PAGE_IDS: readonly string[] = [];

const normalize = (id: string) => id.replace(/-/g, "").toLowerCase();

const LIBRARY_ENTRY_BY_ID = new Map(
  NOTION_LIBRARY_ENTRY_VISIBILITY.map((e) => [normalize(e.id), e.visibility]),
);
const SENSITIVE_PAGE_IDS = new Set(NOTION_SENSITIVE_PAGE_IDS.map(normalize));

/** A LIBRARY row's level; unknown/new rows are sensitive. */
export function libraryEntryVisibility(entryId: string): NotionVisibility {
  return LIBRARY_ENTRY_BY_ID.get(normalize(entryId)) ?? "sensitive";
}

export function isKnownLibraryEntry(id: string): boolean {
  return LIBRARY_ENTRY_BY_ID.has(normalize(id));
}

export function isForcedSensitivePage(id: string): boolean {
  return SENSITIVE_PAGE_IDS.has(normalize(id));
}

export function sameNotionId(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}
