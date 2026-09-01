"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
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
import { Search } from "lucide-react";

import {
  NOTION_REGIONS,
  UNKNOWN_REGION,
} from "../config/notion-region-reference";
import type {
  IntegrationHighlights,
  NotionListingWithRegion,
} from "../services/integrations.service";
import { matchesListingQuery } from "../services/notion-listing-match";
import { isSafeHttpUrl } from "./notion-link.utils";

const ALL_REGIONS_VALUE = "";

/**
 * Renders `href` as a link only when it's a validated http(s) URL — several
 * source fields (Airbnb Link, VRBO Link, Direct booking) are Notion
 * rich_text, not Notion's validated url type, so their content is never
 * assumed to be a safe link. A non-URL value still renders as plain text
 * (e.g. "Book direct via text message") rather than being hidden.
 */
function SafeLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="text-ink-faint">—</span>;
  if (!isSafeHttpUrl(href))
    return <span className="text-ink-muted">{href}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-forest-600 underline underline-offset-2 hover:text-forest-700"
    >
      {label}
    </a>
  );
}

/**
 * Purely presentational, strictly read-only — no forms or actions that
 * write anything to Notion or to StayWhile's database. Receives the
 * already-fetched, already-mapped listing set (never a raw Notion property
 * object) and does all name/keyword/region filtering client-side, since the
 * full set is small and region has no server-side equivalent to filter by
 * (there is no Region property in Notion — see notion-region-matching.ts).
 */
export function NotionListingsSearch({
  listings,
}: {
  listings: IntegrationHighlights<NotionListingWithRegion>;
}) {
  const [nameQuery, setNameQuery] = useState("");
  const [keywordQuery, setKeywordQuery] = useState("");
  const [region, setRegion] = useState(ALL_REGIONS_VALUE);

  const allItems = listings.configured && listings.ok ? listings.items : [];

  const filtered = useMemo(() => {
    const name = nameQuery.trim().toLowerCase();
    const keyword = keywordQuery.trim().toLowerCase();

    return allItems.filter((item) => {
      if (name && !item.name.toLowerCase().includes(name)) return false;

      // Same match rule as the unified "Search Notion" feature above uses
      // for a listing (see notion-listing-match.ts) — kept as one shared,
      // tested function so the two features can never silently drift apart
      // on what counts as a match.
      if (keyword && !matchesListingQuery(item, keywordQuery)) return false;

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

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <StatusIndicator label="Notion connection: Connected" tone="success" />
        <StatusIndicator
          label="View of Listings: Read access verified"
          tone="success"
        />
      </div>

      <FilterBar>
        <Input
          placeholder="Search by name…"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          aria-label="Search by property name"
          className="max-w-xs"
        />
        <Input
          placeholder="Keyword search…"
          value={keywordQuery}
          onChange={(e) => setKeywordQuery(e.target.value)}
          aria-label="Keyword search"
          className="max-w-xs"
        />
        <Select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label="Filter by region"
          className="max-w-xs"
        >
          <option value={ALL_REGIONS_VALUE}>All regions</option>
          {NOTION_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value={UNKNOWN_REGION}>{UNKNOWN_REGION}</option>
        </Select>
        <Button type="button" variant="secondary" onClick={handleReset}>
          Reset
        </Button>
      </FilterBar>

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
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Region</TableHeaderCell>
            <TableHeaderCell>Address</TableHeaderCell>
            <TableHeaderCell>Bedrooms</TableHeaderCell>
            <TableHeaderCell>Bathrooms</TableHeaderCell>
            <TableHeaderCell>Guests</TableHeaderCell>
            <TableHeaderCell>Direct booking</TableHeaderCell>
            <TableHeaderCell>Airbnb</TableHeaderCell>
            <TableHeaderCell>VRBO</TableHeaderCell>
            <TableHeaderCell>Photos</TableHeaderCell>
            <TableHeaderCell>Guidebook</TableHeaderCell>
          </TableHead>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-ink">
                  {item.name}
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
                <TableCell className="text-ink-muted">
                  {item.address ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {item.bedrooms ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {item.bathrooms ?? "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {item.guests ?? "—"}
                </TableCell>
                <TableCell>
                  <SafeLink href={item.directBooking} label="Book" />
                </TableCell>
                <TableCell>
                  <SafeLink href={item.airbnbLink} label="Airbnb" />
                </TableCell>
                <TableCell>
                  <SafeLink href={item.vrboLink} label="VRBO" />
                </TableCell>
                <TableCell>
                  <SafeLink href={item.googleDrivePhotosUrl} label="Photos" />
                </TableCell>
                <TableCell>
                  <SafeLink href={item.guidebookUrl} label="Guidebook" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
