"use client";

import { Badge, Dialog } from "@stayw/ui";
import { ExternalLink } from "lucide-react";

import type {
  NotionDetailField,
  NotionDetailSection,
} from "../services/notion-detail-sections";

import { isSafeHttpUrl } from "./notion-link.utils";

export interface NotionDetailPropertyContext {
  propertyId: string;
  propertyName: string;
}

/**
 * A single "Booking & resources" row: the field's label on the left, and
 * either a compact "Open" action (for a real http(s) URL — never the raw
 * URL text itself, per the client's explicit request) or the plain value
 * itself, word-wrapped, when it isn't a URL (e.g. Direct Booking is
 * sometimes free text like "Text the owner directly"). The href is always
 * the exact, unmodified source value — only the visible label changes.
 */
function ResourceRow({ field }: { field: NotionDetailField }) {
  const value = typeof field.value === "string" ? field.value : null;
  const isLink = isSafeHttpUrl(value);

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

function DetailSection({ section }: { section: NotionDetailSection }) {
  return (
    <div>
      {section.title && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {section.title}
        </h3>
      )}

      {section.layout === "grid" && (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-muted p-3">
          {section.fields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="truncate text-xs text-ink-muted">{field.label}</dt>
              <dd className="mt-0.5 text-base font-semibold text-ink">
                {field.value === null || field.value === undefined
                  ? "—"
                  : field.value}
              </dd>
            </div>
          ))}
        </div>
      )}

      {section.layout === "actions" && (
        <div className="space-y-1.5">
          {section.fields.map((field) => (
            <ResourceRow key={field.key} field={field} />
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
                {field.value || <span className="text-ink-faint">—</span>}
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
 * label/value pairs the caller supplies. Everything wraps rather than
 * overflows (`break-words`/`min-w-0` throughout), and the dialog itself
 * caps its width and scrolls vertically, never horizontally — see
 * @stayw/ui's Dialog.
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
}) {
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
