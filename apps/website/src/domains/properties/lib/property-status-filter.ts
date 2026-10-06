import type { Tone } from "@stayw/ui";

import { isOperationalProperty } from "./operational-properties";

/**
 * /properties status filter + display labels (Meeting #6 follow-up,
 * 2026-10-07). Pure: no query, no write. A view rule only — Property.status
 * is never changed here.
 *
 *   operational (default) → ACTIVE + ONBOARDING, the same operational scope
 *                           as reservations and the dashboard home;
 *   inactive              → INACTIVE + OFFBOARDED;
 *   all                   → every non-deleted property.
 *
 * Soft-deleted properties never reach this page (listProperties excludes
 * them), so they're in no tab.
 */

export const PROPERTY_STATUS_FILTERS = [
  "operational",
  "inactive",
  "all",
] as const;
export type PropertyStatusFilter = (typeof PROPERTY_STATUS_FILTERS)[number];

export const DEFAULT_PROPERTY_STATUS_FILTER: PropertyStatusFilter =
  "operational";

export const PROPERTY_STATUS_FILTER_LABELS: Record<
  PropertyStatusFilter,
  string
> = {
  operational: "Operational",
  inactive: "Inactive",
  all: "All",
};

const INACTIVE_STATUSES = new Set(["INACTIVE", "OFFBOARDED"]);

/** Human labels for Property.status (values themselves are unchanged). */
export const PROPERTY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ONBOARDING: "Onboarding",
  INACTIVE: "Inactive",
  OFFBOARDED: "Offboarded",
};

export const PROPERTY_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  ONBOARDING: "info",
  INACTIVE: "neutral",
  OFFBOARDED: "error",
};

export function propertyStatusLabel(status: string): string {
  return PROPERTY_STATUS_LABELS[status] ?? status;
}

/** `?status=` → a known filter; anything else → the default. */
export function parsePropertyStatusFilter(
  value: string | string[] | undefined,
): PropertyStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PROPERTY_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as PropertyStatusFilter)
    : DEFAULT_PROPERTY_STATUS_FILTER;
}

type FilterableProperty = {
  status: string;
  deletedAt?: Date | null;
  name: string;
};

export function matchesPropertyStatusFilter(
  property: FilterableProperty,
  filter: PropertyStatusFilter,
): boolean {
  switch (filter) {
    case "operational":
      return isOperationalProperty(property);
    case "inactive":
      return !property.deletedAt && INACTIVE_STATUSES.has(property.status);
    case "all":
      return !property.deletedAt;
  }
}

export function propertyStatusFilterCounts(
  properties: readonly FilterableProperty[],
): Record<PropertyStatusFilter, number> {
  return {
    operational: properties.filter((p) =>
      matchesPropertyStatusFilter(p, "operational"),
    ).length,
    inactive: properties.filter((p) =>
      matchesPropertyStatusFilter(p, "inactive"),
    ).length,
    all: properties.filter((p) => matchesPropertyStatusFilter(p, "all")).length,
  };
}

/** The filter's properties, alphabetically by name (case-insensitive). */
export function filterAndSortProperties<T extends FilterableProperty>(
  properties: readonly T[],
  filter: PropertyStatusFilter,
): T[] {
  return properties
    .filter((p) => matchesPropertyStatusFilter(p, filter))
    .sort((a, b) =>
      a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }),
    );
}

export function propertyStatusFilterHref(filter: PropertyStatusFilter): string {
  return filter === DEFAULT_PROPERTY_STATUS_FILTER
    ? "/properties"
    : `/properties?status=${filter}`;
}
