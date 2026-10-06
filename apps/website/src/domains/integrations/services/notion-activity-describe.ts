/**
 * Readable descriptions of Notion activity (Notion N2, 2026-10-06). Pure and
 * display-only: who / what / where / which fields, for the Recent Notion
 * Activity view. Names, titles and field NAMES only — never Notion ids or
 * values. (Moved out of the notification rules, which are not part of N2.)
 */
import type {
  NotionActivityAction,
  NotionEventActor,
  NotionEventDetails,
} from "./notion-event-enrichment";

export const ACTION_VERB: Record<NotionActivityAction, string> = {
  created: "created",
  updated_properties: "updated",
  updated_content: "edited",
  moved: "moved",
  deleted: "moved to trash",
  restored: "restored",
  locked: "locked",
  unlocked: "unlocked",
  schema_updated: "changed the structure of",
  commented: "commented on",
  comment_updated: "edited a comment on",
  comment_deleted: "deleted a comment on",
};

/** Who did it, from Notion's own data only — never an invented name. */
export function describeNotionActors(
  actors: readonly NotionEventActor[],
): string {
  if (actors.length === 0) return "Someone";
  const named = actors
    .map((a) => a.name)
    .filter((n): n is string => Boolean(n));
  if (named.length > 0) {
    const unnamed = actors.length - named.length;
    return unnamed > 0
      ? `${named.join(", ")} and ${unnamed} other${unnamed > 1 ? "s" : ""}`
      : named.join(", ");
  }
  const first = actors[0]!.type;
  const label =
    first === "bot"
      ? "An integration"
      : first === "agent"
        ? "A Notion agent"
        : "A Notion user";
  return actors.length > 1
    ? `${label} and ${actors.length - 1} other${actors.length > 2 ? "s" : ""}`
    : label;
}

/** "Library › Property Directory › Palm Haven › Router and Thermostat Location" */
export function describeNotionLocation(
  details: Pick<NotionEventDetails, "breadcrumb" | "title">,
): string {
  return [...details.breadcrumb, details.title ?? "(untitled page)"].join(
    " › ",
  );
}

export function describeNotionChange(
  details: NotionEventDetails,
): string | null {
  if (details.action === "updated_properties") {
    if (details.changedProperties.length > 0)
      return `Changed: ${details.changedProperties.join(", ")}`;
    return details.changedCount > 0
      ? `${details.changedCount} field${details.changedCount > 1 ? "s" : ""} changed`
      : null;
  }
  if (details.action === "updated_content" && details.changedCount > 0) {
    return `${details.changedCount} content block${details.changedCount > 1 ? "s" : ""} changed`;
  }
  return null;
}
