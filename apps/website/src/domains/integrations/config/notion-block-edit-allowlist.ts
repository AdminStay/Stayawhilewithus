import type { NotionEditableBlockType } from "@stayw/integrations/notion";

/**
 * The dashboard block-content-edit allowlist — completely separate from
 * both the visibility allowlist (notion-field-visibility.ts) and the
 * page-PROPERTY edit allowlist (notion-edit-allowlist.ts). This one governs
 * writes to a Notion PAGE BODY BLOCK's plain text (paragraphs, headings,
 * list items, toggles, callouts) — a materially different write surface
 * than a "View of Listings" row's structured properties.
 *
 * Normally DELIBERATELY EMPTY — populated only for an explicit, reviewed,
 * client-approved change naming the exact page and block, never with a
 * wildcard/"all blocks on this page" entry. `pageId` is not itself
 * sufficient authorization: it exists so `updateNotionBlockContent()`
 * (notion-block-edit.service.ts) can verify the requested block actually
 * belongs to the page the request claims it does (a real, freshly-read
 * getPageContent() tree-membership check), never so a whole page can be
 * edited by naming just its id.
 *
 * CURRENT STATE (2026-09-22): exactly one entry, for the user-created,
 * explicitly-approved controlled-test page "StayWhile Dashboard Integration
 * Test" — real-verified via read-only discovery to be a genuine paragraph
 * block whose current text exactly matches the approved test string. This
 * enables ONLY that one page/block for editing; every other page/block in
 * the workspace is still rejected before any Notion API call is made. No
 * real write has been made yet — the user will perform the approved
 * original → verified → original test through the dashboard UI itself.
 */
export interface NotionBlockEditAllowlistEntry {
  /** The root Notion page this block must actually belong to — re-verified server-side against a fresh getPageContent(pageId) read, never trusted from the request alone. */
  pageId: string;
  /** The specific Notion block id allowed to be edited — never a whole page, never a wildcard. */
  blockId: string;
  /** The block's expected real type — re-verified against Notion's own freshly-read current type at write time; a mismatch (the block's real shape changed since allowlisting) is treated as not editable, never guessed past. */
  blockType: NotionEditableBlockType;
  /** Human label for an admin-facing allowlist review UI, e.g. "SOP for VRBO & Direct Bookings — intro paragraph". Never rendered to end users. */
  label: string;
}

export const NOTION_BLOCK_EDIT_ALLOWLIST: readonly NotionBlockEditAllowlistEntry[] =
  [
    {
      pageId: "3e26058d-b989-803d-a1d7-f06f8adc27a6",
      blockId: "3e26058d-b989-8006-9732-c285c035e832",
      blockType: "paragraph",
      label: "StayWhile Dashboard Integration Test — first paragraph",
    },
  ];

export function findBlockEditAllowlistEntry(
  pageId: string,
  blockId: string,
): NotionBlockEditAllowlistEntry | null {
  return (
    NOTION_BLOCK_EDIT_ALLOWLIST.find(
      (entry) => entry.pageId === pageId && entry.blockId === blockId,
    ) ?? null
  );
}
