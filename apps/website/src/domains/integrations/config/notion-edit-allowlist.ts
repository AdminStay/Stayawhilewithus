import type {
  NotionEditableFieldType,
  NotionListingRecord,
} from "@stayw/integrations/notion";

import type { NotionVisibleField } from "./notion-field-visibility";

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

/** A visible field, annotated with whether an edit control should render for it, and (only when it should) what kind of control. */
export interface NotionEditableField extends NotionVisibleField {
  editable: boolean;
  edit?: { fieldType: NotionEditableFieldType; options?: readonly string[] };
}

/**
 * Combines an already-computed visibility result with the edit allowlist
 * and the actor's `notion:update` permission to decide, per field, whether
 * an edit control should render at all.
 *
 * This is a UX/rendering decision only — NOT the security boundary.
 * `updateNotionField()` (notion-edit.service.ts) independently re-checks
 * both `notion:update` and the allowlist itself, unconditionally, no
 * matter what this function — or a tampered client — claims. A field this
 * function marks `editable: true` still cannot actually be written unless
 * the server-side check agrees.
 *
 * With `NOTION_EDIT_ALLOWLIST` empty (today), every field's `editable` is
 * `false` regardless of `canEdit`, so nothing in the dashboard renders an
 * edit control — 100% read-only, exactly like before this function existed.
 *
 * `allowlist` defaults to the real, live NOTION_EDIT_ALLOWLIST for every
 * real caller — the parameter exists only so tests can inject a temporary
 * fake entry, same convention as selectVisibleNotionFields() in
 * notion-field-visibility.ts. No production code path ever passes it.
 */
export function annotateNotionFieldEditability(
  fields: readonly NotionVisibleField[],
  dataSourceId: string,
  canEdit: boolean,
  allowlist: readonly NotionEditAllowlistEntry[] = NOTION_EDIT_ALLOWLIST,
): NotionEditableField[] {
  return fields.map((field) => {
    if (!canEdit) return { ...field, editable: false };
    const entry =
      allowlist.find(
        (e) => e.dataSourceId === dataSourceId && e.field === field.field,
      ) ?? null;
    if (!entry) return { ...field, editable: false };
    return {
      ...field,
      editable: true,
      edit: { fieldType: entry.fieldType, options: entry.options },
    };
  });
}
