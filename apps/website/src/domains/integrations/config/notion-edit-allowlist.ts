import type {
  NotionEditableFieldType,
  NotionListingRecord,
} from "@stayw/integrations/notion";

/**
 * The dashboard-edit allowlist — completely separate from the visibility
 * allowlist (notion-field-visibility.ts). A field being visible never
 * implies it's editable; this list governs writes only.
 *
 * DELIBERATELY EMPTY. Kenny/Michelle have not yet confirmed which Notion
 * databases/pages, which exact fields, or which roles may edit anything.
 * `updateNotionField()` (notion-edit.service.ts) checks every write
 * request against exactly this array — an empty array means every write
 * request is rejected before any Notion API call is made, regardless of
 * the requested field or the actor's role. This is the fail-closed
 * behavior the client explicitly required: do not populate this array
 * without an explicit, reviewed, client-approved change, and never with a
 * wildcard/"all fields" entry.
 */
export interface NotionEditAllowlistEntry {
  /** Which Notion data source (e.g. "View of Listings") this entry applies to. */
  dataSourceId: string;
  /** Key on NotionListingRecord — the same closed field set the visibility allowlist uses. */
  field: keyof NotionListingRecord;
  fieldType: NotionEditableFieldType;
  label: string;
  /** Static option set for "select"/"multi_select" fields — required for those types, absent for all others. */
  options?: readonly string[];
}

export const NOTION_EDIT_ALLOWLIST: readonly NotionEditAllowlistEntry[] = [];

export function findEditAllowlistEntry(
  dataSourceId: string,
  field: string,
): NotionEditAllowlistEntry | null {
  return (
    NOTION_EDIT_ALLOWLIST.find(
      (entry) => entry.dataSourceId === dataSourceId && entry.field === field,
    ) ?? null
  );
}
