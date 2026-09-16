"use client";

import { Badge, Dialog } from "@stayw/ui";
import type { ReactNode } from "react";

import { isSafeHttpUrl } from "./notion-link.utils";

export interface NotionDetailField {
  label: string;
  value: ReactNode;
}

export interface NotionDetailPropertyContext {
  propertyId: string;
  propertyName: string;
}

/**
 * The in-dashboard "view" experience — opened from a Search result or a
 * Property Listings row, never a new tab, never Notion's own UI embedded.
 * Every field shown here was already selected server-side (see
 * notion-field-visibility.ts's selectVisibleNotionFields()) before this
 * component ever received it — this component has no ability to reveal a
 * field that wasn't passed to it, so there's nothing here that could leak
 * an unauthorized field even if this component's own rendering logic had a
 * bug. Read-only today: no editable control renders until a future pass
 * wires one in for an actual client-approved field (NOTION_EDIT_ALLOWLIST
 * is currently empty).
 *
 * Deliberately never shows: Notion page/database ids, API details, n8n/
 * webhook terminology, or raw property JSON — only the human-readable
 * label/value pairs the caller supplies.
 */
export function NotionDetailView({
  open,
  onClose,
  title,
  fields,
  lastEditedTime,
  notionUrl,
  propertyContext,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: NotionDetailField[];
  lastEditedTime: string | null;
  notionUrl: string | null;
  propertyContext: NotionDetailPropertyContext | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {propertyContext && (
          <Badge tone="success">{propertyContext.propertyName}</Badge>
        )}

        {fields.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No additional information is available to show here yet.
          </p>
        ) : (
          <dl className="space-y-3">
            {fields.map((field) => (
              <div key={field.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {field.label}
                </dt>
                <dd className="mt-0.5 text-sm text-ink">
                  {field.value || <span className="text-ink-faint">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-ink-faint">
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
