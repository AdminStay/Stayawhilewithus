import type { NotionListingRecord } from "@stayw/integrations/notion";

/**
 * Two independent security concepts, per explicit client direction:
 *   1. VISIBILITY — which fields a given actor may see at all in the
 *      in-dashboard detail view (this file).
 *   2. EDIT — which fields a given actor may change (see
 *      notion-edit-allowlist.ts, a completely separate, currently-empty
 *      list — being visible never implies being editable).
 *
 * "standard" fields are visible to anyone who can already see Notion
 * content today (notion:read — the same reach as the existing Search/
 * Property Listings features already in Production). "sensitive" fields
 * (lockbox codes, access instructions, and similar — none are modeled yet,
 * see below) require the separate notion:manage permission, and default to
 * DENIED until Kenny/Michelle approve exactly which fields qualify and who
 * may see them.
 *
 * Deliberately does NOT yet model any operational field beyond the 10
 * already-proven-safe "View of Listings" columns this app already reads in
 * Production. Michelle's requested examples (lockbox information,
 * internet/router location, service-provider info) are real, but their
 * exact Notion property names/types are unconfirmed — adding an entry here
 * for a field this session has not verified against the live schema would
 * risk silently exposing the wrong thing. Extend this list only once a
 * specific field is confirmed to exist and its sensitivity tier is
 * explicitly approved.
 */
export type NotionFieldSensitivity = "standard" | "sensitive";

export interface NotionVisibilityAllowlistEntry {
  /** Key on NotionListingRecord (or a future confirmed operational field). */
  field: keyof NotionListingRecord;
  sensitivity: NotionFieldSensitivity;
  /** Human label for the detail view — never the raw Notion property name. */
  label: string;
}

/**
 * Every field currently safe to display — exactly the set already exposed
 * by the existing, Production-verified Property Listings feature. Adding a
 * new operational field here is a deliberate, reviewed change, never
 * automatic just because Notion happens to return an extra property.
 */
export const NOTION_VISIBILITY_ALLOWLIST: readonly NotionVisibilityAllowlistEntry[] =
  [
    { field: "name", sensitivity: "standard", label: "Property" },
    { field: "address", sensitivity: "standard", label: "Address" },
    { field: "bedrooms", sensitivity: "standard", label: "Bedrooms" },
    { field: "bathrooms", sensitivity: "standard", label: "Bathrooms" },
    { field: "guests", sensitivity: "standard", label: "Max guests" },
    {
      field: "directBooking",
      sensitivity: "standard",
      label: "Direct booking",
    },
    { field: "airbnbLink", sensitivity: "standard", label: "Airbnb listing" },
    { field: "vrboLink", sensitivity: "standard", label: "VRBO listing" },
    {
      field: "googleDrivePhotosUrl",
      sensitivity: "standard",
      label: "Photos",
    },
    { field: "guidebookUrl", sensitivity: "standard", label: "Guidebook" },
  ] as const;

export interface NotionVisibilityContext {
  /** Whether this actor holds notion:manage — the sensitive-field gate. */
  canSeeSensitiveFields: boolean;
}

export interface NotionVisibleField {
  field: keyof NotionListingRecord;
  label: string;
  value: NotionListingRecord[keyof NotionListingRecord];
}

/**
 * `fields` is the SAFE CLIENT DTO payload — a Partial<NotionListingRecord>
 * containing ONLY the keys this actor is authorized to see. This is the one
 * and only artifact of this function that may ever be spread, serialized,
 * or otherwise passed into a client-bound object; `record` itself (the
 * full, un-filtered NotionListingRecord this function was called with) must
 * never travel any further than this function call. `list` is the same
 * data again, as an ordered {label, value} array, for the generic
 * key/value detail-view rendering — built from the same single filter pass
 * as `fields`, never a second, independently-derived read of `record`, so
 * the two representations can't drift apart on what's actually authorized.
 */
export interface NotionVisibilityResult {
  fields: Partial<NotionListingRecord>;
  list: NotionVisibleField[];
}

/**
 * Server-side filter — the ONLY place a NotionListingRecord's fields are
 * selected for display, and the ONLY place a client-bound Notion listing
 * DTO may be constructed from. A field not returned in `fields`/`list` must
 * never reach the browser at all — not merely be unrendered by a component
 * that received it anyway. Callers must build their client-bound object
 * from this function's return value alone (see
 * integrations.service.ts#buildNotionListingClientDto) and must never
 * spread `record` itself into anything that crosses the server/client
 * boundary. `id`/`url`/`lastEditedTime` are handled separately by the
 * caller (internal identifier vs. "Open in Notion" link vs. conflict
 * metadata) — none of the three is gated by this allowlist, and none is
 * considered sensitive.
 *
 * `allowlist` defaults to the real, live NOTION_VISIBILITY_ALLOWLIST for
 * every real caller — the parameter exists only so tests can inject a
 * temporary fake entry (e.g. a simulated `sensitive` field) to prove the
 * gating logic itself is correct, without needing a real sensitive field to
 * exist in NotionListingRecord first. No production code path ever passes
 * this argument.
 */
export function selectVisibleNotionFields(
  record: NotionListingRecord,
  context: NotionVisibilityContext,
  allowlist: readonly NotionVisibilityAllowlistEntry[] = NOTION_VISIBILITY_ALLOWLIST,
): NotionVisibilityResult {
  const fields: Partial<NotionListingRecord> = {};
  const list: NotionVisibleField[] = [];

  for (const entry of allowlist) {
    if (entry.sensitivity !== "standard" && !context.canSeeSensitiveFields) {
      continue;
    }
    const value = record[entry.field];
    // Safe by construction, not by cast-and-hope: `entry.field` and `value`
    // both came from the SAME `record[entry.field]` read on the line above,
    // so they're always a matching key/value pair — TS just can't prove
    // that across a dynamic keyof union without this assertion.
    (fields as Record<keyof NotionListingRecord, unknown>)[entry.field] = value;
    list.push({ field: entry.field, label: entry.label, value });
  }

  return { fields, list };
}
