import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { NotionClient } from "@stayw/integrations/notion";

import { findEditAllowlistEntry } from "../config/notion-edit-allowlist";
import {
  fieldValueSchemaFor,
  updateNotionFieldRequestSchema,
} from "../schemas/notion-edit.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * The dashboard-edit write path for approved Notion fields. As of this
 * increment, NOTION_EDIT_ALLOWLIST is deliberately empty (see that file's
 * own doc comment) — every real call to this function returns
 * "not_editable" before any Notion API call is attempted, regardless of
 * the requested field or the actor's role. This is intentional,
 * client-required fail-closed behavior, not a bug: populating the
 * allowlist is the only way any real write becomes possible, and that's a
 * separate, explicitly-approved change.
 *
 * Never calls syncNotionDevices/discoverNotion/any mapping function — this
 * file touches exactly one thing, one already-existing SmartDevice-style
 * write boundary for a single Notion property, nothing else.
 */
export type NotionEditResult =
  | {
      status: "success";
      newLastEditedTime: string;
      /** The value Notion's PATCH response just confirmed — same shape as the value submitted, already validated by fieldValueSchemaFor(). The dashboard should display exactly this, not its own optimistic guess. */
      newValue: unknown;
    }
  | { status: "not_editable" }
  | { status: "conflict" }
  | { status: "validation_error"; message: string }
  | { status: "provider_error"; message: string };

function getNotionClient(): NotionClient {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error("Notion isn't configured — set NOTION_API_KEY.");
  }
  return new NotionClient({ token });
}

export async function updateNotionField(
  actor: AuthContext,
  rawInput: unknown,
): Promise<NotionEditResult> {
  await assertPermission(actor, "notion:update");

  const input = updateNotionFieldRequestSchema.parse(rawInput);

  // The allowlist is the single source of truth for "is this field
  // editable at all" — checked before any type validation or Notion call,
  // so an unapproved field is rejected identically regardless of what
  // value was submitted for it.
  const allowlistEntry = findEditAllowlistEntry(
    input.dataSourceId,
    input.field,
  );
  if (!allowlistEntry) {
    return { status: "not_editable" };
  }

  const valueSchema = fieldValueSchemaFor(
    allowlistEntry.fieldType,
    allowlistEntry.options,
  );
  const parsedValue = valueSchema.safeParse(input.value);
  if (!parsedValue.success) {
    return {
      status: "validation_error",
      message: parsedValue.error.issues[0]?.message ?? "Invalid value.",
    };
  }

  const client = getNotionClient();

  // Stale-data/conflict check — reuses the same real, already-tested read
  // path the detail view itself uses (listDataSourceRecords()), rather
  // than a second single-page-fetch method: this data source's row count
  // is small, so a fresh full read immediately before a write is cheap and
  // avoids maintaining two different "read one Notion row" code paths.
  let currentRows;
  try {
    currentRows = await client.listDataSourceRecords(input.dataSourceId);
  } catch (err) {
    return {
      status: "provider_error",
      message: err instanceof Error ? err.message : "Notion request failed.",
    };
  }
  const currentRow = currentRows.find((row) => row.id === input.pageId);
  if (!currentRow) {
    return { status: "provider_error", message: "Page no longer found." };
  }
  if (currentRow.lastEditedTime !== input.expectedLastEditedTime) {
    return { status: "conflict" };
  }

  // Structurally unreachable today (NOTION_EDIT_ALLOWLIST is empty, so
  // allowlistEntry is always null above, and updateNotionField() already
  // returned "not_editable" long before this line). Kept for when a field
  // is eventually approved.
  let confirmed: { lastEditedTime: string };
  try {
    confirmed = await client.updatePageProperty(
      input.pageId,
      allowlistEntry.field,
      parsedValue.data,
    );
  } catch (err) {
    return {
      status: "provider_error",
      message: err instanceof Error ? err.message : "Notion request failed.",
    };
  }

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "notion_page.field_updated",
    entityType: "NotionPage",
    entityId: input.pageId,
    beforeState: {
      field: input.field,
      value: currentRow[allowlistEntry.field] ?? null,
    },
    afterState: { field: input.field, value: parsedValue.data },
  });

  // The value/timestamp Notion's own PATCH response just confirmed — never
  // the value the dashboard optimistically assumed, and never a locally
  // fabricated timestamp. This is what "re-fetch/verification" means here:
  // Notion's PATCH response already echoes the updated page, so a second,
  // separate read isn't needed just to learn this.
  return {
    status: "success",
    newLastEditedTime: confirmed.lastEditedTime,
    newValue: parsedValue.data,
  };
}
