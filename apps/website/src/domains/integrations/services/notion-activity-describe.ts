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

/**
 * Shown when Notion supplied no editor at all, or a person without a name
 * (Phase 0, 2026-10-15). Integrations and Notion agents keep their own
 * labels — that much Notion did tell us.
 */
export const UNKNOWN_EDITOR = "Unknown editor";

function countLabel(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** "A", "A and B", "A, B and C". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Who did it, from Notion's own `authors` data only — never an invented
 * name (2026-10-16). Every author Notion reported is represented:
 *   - a person's name when Notion's Users API supplied one, else
 *     "Unknown editor" (or "N unknown editors");
 *   - an integration as "<name> (integration)" when Notion supplied its
 *     name, else "An integration";
 *   - a Notion agent as "<name> (Notion agent)" or "A Notion agent";
 *   - authors beyond those stored (`additionalActors`) as "N others".
 * A name is whatever account Notion reports: a shared Notion login shows
 * that login's name, because Notion can't tell which human used it.
 */
export function describeNotionActors(
  actors: readonly NotionEventActor[],
  additionalActors = 0,
): string {
  const parts: string[] = [];
  let unknownPeople = 0;
  let unnamedBots = 0;
  let unnamedAgents = 0;
  for (const actor of actors) {
    if (actor.name) {
      parts.push(
        actor.type === "bot"
          ? `${actor.name} (integration)`
          : actor.type === "agent"
            ? `${actor.name} (Notion agent)`
            : actor.name,
      );
    } else if (actor.type === "bot") unnamedBots += 1;
    else if (actor.type === "agent") unnamedAgents += 1;
    else unknownPeople += 1;
  }
  if (unknownPeople > 0) {
    parts.push(
      countLabel(
        unknownPeople,
        parts.length === 0 ? UNKNOWN_EDITOR : "an unknown editor",
        "unknown editors",
      ),
    );
  }
  if (unnamedBots > 0) {
    parts.push(
      countLabel(
        unnamedBots,
        parts.length === 0 ? "An integration" : "an integration",
        "integrations",
      ),
    );
  }
  if (unnamedAgents > 0) {
    parts.push(
      countLabel(
        unnamedAgents,
        parts.length === 0 ? "A Notion agent" : "a Notion agent",
        "Notion agents",
      ),
    );
  }
  if (additionalActors > 0) {
    parts.push(countLabel(additionalActors, "1 other", "others"));
  }
  return parts.length === 0 ? UNKNOWN_EDITOR : joinList(parts);
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
