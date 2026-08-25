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
