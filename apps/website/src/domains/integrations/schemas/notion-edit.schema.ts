import type { NotionEditableFieldType } from "@stayw/integrations/notion";
import { z } from "zod";

/**
 * The outer request shape every dashboard-edit submission must match,
 * regardless of which field is being edited — validated first, before the
 * allowlist lookup even happens. `expectedLastEditedTime` is the
 * stale-data/conflict guard: the value the dashboard had loaded when the
 * user started editing, compared against Notion's real current value
 * immediately before writing (see notion-edit.service.ts).
 */
export const updateNotionFieldRequestSchema = z.object({
  pageId: z.string().min(1),
  dataSourceId: z.string().min(1),
  field: z.string().min(1),
  expectedLastEditedTime: z.string().min(1),
  // Validated a second time, narrowly, against the specific field's own
  // type schema (see fieldValueSchemaFor below) once the allowlist lookup
  // resolves which type this field actually is — kept as `unknown` here so
  // one generic outer schema can front every field type without a giant
  // discriminated union that would need editing every time a field is
  // added.
  value: z.unknown(),
});

export type UpdateNotionFieldRequest = z.infer<
  typeof updateNotionFieldRequestSchema
>;

/**
 * One schema per NotionEditableFieldType — a closed, reviewed set, not a
 * generic passthrough. Every value that ever reaches a real Notion PATCH
 * call goes through exactly one of these first. Deliberately conservative
 * (e.g. a hard length cap on text) — this is data going into a shared
 * operational record, not a scratch field.
 */
const MAX_TEXT_LENGTH = 2000;

export function fieldValueSchemaFor(
  fieldType: NotionEditableFieldType,
  options?: readonly string[],
) {
  switch (fieldType) {
    case "text":
      return z.string().max(MAX_TEXT_LENGTH);
    case "url":
      return z.string().url().max(MAX_TEXT_LENGTH);
    case "number":
      return z.number().finite();
    case "checkbox":
      return z.boolean();
    case "date":
      // Notion's own ISO 8601 date/date-time string, never a Date object
      // across the server-action boundary.
      return z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
        message: "Must be a valid ISO 8601 date",
      });
    case "select":
      return options && options.length > 0
        ? z.enum(options as [string, ...string[]])
        : z.never();
    case "multi_select":
      return options && options.length > 0
        ? z.array(z.enum(options as [string, ...string[]]))
        : z.never();
    default: {
      // Exhaustiveness guard — if NotionEditableFieldType ever gains a new
      // member without a matching case above, this is a compile error, not
      // a silent runtime fallback.
      const exhaustive: never = fieldType;
      throw new Error(`Unhandled Notion editable field type: ${exhaustive}`);
    }
  }
}
