"use client";

import { Button, Textarea } from "@stayw/ui";
import { useActionState, useState, type ReactNode } from "react";

import type {
  UpdateNotionBlockActionInput,
  UpdateNotionBlockActionState,
} from "../actions";

const INITIAL_STATE: UpdateNotionBlockActionState = { status: "idle" };

export interface NotionBlockEditorProps {
  pageId: string;
  blockId: string;
  lastEditedTime: string;
  /** Plain-text starting value for the edit textarea — this V1 only ever edits/writes a single plain-text run (see notion-block-edit.schema.ts), never per-run bold/italic/link formatting. */
  initialPlainText: string;
  /**
   * The block's current, fully-formatted display (e.g. `<RichText runs={block.text} />`) — shown as-is until a save actually changes the block's content. After a successful save this switches to the plain confirmed text Notion's own PATCH response returned, which is textually accurate, not a display regression: this V1's write path itself replaces a block's content with a single plain-text run, so the block genuinely IS plain text in Notion now.
   */
  initialDisplay: ReactNode;
  /** Wraps whichever content (initialDisplay, or the plain confirmed text after a save) in this block's own element/classes — e.g. `(c) => <h2 className="...">{c}</h2>`. Called identically for both, so the block's visual identity (heading level, list marker, callout box, …) never changes just because it became editable. */
  wrap: (content: ReactNode) => ReactNode;
  /**
   * The updateNotionBlockContentAction server action itself, passed down
   * from the page (a Server Component) rather than imported directly here —
   * same "use server" module-boundary reason as NotionFieldEditor's own
   * `action` prop (see that component's doc comment).
   */
  action: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
}

/**
 * One block's full view -> edit -> save -> confirm round trip — the
 * block-content counterpart to NotionFieldEditor.tsx (page PROPERTY edits).
 * Only ever mounted when the caller (NotionBlockRenderer.tsx) has already
 * confirmed this specific block id is in the actor's `editableBlockIds`
 * (see listEditableNotionBlockIds) — but exactly like NotionFieldEditor,
 * this never assumes that means the write will succeed:
 * updateNotionBlockContentAction() -> updateNotionBlockContent()
 * independently re-checks `notion:update`, the real allowlist, and that the
 * block still genuinely belongs to the expected page's real content tree,
 * unconditionally, no matter what got this component rendered in the first
 * place.
 *
 * On success, displays exactly the server-confirmed plain text/
 * lastEditedTime Notion's own PATCH response returned — never the
 * browser's own optimistic guess. On conflict, never overwrites silently —
 * tells the user, since (unlike NotionFieldEditor's page-property case)
 * this dialog's content was loaded via a one-shot action call, not
 * Server-Component props, so a `router.refresh()` wouldn't actually
 * refresh it; closing and reopening the result re-fetches the real current
 * content. On a provider/validation error, the current edit-in-progress
 * draft is kept (never discarded), and only the already-sanitized message
 * updateNotionBlockContent() itself produced is shown — never a raw
 * provider response or credential (see that function's own doc comment).
 */
export function NotionBlockEditor({
  pageId,
  blockId,
  lastEditedTime,
  initialPlainText,
  initialDisplay,
  wrap,
  action,
}: NotionBlockEditorProps) {
  const [state, dispatch, isPending] = useActionState(action, INITIAL_STATE);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(initialPlainText);

  const confirmedDisplay =
    state.status === "success" ? state.newText : initialDisplay;
  const confirmedPlainText =
    state.status === "success" ? state.newText : initialPlainText;
  const confirmedLastEditedTime =
    state.status === "success" ? state.newLastEditedTime : lastEditedTime;

  if (!isEditing) {
    return (
      <div className="group/notion-block space-y-1">
        {wrap(confirmedDisplay)}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(confirmedPlainText);
            setIsEditing(true);
          }}
        >
          Edit
        </Button>
        {state.status === "success" && (
          <span className="ml-2 text-xs text-success-600">Saved</span>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        dispatch({
          pageId,
          blockId,
          expectedLastEditedTime: confirmedLastEditedTime,
          text: draft,
        });
      }}
      className="space-y-2"
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsEditing(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>

      {state.status === "validation_error" && (
        <p className="text-xs text-error-500">{state.message}</p>
      )}
      {state.status === "provider_error" && (
        <p className="text-xs text-error-500">{state.message}</p>
      )}
      {state.status === "verification_failed" && (
        <p className="text-xs text-error-500">{state.message}</p>
      )}
      {state.status === "not_editable" && (
        <p className="text-xs text-error-500">
          This content is no longer editable.
        </p>
      )}
      {state.status === "conflict" && (
        <p className="rounded-lg bg-warning-50 p-2 text-xs text-warning-700">
          This content changed in Notion since it was loaded here. Close and
          reopen this item to see the latest version.
        </p>
      )}
    </form>
  );
}
