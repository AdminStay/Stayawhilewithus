"use client";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  NOTION_REGIONS,
  UNKNOWN_REGION,
} from "../config/notion-region-reference";
import type {
  IntegrationHighlights,
  NotionListingWithVisibility,
} from "../services/integrations.service";
import { buildNotionDetailSections } from "../services/notion-detail-sections";
import { matchesListingQuery } from "../services/notion-listing-match";

import { NotionDetailView } from "./NotionDetailView";
import { isSafeHttpUrl } from "./notion-link.utils";
import type { NotionFieldEditorProps } from "./NotionFieldEditor";

const ALL_REGIONS_VALUE = "";

/** The subset of listing fields that are ever a link/contact value (never a number) — narrowed explicitly so ResourceChips never has to guard against a non-string field value. */
type ResourceFieldKey =
  | "directBooking"
  | "airbnbLink"
  | "vrboLink"
  | "googleDrivePhotosUrl"
  | "guidebookUrl";

/** Short label for each "Booking & resources" field, in the fixed display order used both by the table's compact chips and the detail view. */
const RESOURCE_LINKS: { key: ResourceFieldKey; label: string }[] = [
  { key: "directBooking", label: "Direct" },
  { key: "airbnbLink", label: "Airbnb" },
  { key: "vrboLink", label: "VRBO" },
  { key: "googleDrivePhotosUrl", label: "Photos" },
  { key: "guidebookUrl", label: "Guidebook" },
];

/**
 * Compact stand-in for what used to be 5 full URL columns: one small pill
 * per resource that actually has a value, each showing a short label —
 * never the raw URL — with the exact original href preserved. A non-URL
 * value (e.g. free-text Direct Booking instructions) renders as a small
 * muted label instead of a link, with the full text still available via the
 * native `title` tooltip and, unabridged, in the detail view. Real anchors,
 * never nested inside another clickable control.
 */
function ResourceChips({
  fields,
}: {
  fields: NotionListingWithVisibility["fields"];
}) {
  const entries = RESOURCE_LINKS.map(({ key, label }) => ({
    key,
    label,
    value: fields[key] ?? null,
  })).filter((entry) => entry.value);

  if (entries.length === 0) {
    return <span className="text-xs text-ink-faint">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(({ key, label, value }) =>
        isSafeHttpUrl(value) ? (
          <a
            key={key}
            href={value ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={`${label} — opens in a new tab`}
            className="inline-flex items-center gap-0.5 rounded-pill border border-border bg-surface px-2 py-0.5 text-xs font-medium text-forest-600 transition-colors hover:border-forest-300 hover:bg-forest-50 focus:outline-none focus:ring-2 focus:ring-forest-500/30"
          >
            {label}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span
            key={key}
            title={value ?? undefined}
            className="max-w-[6rem] truncate rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-ink-muted"
          >
            {label}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Purely presentational, strictly read-only — no forms or actions that
 * write anything to Notion or to StayWhile's database. Receives the
 * already-fetched, already-visibility-filtered listing set (see
 * buildNotionListingClientDto() — never a raw Notion property object) and
 * does all name/keyword/region filtering client-side, since the full set is
 * small and region has no server-side equivalent to filter by (there is no
 * Region property in Notion — see notion-region-matching.ts).
 *
 * Table columns are deliberately consolidated (Property/Region/Address/
 * Capacity/Resources — 5, not the original 11: bedrooms/bathrooms/guests
 * are combined into one compact "Capacity" column, and the 5 link fields
 * become a single row of small chips) so operating this page never
 * requires horizontally scrolling the dashboard on ordinary widths; the
 * full field set remains one click away in the detail view, which itself
 * never scrolls horizontally either (see NotionDetailView / @stayw/ui's
 * Dialog). @stayw/ui's Table still wraps in its own `overflow-x-auto` as a
 * safety net for genuinely narrow viewports — that's a contained,
 * last-resort scroll on the table itself, never the page.
 */
export function NotionListingsSearch({
  listings,
  updateFieldAction,
}: {
  listings: IntegrationHighlights<NotionListingWithVisibility>;
  /** Passed straight through to NotionDetailView/NotionFieldEditor — see NotionFieldEditor's own doc comment for why this is threaded as a prop instead of imported directly here. Optional: absent means the dashboard stays read-only regardless of any field's `editable` flag. */
  updateFieldAction?: NotionFieldEditorProps["action"];
}) {
  const [nameQuery, setNameQuery] = useState("");
  const [keywordQuery, setKeywordQuery] = useState("");
  const [region, setRegion] = useState(ALL_REGIONS_VALUE);
  const [openListingId, setOpenListingId] = useState<string | null>(null);

  const allItems = listings.configured && listings.ok ? listings.items : [];

  const filtered = useMemo(() => {
    const name = nameQuery.trim().toLowerCase();
    const keyword = keywordQuery.trim().toLowerCase();

    return allItems.filter((item) => {
      if (name && !(item.fields.name ?? "").toLowerCase().includes(name)) {
        return false;
      }

      // Same match rule as the unified "Search Notion" feature above uses
      // for a listing (see notion-listing-match.ts) — kept as one shared,
      // tested function so the two features can never silently drift apart
      // on what counts as a match. Matches against item.fields (the safe,
      // already-visibility-filtered DTO), never a raw record.
      if (keyword && !matchesListingQuery(item.fields, keywordQuery)) {
        return false;
      }

      if (region && item.region !== region) return false;

      return true;
    });
  }, [allItems, nameQuery, keywordQuery, region]);

  function handleReset() {
    setNameQuery("");
    setKeywordQuery("");
    setRegion(ALL_REGIONS_VALUE);
  }

  if (listings.configured === false) {
    return (
      <p className="text-sm text-ink-muted">
        Not connected — set <code className="text-xs">NOTION_API_KEY</code> and{" "}
        <code className="text-xs">NOTION_LISTINGS_DATA_SOURCE_ID</code> to
        enable.
      </p>
    );
  }

  // The live listing read drives this status directly — a failed request
  // must never be shown next to a stale "verified" message.
  if (listings.ok === false) {
    return (
      <div className="space-y-2">
        <StatusIndicator label="Notion connection: Connected" tone="success" />
        <StatusIndicator
          label={`View of Listings: Read access failed — ${listings.error}`}
          tone="error"
        />
      </div>
    );
  }

  const openListing = openListingId
    ? allItems.find((item) => item.id === openListingId)
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <StatusIndicator label="Notion connection: Connected" tone="success" />
        <StatusIndicator
          label="View of Listings: Read access verified"
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Property name
          </span>
          <Input
            placeholder="Search by name…"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            aria-label="Search by property name"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Keyword
          </span>
          <Input
            placeholder="Address, booking note…"
            value={keywordQuery}
            onChange={(e) => setKeywordQuery(e.target.value)}
            aria-label="Keyword search"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Region
          </span>
          <Select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            aria-label="Filter by region"
            className="sm:w-40"
          >
            <option value={ALL_REGIONS_VALUE}>All regions</option>
            {NOTION_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={UNKNOWN_REGION}>{UNKNOWN_REGION}</option>
          </Select>
        </label>
        <Button type="button" variant="secondary" onClick={handleReset}>
          Reset
        </Button>
      </div>

      <p className="text-sm text-ink-muted">
        {filtered.length} of {allItems.length} listings
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No listings match your filters"
          description="Try a different name, keyword, or region."
        />
      ) : (
        <Table>
          <TableHead>
            <TableHeaderCell>Property</TableHeaderCell>
            <TableHeaderCell>Region</TableHeaderCell>
            <TableHeaderCell>Address</TableHeaderCell>
            <TableHeaderCell>Capacity</TableHeaderCell>
            <TableHeaderCell>Resources</TableHeaderCell>
          </TableHead>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-[14rem] font-medium text-ink">
                  <button
                    type="button"
                    onClick={() => setOpenListingId(item.id)}
                    className="truncate text-left underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-forest-500/30 focus:ring-offset-1"
                  >
                    {item.fields.name ?? "—"}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={
                      item.region === UNKNOWN_REGION ? "neutral" : "success"
                    }
                  >
                    {item.region}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-ink-muted">
                  {item.fields.address ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-ink-muted">
                  {item.fields.bedrooms ?? "—"} bd ·{" "}
                  {item.fields.bathrooms ?? "—"} ba ·{" "}
                  {item.fields.guests ?? "—"} guests
                </TableCell>
                <TableCell>
                  <ResourceChips fields={item.fields} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <NotionDetailView
        open={openListing != null}
        onClose={() => setOpenListingId(null)}
        title={openListing?.fields.name ?? ""}
        subtitle={openListing?.fields.address ?? null}
        region={openListing?.region ?? null}
        sections={
          openListing
            ? buildNotionDetailSections(openListing.visibleFields)
            : []
        }
        lastEditedTime={openListing?.lastEditedTime ?? null}
        notionUrl={openListing?.url ?? null}
        propertyContext={openListing?.propertyContext ?? null}
        pageId={openListing?.id ?? null}
        dataSourceId={openListing?.dataSourceId ?? null}
        updateFieldAction={updateFieldAction}
      />
    </div>
  );
}
