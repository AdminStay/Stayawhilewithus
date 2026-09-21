"use client";

import type { NotionEditableFieldType } from "@stayw/integrations/notion";
import { Button, Input, Select } from "@stayw/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import type {
  UpdateNotionFieldActionInput,
  UpdateNotionFieldActionState,
} from "../actions";

const INITIAL_STATE: UpdateNotionFieldActionState = { status: "idle" };

export type NotionEditableValue =
  string | number | boolean | readonly string[] | null;

export interface NotionFieldEditorProps {
  pageId: string;
  dataSourceId: string;
  field: string;
  value: NotionEditableValue;
  lastEditedTime: string;
  fieldType: NotionEditableFieldType;
  options?: readonly string[];
  /**
   * The server action itself, passed down from a Server Component rather
   * than imported directly here — same reason SyncNowButton.tsx/
   * RefreshLocksButton.tsx take their action as a prop instead of
   * importing it: `actions.ts` is a "use server" file Next.js's real
   * bundler specially rewrites for a client import, but that rewrite is a
   * Next.js-specific build step, not something every tool that loads this
   * module (e.g. a plain Vite/Vitest transform) replicates — a direct
   * value import here would drag the whole server-only module graph
   * behind it into that tool's bundle. A type-only import of
   * `UpdateNotionFieldActionState`/`UpdateNotionFieldActionInput` is fine;
   * only a runtime import of the function itself is the problem.
   */
  action: (
    prevState: UpdateNotionFieldActionState,
    input: UpdateNotionFieldActionInput,
  ) => Promise<UpdateNotionFieldActionState>;
}

function displayValue(value: NotionEditableValue): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Renders the one control for whichever of the 7 Notion property types
 * this package's write path actually validates (see fieldValueSchemaFor in
 * notion-edit.schema.ts) — never a generic passthrough, and never a type
 * outside that closed set. The `default` branch is a compile-time
 * exhaustiveness guard, not a real runtime UI state: every real
 * NOTION_EDIT_ALLOWLIST entry is already typed to one of these 7, so this
 * can only be reached by a genuinely unsupported type, and it refuses to
 * guess a control for one rather than silently rendering something wrong.
 */
function FieldControl({
  fieldType,
  options,
  draft,
  onChange,
}: {
  fieldType: NotionEditableFieldType;
  options?: readonly string[];
  draft: NotionEditableValue;
  onChange: (next: NotionEditableValue) => void;
}) {
  switch (fieldType) {
    case "text":
      return (
        <Input
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "url":
      return (
        <Input
          type="url"
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={typeof draft === "number" ? draft : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={draft === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border text-forest-600 focus:ring-forest-500/30"
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <Select
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "multi_select": {
      const selected = new Set(Array.isArray(draft) ? draft : []);
      return (
        <div className="flex flex-wrap gap-3">
          {(options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.has(o)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o);
                  else next.delete(o);
                  onChange([...next]);
                }}
                className="h-4 w-4 rounded border-border text-forest-600 focus:ring-forest-500/30"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    default: {
      const exhaustive: never = fieldType;
      throw new Error(`Unsupported Notion editable field type: ${exhaustive}`);
    }
  }
}

/**
 * One field's full view -> edit -> save -> confirm round trip. This
 * component is only ever mounted at all when its caller (NotionDetailView)
 * has already confirmed the field is `editable` — but it never assumes
 * that means the write will succeed: `updateNotionFieldAction()` ->
 * `updateNotionField()` independently re-checks `notion:update` AND the
 * allowlist itself, unconditionally, no matter what got this component
 * rendered in the first place. A tampered client that somehow forced this
 * component to mount anyway still cannot get a real write past that
 * server-side check.
 *
 * Always goes through updateNotionFieldAction() -> updateNotionField() —
 * this component never imports or calls the Notion client directly. On
 * success, displays exactly the server-confirmed value/lastEditedTime
 * Notion's own PATCH response returned (see updatePageProperty() /
 * notion-edit.service.ts), never the browser's own optimistic guess. On
 * conflict, never overwrites silently — tells the user and offers a real
 * `router.refresh()` (re-runs the page's Server Components, so every field
 * picks up whatever else changed too, not just this one). On a
 * provider/validation error, the current edit-in-progress value is kept
 * (never discarded), and only the already-sanitized message
 * updateNotionField() itself produced is shown — never a raw provider
 * response or credential.
 */
export function NotionFieldEditor({
  pageId,
  dataSourceId,
  field,
  value,
  lastEditedTime,
  fieldType,
  options,
  action,
}: NotionFieldEditorProps) {
  const router = useRouter();
  const [state, dispatch, isPending] = useActionState(action, INITIAL_STATE);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<NotionEditableValue>(value);

  const confirmedValue: NotionEditableValue =
    state.status === "success"
      ? (state.newValue as NotionEditableValue)
      : value;
  const confirmedLastEditedTime =
    state.status === "success" ? state.newLastEditedTime : lastEditedTime;

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">{displayValue(confirmedValue)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(confirmedValue);
            setIsEditing(true);
          }}
        >
          Edit
        </Button>
        {state.status === "success" && (
          <span className="text-xs text-success-600">Saved</span>
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
          dataSourceId,
          field,
          expectedLastEditedTime: confirmedLastEditedTime,
          value: draft,
        });
      }}
      className="space-y-2"
    >
      <FieldControl
        fieldType={fieldType}
        options={options}
        draft={draft}
        onChange={setDraft}
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
      {state.status === "not_editable" && (
        <p className="text-xs text-error-500">
          This field is no longer editable.
        </p>
      )}
      {state.status === "failure" && (
        <p className="text-xs text-error-500">{state.error}</p>
      )}
      {state.status === "conflict" && (
        <div className="space-y-1.5 rounded-lg bg-warning-50 p-2 text-xs text-warning-700">
          <p>This value changed in Notion since it was loaded here.</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => router.refresh()}
          >
            Reload the current value
          </Button>
        </div>
      )}
    </form>
  );
}
