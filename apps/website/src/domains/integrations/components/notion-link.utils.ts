/**
 * Only `http:`/`https:` URLs are considered safe to render as an external
 * link. `Airbnb Link`, `VRBO Link`, and `Direct booking` are Notion
 * `rich_text` properties (free text, not Notion's validated `url` type), so
 * their values are never assumed to be a well-formed URL — this must be
 * checked before rendering one as a link.
 */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A Notion object id: 32 hex digits, with or without the usual hyphens. */
const NOTION_ID =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * "Open in Notion" URL for a page or database id (Phase 0, 2026-10-15) —
 * the same `https://notion.so/<id without hyphens>` form the Library and
 * SOP views already link to. Anything that isn't a well-formed Notion id
 * yields null, so no link is rendered rather than a guessed one.
 */
export function notionPageUrl(id: string | null | undefined): string | null {
  if (!id || !NOTION_ID.test(id)) return null;
  return `https://notion.so/${id.replace(/-/g, "").toLowerCase()}`;
}
