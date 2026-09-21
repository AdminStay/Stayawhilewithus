import type { NotionEditableFieldType } from "@stayw/integrations/notion";
import type { ReactNode } from "react";

import type { NotionEditableField } from "../config/notion-edit-allowlist";
import type { NotionVisibleField } from "../config/notion-field-visibility";

/**
 * buildNotionDetailSections() accepts either a plain NotionVisibleField
 * (editable/edit absent, e.g. every existing test fixture — renders
 * plain/read-only) or an already-annotated NotionEditableField (the real
 * caller, NotionListingsSearch.tsx) — never requires every caller to know
 * about editability just to build a detail view.
 */
type NotionDetailInputField = NotionVisibleField &
  Partial<Pick<NotionEditableField, "editable" | "edit">>;

/**
 * The presentational shape NotionDetailView actually renders — deliberately
 * NOT tied to NotionListingRecord's keys, so the same dialog can render a
 * grouped listing (built by buildNotionDetailSections below) or a single
 * generic field (e.g. NotionSearch's "Preview" snippet, which isn't a real
 * Notion listing property at all — `editable`/`edit`/`rawValue` are always
 * absent there, so it renders exactly as before: plain, read-only).
 *
 * `editable`/`edit`/`rawValue` are optional and only ever set by
 * buildNotionDetailSections() below, from an already-computed
 * NotionEditableField — never invented here. `rawValue` is the actual value
 * an edit control needs to start from (a string/number/boolean/string[]),
 * kept separate from `value` (a ReactNode) since a future caller could
 * render `value` as something other than the raw value itself.
 */
export interface NotionDetailField {
  key: string;
  label: string;
  value: ReactNode;
  editable?: boolean;
  edit?: { fieldType: NotionEditableFieldType; options?: readonly string[] };
  rawValue?: string | number | boolean | readonly string[] | null;
}

export type NotionDetailSectionLayout = "grid" | "actions" | "list";

export interface NotionDetailSection {
  title?: string;
  layout: NotionDetailSectionLayout;
  fields: NotionDetailField[];
}

const OVERVIEW_FIELDS = new Set(["bedrooms", "bathrooms", "guests"]);
const RESOURCE_FIELDS = new Set([
  "directBooking",
  "airbnbLink",
  "vrboLink",
  "googleDrivePhotosUrl",
  "guidebookUrl",
]);
// name/address are rendered in the detail view's header (title/subtitle),
// by the caller, from the same already-visibility-filtered `fields` object
// — never repeated here as a body section.
const HEADER_FIELDS = new Set(["name", "address"]);

/**
 * Groups an already-visibility-filtered listing's fields into the sections
 * NotionDetailView renders: a compact "Property overview" stat grid
 * (bedrooms/bathrooms/guests), a "Booking & resources" action list (every
 * link/contact field, rendered as an "Open" action rather than a raw URL —
 * see NotionDetailView), and a plain-list fallback for anything not yet
 * mapped to either bucket. That fallback is deliberate: a future
 * Kenny/Michelle-approved field (standard or sensitive) still renders
 * somewhere the moment it's added to NOTION_VISIBILITY_ALLOWLIST, instead
 * of silently disappearing until someone also updates this grouping.
 *
 * Purely presentational grouping — this function never changes which
 * fields are present, only how the already-authorized set is organized.
 * The visibility/RBAC boundary is entirely upstream, in
 * selectVisibleNotionFields()/buildNotionListingClientDto().
 */
export function buildNotionDetailSections(
  visibleFields: readonly NotionDetailInputField[],
): NotionDetailSection[] {
  const toDetailField = (f: NotionDetailInputField): NotionDetailField => ({
    key: f.field,
    label: f.label,
    value: f.value,
    editable: f.editable ?? false,
    edit: f.edit,
    rawValue: f.value,
  });

  const overview = visibleFields
    .filter((f) => OVERVIEW_FIELDS.has(f.field))
    .map(toDetailField);
  const resources = visibleFields
    .filter((f) => RESOURCE_FIELDS.has(f.field))
    .map(toDetailField);
  const other = visibleFields
    .filter(
      (f) =>
        !OVERVIEW_FIELDS.has(f.field) &&
        !RESOURCE_FIELDS.has(f.field) &&
        !HEADER_FIELDS.has(f.field),
    )
    .map(toDetailField);

  const sections: NotionDetailSection[] = [];
  if (overview.length > 0) {
    sections.push({
      title: "Property overview",
      layout: "grid",
      fields: overview,
    });
  }
  if (resources.length > 0) {
    sections.push({
      title: "Booking & resources",
      layout: "actions",
      fields: resources,
    });
  }
  if (other.length > 0) {
    sections.push({ layout: "list", fields: other });
  }

  return sections;
}
