import { z } from "zod";

/**
 * Deliberately smaller than updateNotionFieldRequestSchema (notion-edit.schema.ts):
 * block editing has exactly one supported shape in this V1 — replacing a
 * block's plain text content with a single new plain string (no per-type
 * variance the way page properties have text/url/number/checkbox/date/
 * select/multi_select), so one schema covers every editable block type.
 * `expectedLastEditedTime` is the same stale-data/conflict guard as the
 * property-edit path: the block's own `lastEditedTime` the dashboard had
 * loaded when editing started, compared against Notion's real current
 * value immediately before writing (see notion-block-edit.service.ts).
 */
const MAX_BLOCK_TEXT_LENGTH = 2000;

export const updateNotionBlockRequestSchema = z.object({
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  expectedLastEditedTime: z.string().min(1),
  text: z.string().max(MAX_BLOCK_TEXT_LENGTH),
});

export type UpdateNotionBlockRequest = z.infer<
  typeof updateNotionBlockRequestSchema
>;
