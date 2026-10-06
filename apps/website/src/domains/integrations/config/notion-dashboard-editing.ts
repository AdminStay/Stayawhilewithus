/**
 * Meeting #5 (2026-09-24): the StayWhile dashboard is READ-ONLY for Notion.
 * Kenny/Michelle/Ops edit directly in Notion. The dashboard→Notion write
 * infrastructure (built and proven 2026-09-23) stays in the code but is
 * switched off here: both write services refuse every request before any
 * allowlist check or Notion call, and no block is ever reported editable.
 *
 * Do not flip this without an explicit client decision reversing Meeting #5.
 */
export const NOTION_DASHBOARD_EDITING_ENABLED = false;

/** Read through a function so tests of the dormant write path can opt in. */
export function isNotionDashboardEditingEnabled(): boolean {
  return NOTION_DASHBOARD_EDITING_ENABLED;
}
