/**
 * The real Notion page id for "SOPs" — the root, shared-with-everyone page
 * that houses the whole operational SOP library. Confirmed live via
 * read-only discovery (see HANDOFF.md): its own top-level children are a
 * genuinely mixed structure — some SOPs are `toggle` blocks (their content
 * lives inline, nested inside the toggle itself), some are `child_page`
 * blocks (a link to a real, separate Notion page, whose content is fetched
 * on demand), and several SOPs exist as BOTH at once (the same conceptual
 * SOP represented twice in Notion's own structure). This is rendered
 * exactly as-is — no fuzzy title-matching is used to merge the two
 * representations of "the same" SOP into one entry, matching this
 * codebase's standing "never fuzzy-map" principle applied everywhere else
 * (property/device mapping, etc.). A future re-organization of the real
 * "SOPs" page in Notion is reflected automatically the next time this page
 * is fetched — nothing here is a cached or hard-coded list of SOP titles.
 */
export const NOTION_SOPS_ROOT_PAGE_ID = "1f06058d-b989-8036-8068-c8b9dca29dcf";
