"use client";

import { Button } from "@stayw/ui";
import { useState } from "react";

import { formatAddress } from "../lib/owner-rez-onboarding-display";

import type { UnmatchedOwnerRezSummary } from "../services/ownerrez-onboarding.service";

const CSV_HEADER = [
  "OwnerRez ID",
  "Name",
  "Internal Code",
  "Address",
  "Active",
];

/**
 * RFC 4180-style escaping, identical in behavior to the one already proven
 * in CopyInventoryButton (smart-devices domain) — a value is quoted only
 * when it contains a comma, a double quote, or a newline, doubling any
 * quote it contains. Kept as its own copy rather than a shared cross-domain
 * util: this is the second CSV export in the app, and the function is four
 * lines with no state — not worth a new shared module yet.
 */
function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds the CSV entirely from the `active` summaries already loaded onto
 * this page (the same array OwnerRezOnboardingPanel renders) — no server
 * fetch, no OwnerRez API call, no database read of its own. Only the 5
 * named, non-sensitive fields below are included; the full OwnerrezProperty/
 * OwnerrezPropertyDetail objects (which also carry lat/long, bedrooms,
 * bathrooms, max_guests, time_zone, property_type) are never serialized
 * wholesale, and no OwnerRez credential/token ever reaches this data in the
 * first place.
 */
function buildActiveOwnerRezCsv(active: UnmatchedOwnerRezSummary[]): string {
  const rows = active.map(({ ownerRezProperty, detail }) => [
    String(ownerRezProperty.id),
    ownerRezProperty.name,
    ownerRezProperty.internal_code ?? "",
    formatAddress(detail),
    ownerRezProperty.active ? "Yes" : "No",
  ]);

  return [CSV_HEADER, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}

/**
 * Copies the currently-loaded active/unmatched OwnerRez property list to
 * the clipboard as CSV, so an admin can hand the full set to a cross-
 * reference pass instead of transcribing rows by hand. Purely a client-side
 * transform of props already fetched by the server page — clicking this
 * never triggers a network request, a device change, or a property write.
 * The existing one-at-a-time "Create StayWhile Property" flow (in the
 * sibling Card list) is completely untouched by this component.
 */
export function CopyActiveOwnerRezCsvButton({
  active,
}: {
  active: UnmatchedOwnerRezSummary[];
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function handleCopy() {
    const csv = buildActiveOwnerRezCsv(active);
    try {
      await navigator.clipboard.writeText(csv);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        Copy Active as CSV
      </Button>
      {copyState === "copied" && (
        <span className="text-xs text-success-600">Copied.</span>
      )}
      {copyState === "failed" && (
        <span className="text-xs text-error-500">
          Couldn&apos;t copy — try selecting the table instead.
        </span>
      )}
    </div>
  );
}
