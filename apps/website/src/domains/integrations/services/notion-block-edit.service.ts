import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import {
  NotionClient,
  type NotionContentBlock,
} from "@stayw/integrations/notion";

import {
  findBlockEditAllowlistEntry,
  NOTION_BLOCK_EDIT_ALLOWLIST,
} from "../config/notion-block-edit-allowlist";
import { updateNotionBlockRequestSchema } from "../schemas/notion-block-edit.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * UX-only: which of a page's real blocks a dashboard should even attempt to
 * render an "Edit" affordance for — never the real security boundary.
 * `updateNotionBlockContent()` below independently re-checks both
 * `notion:update` and the allowlist itself, unconditionally, no matter what
 * this function (or a tampered client) claims. With
 * `NOTION_BLOCK_EDIT_ALLOWLIST` empty (today), this always returns an empty
 * array regardless of the actor's role — 100% read-only, exactly like
 * before this function existed. Same convention as
 * annotateNotionFieldEditability() in notion-edit-allowlist.ts.
 */
export async function listEditableNotionBlockIds(
  actor: AuthContext,
  pageId: string,
): Promise<string[]> {
  const canEdit = await hasPermission(actor, "notion:update");
  if (!canEdit) return [];
  return NOTION_BLOCK_EDIT_ALLOWLIST.filter(
    (entry) => entry.pageId === pageId,
  ).map((entry) => entry.blockId);
}

/**
 * The dashboard block-content write path for approved Notion SOP/
 * operational blocks — the block-level counterpart to
 * notion-edit.service.ts's updateNotionField() (page PROPERTY edits).
 * `NOTION_BLOCK_EDIT_ALLOWLIST` is deliberately empty (see that file's own
 * doc comment) — every real call to this function returns "not_editable"
 * before any Notion API call is attempted, regardless of the requested
 * page/block or the actor's role. This is intentional, fail-closed
 * behavior: populating the allowlist with one exact, reviewed page+block is
 * a separate, explicitly-approved change, and even then only ever for a
 * controlled test the user has approved in advance — see this file's git
 * history / HANDOFF.md for that checkpoint.
 *
 * `provider_error`/`verification_failed` deliberately carry only a fixed,
 * generic `message` — never the real Notion/network error text (that real
 * error, plus enough context to investigate — pageId/blockId/timestamps —
 * is logged server-side via `console.error` and never returned). This
 * mirrors the hardening applied to the read path (getNotionPageContent(),
 * see HANDOFF.md's Notion SOP read/display increment) — built in here from
 * the start, not bolted on after a review, since this is a write path.
 *
 * The required write lifecycle (per explicit instruction, recorded here for
 * continuity): fresh GET/preflight → conflict check → PATCH → a SEPARATE,
 * independent GET → verify the saved value → audit success (only after
 * verification) → return the re-fetched, provider-confirmed value. The
 * PATCH response's own echo is deliberately never treated as sufficient
 * confirmation on its own — see updateNotionBlockContent() below.
 */
export type NotionBlockEditResult =
  | {
      status: "success";
      newLastEditedTime: string;
      /** The plain text the SEPARATE, independent post-PATCH getBlockContent() verification read confirmed — never the PATCH echo alone, never the browser's locally-submitted text. */
      newText: string;
    }
  | { status: "not_editable" }
  | { status: "conflict" }
  | { status: "validation_error"; message: string }
  | { status: "provider_error"; message: string }
  | {
      /**
       * The PATCH itself appeared to succeed, but the required independent
       * verification step either failed to run (the second GET errored) or
       * ran and found a value that doesn't match what was just written.
       * Deliberately distinct from `provider_error` (which means the write
       * attempt itself failed) — this means StayWhile genuinely does not
       * know the real current state of this block and must not claim
       * success. Real diagnostic detail (which of the two verification
       * failure modes, the actual mismatched values, the real error) is
       * logged server-side only — never returned here.
       */
      status: "verification_failed";
      message: string;
    };

const NOTION_BLOCK_EDIT_GENERIC_ERROR =
  "Couldn't save this change to Notion. Please try again.";

const NOTION_BLOCK_EDIT_VERIFICATION_FAILED_ERROR =
  "The change may not have saved correctly. Please reload and check this content in Notion before trying again.";

function getNotionClient(): NotionClient {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error("Notion isn't configured — set NOTION_API_KEY.");
  }
  return new NotionClient({ token });
}

/**
 * Recursively searches an already-fetched page's real content tree for a
 * specific block id — the actual "does this block belong to this page"
 * proof this write path relies on (see updateNotionBlockContent below).
 * Never searches into a table's `rows`: a NotionTableRow isn't a
 * NotionContentBlock, and table editing isn't supported in this V1 (see
 * NotionEditableBlockType) — so a blockId that only exists as a table row
 * correctly resolves to "not found" here, not a false match.
 */
function findBlockInTree(
  blocks: readonly NotionContentBlock[],
  blockId: string,
): NotionContentBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    if ("children" in block && block.children.length > 0) {
      const found = findBlockInTree(block.children, blockId);
      if (found) return found;
    }
  }
  return null;
}

/** Plain-text concatenation of a block's rich text runs, for the audit log's beforeState only — never rendered, never returned to the client. */
function plainTextOf(block: NotionContentBlock): string | null {
  return "text" in block ? block.text.map((run) => run.text).join("") : null;
}

export async function updateNotionBlockContent(
  actor: AuthContext,
  rawInput: unknown,
): Promise<NotionBlockEditResult> {
  await assertPermission(actor, "notion:update");

  const parsedInput = updateNotionBlockRequestSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      status: "validation_error",
      message: parsedInput.error.issues[0]?.message ?? "Invalid value.",
    };
  }
  const input = parsedInput.data;

  // The allowlist is the single source of truth for "is this exact block
  // editable at all" — checked before any Notion call, so an unapproved
  // page/block is rejected identically regardless of what text was
  // submitted for it.
  const allowlistEntry = findBlockEditAllowlistEntry(
    input.pageId,
    input.blockId,
  );
  if (!allowlistEntry) {
    return { status: "not_editable" };
  }

  const client = getNotionClient();

  // The real, authoritative "does this block actually belong to the
  // expected page" proof — never trusts the request's own claim. Reuses
  // the exact same, already-tested read path the detail view itself uses
  // (getPageContent()), same "reuse the existing read for the conflict
  // check" convention as updateNotionField()'s reuse of
  // listDataSourceRecords(). This single call also supplies the block's
  // current real type/text/lastEditedTime for every check below.
  let content;
  try {
    content = await client.getPageContent(input.pageId);
  } catch (err) {
    console.error("updateNotionBlockContent: getPageContent failed", err);
    return {
      status: "provider_error",
      message: NOTION_BLOCK_EDIT_GENERIC_ERROR,
    };
  }

  const targetBlock = findBlockInTree(content.blocks, input.blockId);
  if (!targetBlock) {
    // Either the block doesn't exist, was moved/deleted, or — critically —
    // never belonged to this page's tree at all (an arbitrary/tampered
    // blockId). The response is identical to "not editable" either way,
    // never a distinct message that would confirm or deny the block's
    // existence somewhere else.
    return { status: "not_editable" };
  }
  if (
    targetBlock.type !== allowlistEntry.blockType ||
    !("text" in targetBlock)
  ) {
    // The block's real shape changed since it was allowlisted (e.g.
    // converted from a paragraph to a table) — refuse rather than guess.
    return { status: "not_editable" };
  }
  if (targetBlock.lastEditedTime !== input.expectedLastEditedTime) {
    return { status: "conflict" };
  }

  try {
    // The return value here is deliberately unused for confirmation
    // purposes — see updateBlockContent()'s own doc comment for why the
    // PATCH echo alone is never sufficient. A separate, independent GET
    // (below) is the real confirmation step.
    await client.updateBlockContent(input.blockId, input.text);
  } catch (err) {
    console.error(
      "updateNotionBlockContent: updateBlockContent (PATCH) failed",
      {
        pageId: input.pageId,
        blockId: input.blockId,
        err,
      },
    );
    return {
      status: "provider_error",
      message: NOTION_BLOCK_EDIT_GENERIC_ERROR,
    };
  }

  // The required, SEPARATE independent verification read — a fresh
  // single-block GET, never a re-use of the PATCH response. If this call
  // itself fails, StayWhile does not know whether the PATCH actually
  // landed; if it succeeds but the returned text doesn't match what was
  // just submitted, the write did not save as intended (a partial write, a
  // race with another editor, or a provider-side inconsistency). Either
  // way this is reported as `verification_failed`, never `success` — and
  // never audited as a successful change, since it isn't confirmed to be
  // one.
  let verified: {
    type: string;
    text: { text: string }[];
    lastEditedTime: string;
  };
  try {
    verified = await client.getBlockContent(input.blockId);
  } catch (err) {
    console.error(
      "updateNotionBlockContent: PATCH appeared to succeed, but the independent verification GET failed — real Notion state is unconfirmed",
      { pageId: input.pageId, blockId: input.blockId, err },
    );
    return {
      status: "verification_failed",
      message: NOTION_BLOCK_EDIT_VERIFICATION_FAILED_ERROR,
    };
  }

  const verifiedPlainText = verified.text.map((run) => run.text).join("");
  if (verifiedPlainText !== input.text) {
    console.error(
      "updateNotionBlockContent: PATCH appeared to succeed, but the independent verification GET returned a different value than what was submitted",
      {
        pageId: input.pageId,
        blockId: input.blockId,
        submittedLength: input.text.length,
        verifiedLength: verifiedPlainText.length,
      },
    );
    return {
      status: "verification_failed",
      message: NOTION_BLOCK_EDIT_VERIFICATION_FAILED_ERROR,
    };
  }

  // Only reached once the independent verification read has actually
  // confirmed the saved value — an audited "success" always means a real,
  // provider-verified write, never just a PATCH request that was sent.
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "notion_block.content_updated",
    entityType: "NotionBlock",
    entityId: input.blockId,
    beforeState: {
      pageId: input.pageId,
      blockType: allowlistEntry.blockType,
      text: plainTextOf(targetBlock),
    },
    afterState: {
      pageId: input.pageId,
      blockType: allowlistEntry.blockType,
      text: verifiedPlainText,
    },
  });

  // The text/timestamp the SEPARATE verification GET just confirmed —
  // never the PATCH echo, never the browser's locally-submitted text.
  return {
    status: "success",
    newLastEditedTime: verified.lastEditedTime,
    newText: verifiedPlainText,
  };
}
