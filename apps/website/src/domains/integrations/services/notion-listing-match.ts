import type { NotionListingRecord } from "@stayw/integrations/notion";

/**
 * Mirrors ../components/notion-link.utils.ts's isSafeHttpUrl() check —
 * duplicated rather than imported, since this domain's established layering
 * is components -> services, never the reverse (see e.g.
 * apps/website/src/domains/ai/components importing from ../services).
 */
function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A single free-text query matches a "View of Listings" row the same way
 * the existing Listings section's combined keyword filter already does (see
 * NotionListingsSearch.tsx's `keywordFields` logic) — name, address, and
 * non-URL direct-booking text, case/whitespace-insensitive substring match,
 * no fuzzy matching. Kept as one shared, tested function so the live
 * unified search (searchNotionContent) and the existing Listings table
 * filter can never silently drift apart on what counts as a match.
 *
 * Accepts a `Partial` on the client side (NotionListingsSearch.tsx passes
 * the safe, visibility-filtered `fields` object, where an unauthorized key
 * is simply absent, not present-but-null) and the full server-side record
 * (searchNotionContent, pre-filtering) equally — every field is already
 * handled as possibly-missing below.
 */
export function matchesListingQuery(
  listing: Partial<
    Pick<NotionListingRecord, "name" | "address" | "directBooking">
  >,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return false;

  const fields = [
    listing.name,
    listing.address,
    isSafeHttpUrl(listing.directBooking) ? null : listing.directBooking,
  ].filter((value): value is string => Boolean(value));

  return fields.some((field) => field.toLowerCase().includes(query));
}
