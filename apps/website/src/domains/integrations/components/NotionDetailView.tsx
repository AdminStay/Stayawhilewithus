"use client";

import { Badge, Dialog } from "@stayw/ui";
import { ExternalLink } from "lucide-react";

import type {
  NotionDetailField,
  NotionDetailSection,
} from "../services/notion-detail-sections";

import { isSafeHttpUrl } from "./notion-link.utils";
import {
  NotionFieldEditor,
  type NotionFieldEditorProps,
} from "./NotionFieldEditor";

export interface NotionDetailPropertyContext {
  propertyId: string;
  propertyName: string;
}

/** Everything a field's edit control needs — absent whenever the caller (a generic search preview, or a listing this actor can't edit anything on) has no page/data-source/conflict-token context to submit an edit against. `action` is threaded through here rather than imported directly by NotionFieldEditor — see that component's own doc comment on why. */
interface EditContext {
  pageId: string;
  dataSourceId: string;
  lastEditedTime: string;
  action: NotionFieldEditorProps["action"];
}

/**
 * True only when every precondition for rendering a real edit control is
 * met: the field itself was marked editable+typed upstream (see
 * annotateNotionFieldEditability()), AND this view actually has somewhere
 * to submit an edit against. Missing edit context is normal, not an error
 * — e.g. NotionSearch's generic preview never has one, so its fields
 * always render as plain text regardless of `editable`.
 */
function canRenderEditor(
  field: NotionDetailField,
  editContext: EditContext | null,
): editContext is EditContext {
  return Boolean(field.editable && field.edit && editContext);
}

/**
 * A single "Booking & resources" row: the field's label on the left, and
 * either a compact "Open" action (for a real http(s) URL — never the raw
 * URL text itself, per the client's explicit request) or the plain value
 * itself, word-wrapped, when it isn't a URL (e.g. Direct Booking is
 * sometimes free text like "Text the owner directly"). The href is always
 * the exact, unmodified source value — only the visible label changes.
 * When the field is genuinely editable (see canRenderEditor), an edit
 * control replaces this static display entirely, rather than sitting
 * alongside a stale "Open" link.
 */
function ResourceRow({
  field,
  editContext,
}: {
  field: NotionDetailField;
  editContext: EditContext | null;
}) {
  const value = typeof field.value === "string" ? field.value : null;
  const isLink = isSafeHttpUrl(value);

  if (canRenderEditor(field, editContext)) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
        <span className="text-sm font-medium text-ink">{field.label}</span>
        <NotionFieldEditor
          pageId={editContext.pageId}
          dataSourceId={editContext.dataSourceId}
          field={field.key}
          value={field.rawValue ?? null}
          lastEditedTime={editContext.lastEditedTime}
          fieldType={field.edit!.fieldType}
          options={field.edit!.options}
          action={editContext.action}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
      <span className="text-sm font-medium text-ink">{field.label}</span>
      {isLink && value ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${field.label} (opens in a new tab)`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-forest-50 px-2.5 py-1 text-xs font-medium text-forest-600 transition-colors hover:bg-forest-100 focus:outline-none focus:ring-2 focus:ring-forest-500/30"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : value ? (
        <span className="max-w-[60%] break-words text-right text-xs text-ink-muted">
          {value}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-ink-faint">—</span>
      )}
    </div>
  );
}

function DetailSection({
  section,
  editContext,
}: {
  section: NotionDetailSection;
  editContext: EditContext | null;
}) {
  return (
    <div>
      {section.title && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {section.title}
        </h3>
      )}

      {section.layout === "grid" && (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-muted p-3">
          {section.fields.map((field) =>
            canRenderEditor(field, editContext) ? (
              <div key={field.key} className="min-w-0">
                <dt className="truncate text-xs text-ink-muted">
                  {field.label}
                </dt>
                <dd className="mt-0.5">
                  <NotionFieldEditor
                    pageId={editContext.pageId}
                    dataSourceId={editContext.dataSourceId}
                    field={field.key}
                    value={field.rawValue ?? null}
                    lastEditedTime={editContext.lastEditedTime}
                    fieldType={field.edit!.fieldType}
                    options={field.edit!.options}
                    action={editContext.action}
                  />
                </dd>
              </div>
            ) : (
              <div key={field.key} className="min-w-0">
                <dt className="truncate text-xs text-ink-muted">
                  {field.label}
                </dt>
                <dd className="mt-0.5 text-base font-semibold text-ink">
                  {field.value === null || field.value === undefined
                    ? "—"
                    : field.value}
                </dd>
              </div>
            ),
          )}
        </div>
      )}

      {section.layout === "actions" && (
        <div className="space-y-1.5">
          {section.fields.map((field) => (
            <ResourceRow
              key={field.key}
              field={field}
              editContext={editContext}
            />
          ))}
        </div>
      )}

      {section.layout === "list" && (
        <dl className="space-y-3">
          {section.fields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                {field.label}
              </dt>
              <dd className="mt-0.5 break-words text-sm text-ink">
                {canRenderEditor(field, editContext) ? (
                  <NotionFieldEditor
                    pageId={editContext.pageId}
                    dataSourceId={editContext.dataSourceId}
                    field={field.key}
                    value={field.rawValue ?? null}
                    lastEditedTime={editContext.lastEditedTime}
                    fieldType={field.edit!.fieldType}
                    options={field.edit!.options}
                    action={editContext.action}
                  />
                ) : (
                  field.value || <span className="text-ink-faint">—</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The in-dashboard "view" experience — opened from a Search result or a
 * Property Listings row, never a new tab, never Notion's own UI embedded.
 * Every field shown here was already selected server-side (see
 * notion-field-visibility.ts's selectVisibleNotionFields() /
 * integrations.service.ts's buildNotionListingClientDto()) before this
 * component ever received it — this component has no ability to reveal a
 * field that wasn't passed to it, so there's nothing here that could leak
 * an unauthorized field even if this component's own rendering logic had a
 * bug. Read-only today: no editable control renders until a future pass
 * wires one in for an actual client-approved field (NOTION_EDIT_ALLOWLIST
 * is currently empty).
 *
 * `sections` (grouped by buildNotionDetailSections() for a listing, or a
 * single ad-hoc "list" section for a general search result's preview) is
 * the only source of body content — deliberately never a raw record.
 * Deliberately never shows: Notion page/database ids, API details, n8n/
 * webhook terminology, or raw property JSON — only the human-readable
 * label/value pairs the caller supplies (`pageId`/`dataSourceId` are
 * accepted only to submit an edit request against — they are never
 * rendered as visible text anywhere in this component). Everything wraps
 * rather than overflows (`break-words`/`min-w-0` throughout), and the
 * dialog itself caps its width and scrolls vertically, never horizontally
 * — see @stayw/ui's Dialog.
 *
 * Still 100% read-only in practice today: an edit control only ever
 * replaces a field's plain display when that field's own `editable` flag
 * is true (see annotateNotionFieldEditability() — gated on both
 * `notion:update` and NOTION_EDIT_ALLOWLIST, the latter currently empty)
 * AND `pageId`/`dataSourceId`/`lastEditedTime` are all present (a generic
 * search-result preview never has these, so it always stays plain
 * regardless of `editable`).
 */
export function NotionDetailView({
  open,
  onClose,
  title,
  subtitle,
  region,
  sections,
  lastEditedTime,
  notionUrl,
  propertyContext,
  pageId,
  dataSourceId,
  updateFieldAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** e.g. the property's address — shown under the title, never in a body section. */
  subtitle?: string | null;
  /** App-computed region badge (e.g. "SRQ") — never raw Notion content. */
  region?: string | null;
  sections: NotionDetailSection[];
  lastEditedTime: string | null;
  notionUrl: string | null;
  propertyContext: NotionDetailPropertyContext | null;
  /** Notion's own page id — structural plumbing an edit submission needs, never rendered. Absent (or null) for a generic search-result preview, which has no edit context at all. */
  pageId?: string | null;
  /** Which data source an edit submission targets. Absent/null has the same effect as a missing pageId — no edit control renders regardless of any field's `editable` flag. */
  dataSourceId?: string | null;
  /** The updateNotionField server action, passed down from the page (a Server Component) — see NotionFieldEditor's own doc comment for why this is never imported directly by a client component. Absent has the same effect as a missing pageId/dataSourceId — no edit control renders. */
  updateFieldAction?: NotionFieldEditorProps["action"];
}) {
  const editContext: EditContext | null =
    pageId && dataSourceId && lastEditedTime && updateFieldAction
      ? { pageId, dataSourceId, lastEditedTime, action: updateFieldAction }
      : null;

  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-5">
        {(region || subtitle || propertyContext) && (
          <div className="space-y-1.5 border-b border-border pb-4">
            <div className="flex flex-wrap items-center gap-2">
              {region && <Badge tone="neutral">{region}</Badge>}
              {propertyContext && (
                <Badge tone="success">{propertyContext.propertyName}</Badge>
              )}
            </div>
            {subtitle && (
              <p className="break-words text-sm text-ink-muted">{subtitle}</p>
            )}
          </div>
        )}

        {sections.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No additional information is available to show here yet.
          </p>
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <DetailSection
                key={section.title ?? section.layout}
                section={section}
                editContext={editContext}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-ink-faint">
          <span>
            {lastEditedTime
              ? `Last updated ${new Date(lastEditedTime).toLocaleString()}`
              : "Last updated: unknown"}
          </span>
          {notionUrl && isSafeHttpUrl(notionUrl) && (
            <a
              href={notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Open in Notion
            </a>
          )}
        </div>
      </div>
    </Dialog>
  );
}
